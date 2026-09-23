import "server-only";

import {
  assertAuthorization,
  reviewerAttribution,
  type ProfessorReviewAuthorization,
} from "@/lib/auth/authorization";
import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { mapQuestionRow } from "@/lib/data/database-repository";
import type { ReservePracticeCandidate } from "@/lib/data/reserve-practice-repository";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import { queryPostgres } from "@/lib/data/postgres";
import { getServerEnv } from "@/lib/env/server";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import {
  QuestionLifecycleConflictError,
  QuestionLifecycleNotFoundError,
  QuestionLifecycleValidationError,
} from "@/lib/tutor/question-lifecycle";
import type {
  QuestionSimilarityCoverageDto,
  QuestionSimilarityLinkDto,
} from "@/lib/types";

export type LinkedReservePracticeCandidate = ReservePracticeCandidate & {
  originQuestionId: string;
  originVersionId: number;
  slot: 1 | 2 | 3;
};

export type QuestionSimilaritySelectionRepository = {
  listEligibleForOrigin(
    originQuestionId: string,
    originVersionId: number,
  ): Promise<LinkedReservePracticeCandidate[]>;
};

export type QuestionSimilarityRepository =
  QuestionSimilaritySelectionRepository & {
    listCoverage(
      authorization: ProfessorReviewAuthorization,
      topicId?: string,
    ): Promise<QuestionSimilarityCoverageDto[]>;
    listLinks(
      authorization: ProfessorReviewAuthorization,
      questionId: string,
    ): Promise<QuestionSimilarityLinkDto[]>;
    setLink(
      authorization: ProfessorReviewAuthorization,
      input: SetSimilarPracticeLinkInput,
    ): Promise<QuestionSimilarityLinkDto[]>;
  };

export type SetSimilarPracticeLinkInput =
  | {
      action: "assign";
      expectedSimilarVersionId: number;
      originQuestionId: string;
      originVersionId: number;
      requestId?: string;
      similarQuestionId: string;
      slot: 1 | 2 | 3;
    }
  | {
      action: "remove";
      expectedSimilarVersionId: number;
      linkId: number;
      originQuestionId: string;
      originVersionId: number;
      requestId?: string;
      similarQuestionId: string;
      slot: 1 | 2 | 3;
    };

let selectionRepositoryOverride:
  | QuestionSimilaritySelectionRepository
  | undefined;

export async function listEligibleSimilarQuestionsForOrigin(
  originQuestionId: string,
  originVersionId: number,
) {
  return readWithConfiguredSelectionRepository((repository) =>
    repository.listEligibleForOrigin(originQuestionId, originVersionId),
  );
}

export function createDatabaseQuestionSimilaritySelectionRepository(
  query: DatabaseQueryExecutor,
): QuestionSimilaritySelectionRepository {
  return {
    async listEligibleForOrigin(originQuestionId, originVersionId) {
      const rows = await readDatabaseRows(
        query,
        `select
           reserve_question.*,
           reserve_record.reserved_at,
           link.origin_question_id,
           link.origin_version_id,
           link.slot
         from question_similarity_links link
         join app_public_questions origin_question
           on origin_question.id = link.origin_question_id
          and origin_question.question_version_id = link.origin_version_id
         join app_reserve_practice_questions reserve_question
           on reserve_question.id = link.similar_question_id
          and reserve_question.question_version_id = link.similar_version_id
         join questions reserve_record on reserve_record.id = reserve_question.id
         where link.origin_question_id = $1
           and link.origin_version_id = $2
           and link.relationship_type = 'similar_practice'
           and link.revoked_at is null
         order by link.slot, reserve_record.reserved_at, reserve_question.id`,
        [originQuestionId, originVersionId],
      );

      return rows.map((row) => ({
        originQuestionId: String(row.origin_question_id),
        originVersionId: Number(row.origin_version_id),
        question: mapQuestionRow(row as Parameters<typeof mapQuestionRow>[0]),
        reservedAt: new Date(String(row.reserved_at)).toISOString(),
        slot: Number(row.slot) as 1 | 2 | 3,
        versionId: Number(row.question_version_id),
      }));
    },
  };
}

export function createDatabaseQuestionSimilarityRepository(
  query: DatabaseQueryExecutor,
): QuestionSimilarityRepository {
  const selection = createDatabaseQuestionSimilaritySelectionRepository(query);
  return {
    ...selection,
    async listCoverage(authorization, topicId) {
      assertAuthorization(authorization, "professor");
      return selectCoverage(query, topicId);
    },
    async listLinks(authorization, questionId) {
      assertAuthorization(authorization, "professor");
      return selectLinks(query, questionId);
    },
    async setLink(authorization, input) {
      return setSimilarPracticeLinkWithQuery(query, authorization, input);
    },
  };
}

export async function listQuestionSimilarityLinks(
  authorization: ProfessorReviewAuthorization,
  questionId: string,
) {
  assertAuthorization(authorization, "professor");
  if (getOperatingModePolicy().repositorySource === "demo") return [];
  return strictDatabaseRead((query) =>
    createDatabaseQuestionSimilarityRepository(query).listLinks(
      authorization,
      questionId,
    ),
  );
}

export async function listQuestionSimilarityCoverage(
  authorization: ProfessorReviewAuthorization,
  topicId?: string,
) {
  assertAuthorization(authorization, "professor");
  if (getOperatingModePolicy().repositorySource === "demo") return [];
  return strictDatabaseRead((query) =>
    createDatabaseQuestionSimilarityRepository(query).listCoverage(
      authorization,
      topicId,
    ),
  );
}

export async function setSimilarPracticeLink(
  authorization: ProfessorReviewAuthorization,
  input: SetSimilarPracticeLinkInput,
) {
  return strictDatabaseRead((query) =>
    createDatabaseQuestionSimilarityRepository(query).setLink(
      authorization,
      input,
    ),
  );
}

async function setSimilarPracticeLinkWithQuery(
  query: DatabaseQueryExecutor,
  authorization: ProfessorReviewAuthorization,
  input: SetSimilarPracticeLinkInput,
) {
  assertAuthorization(authorization, "professor");
  const reviewer = reviewerAttribution(authorization);
  return runDatabaseTransaction(
    query,
    async (transactionQuery) => {
      const actorRows = await transactionQuery(
        "select external_subject from users where id = $1",
        [reviewer.userId],
      );
      const actor = actorRows[0];
      if (!actor) {
        throw new QuestionLifecycleNotFoundError(
          "The professor account was not found.",
        );
      }

      if (input.action === "remove") {
        const linkRows = await transactionQuery(
          `select * from question_similarity_links
           where id = $1
             and origin_question_id = $2
             and similar_question_id = $3
             and origin_version_id = $4
             and similar_version_id = $5
             and relationship_type = 'similar_practice'
             and slot = $6
           for update`,
          [
            input.linkId,
            input.originQuestionId,
            input.similarQuestionId,
            input.originVersionId,
            input.expectedSimilarVersionId,
            input.slot,
          ],
        );
        const link = linkRows[0];
        if (!link) {
          throw new QuestionLifecycleConflictError(
            "The similar-practice assignment changed before it could be revoked.",
          );
        }
        if (link.revoked_at === null || link.revoked_at === undefined) {
          await transactionQuery(
            "select set_config('app.similarity_link_write', 'allowed', true)",
          );
          await transactionQuery(
            `update question_similarity_links
             set revoked_at = now(), revoked_by_user_id = $2
             where id = $1 and revoked_at is null`,
            [input.linkId, reviewer.userId],
          );
          await insertSimilarityAudit(transactionQuery, {
            action: "revoke",
            actorSubject: String(actor.external_subject),
            input,
            linkId: input.linkId,
            reviewerUserId: reviewer.userId,
          });
        }
        return selectLinks(transactionQuery, input.similarQuestionId);
      }

      const stateRows = await transactionQuery(
        `select
           origin.id as origin_question_id,
           origin.record_state as origin_record_state,
           origin.published_version_id as current_origin_version_id,
           origin.topic_id as origin_topic_id,
           origin_lifecycle.state as origin_state,
           sibling.id as similar_question_id,
           sibling.record_state as similar_record_state,
           sibling.working_version_id as current_similar_version_id,
           sibling.published_version_id as similar_published_version_id,
           sibling.topic_id as similar_topic_id,
           sibling.is_reserved,
           sibling.reserve_practice_allowed,
           sibling_lifecycle.state as similar_state,
           exists (
             select 1 from app_public_questions public_origin
             where public_origin.id = origin.id
               and public_origin.question_version_id = $4
           ) as origin_eligible,
           exists (
             select 1 from app_reserve_practice_questions reserve_sibling
             where reserve_sibling.id = sibling.id
               and reserve_sibling.question_version_id = $5
           ) as sibling_eligible
         from questions origin
         join question_version_lifecycle origin_lifecycle
           on origin_lifecycle.question_version_id = origin.published_version_id
         join questions sibling on sibling.id = $2
         join question_version_lifecycle sibling_lifecycle
           on sibling_lifecycle.question_version_id = sibling.working_version_id
         where origin.id = $1
           and exists (select 1 from users actor where actor.id = $3)
         for update of origin, sibling`,
        [
          input.originQuestionId,
          input.similarQuestionId,
          reviewer.userId,
          input.originVersionId,
          input.expectedSimilarVersionId,
        ],
      );
      const state = stateRows[0];
      if (!state?.origin_question_id || !state.similar_question_id) {
        throw new QuestionLifecycleNotFoundError(
          "The origin or similar question was not found.",
        );
      }
      if (
        input.originQuestionId === input.similarQuestionId ||
        state.origin_record_state !== "active" ||
        state.origin_state !== "published" ||
        Number(state.current_origin_version_id) !== input.originVersionId ||
        !state.origin_eligible
      ) {
        throw new QuestionLifecycleValidationError(
          "The origin must be the exact current available published question version.",
        );
      }
      if (
        state.similar_record_state !== "active" ||
        !state.is_reserved ||
        !state.reserve_practice_allowed ||
        state.similar_published_version_id !== null ||
        !["approved", "unpublished"].includes(String(state.similar_state)) ||
        Number(state.current_similar_version_id) !==
          input.expectedSimilarVersionId ||
        !state.sibling_eligible
      ) {
        throw new QuestionLifecycleValidationError(
          "The sibling must be the exact current available, approved, unpublished, practice-enabled Reserve version.",
        );
      }
      if (state.origin_topic_id !== state.similar_topic_id) {
        throw new QuestionLifecycleValidationError(
          "The origin and dedicated sibling must belong to the same topic.",
        );
      }

      const existingRows = await transactionQuery(
        `select * from question_similarity_links
         where relationship_type = 'similar_practice'
           and revoked_at is null
           and (
             similar_question_id = $1
             or (origin_question_id = $2 and slot = $3)
           )
         for update`,
        [input.similarQuestionId, input.originQuestionId, input.slot],
      );
      if (existingRows.length > 0) {
        const exact = existingRows.find(
          (row) =>
            row.origin_question_id === input.originQuestionId &&
            Number(row.origin_version_id) === input.originVersionId &&
            row.similar_question_id === input.similarQuestionId &&
            Number(row.similar_version_id) === input.expectedSimilarVersionId &&
            Number(row.slot) === input.slot,
        );
        if (!exact) {
          throw new QuestionLifecycleConflictError(
            "That sibling or slot already has a different active similar-practice assignment.",
          );
        }
        return selectLinks(transactionQuery, input.similarQuestionId);
      }

      const inserted = await transactionQuery(
        `insert into question_similarity_links (
           origin_question_id,
           similar_question_id,
           origin_version_id,
           similar_version_id,
           relationship_type,
           slot,
           created_by_user_id
         ) values ($1, $2, $3, $4, 'similar_practice', $5, $6)
         returning id`,
        [
          input.originQuestionId,
          input.similarQuestionId,
          input.originVersionId,
          input.expectedSimilarVersionId,
          input.slot,
          reviewer.userId,
        ],
      );
      const linkId = Number(inserted[0]?.id);
      await insertSimilarityAudit(transactionQuery, {
        action: "assign",
        actorSubject: String(actor.external_subject),
        input,
        linkId,
        reviewerUserId: reviewer.userId,
      });
      return selectLinks(transactionQuery, input.similarQuestionId);
    },
    { retryOnConflict: true },
  );
}

async function insertSimilarityAudit(
  query: DatabaseQueryExecutor,
  values: {
    action: "assign" | "revoke";
    actorSubject: string;
    input: SetSimilarPracticeLinkInput;
    linkId: number;
    reviewerUserId: string;
  },
) {
  await query(
    `insert into audit_events (
       actor_user_id,
       actor_subject,
       action,
       entity_type,
       entity_id,
       request_id,
       metadata_json
     ) values ($1, $2, $3, 'question_similarity_link', $4, $5, $6::jsonb)`,
    [
      values.reviewerUserId,
      values.actorSubject,
      `question.similarity.${values.action}`,
      String(values.linkId),
      values.input.requestId ?? null,
      JSON.stringify({
        linkId: values.linkId,
        originQuestionId: values.input.originQuestionId,
        originVersionId: values.input.originVersionId,
        relationshipType: "similar_practice",
        similarQuestionId: values.input.similarQuestionId,
        similarVersionId: values.input.expectedSimilarVersionId,
        slot: values.input.slot,
      }),
    ],
  );
}

async function selectCoverage(query: DatabaseQueryExecutor, topicId?: string) {
  const params = topicId ? [topicId] : [];
  const rows = await readDatabaseRows(
    query,
    `select
       origin.id as origin_question_id,
       origin.title as origin_title,
       origin.topic_id,
       origin.question_version_id as origin_version_id,
       count(link.similar_question_id)::int as linked_sibling_count,
       count(eligible.id)::int as eligible_sibling_count
     from app_public_questions origin
     left join question_similarity_links link
       on link.origin_question_id = origin.id
      and link.origin_version_id = origin.question_version_id
      and link.relationship_type = 'similar_practice'
      and link.revoked_at is null
     left join app_reserve_practice_questions eligible
       on eligible.id = link.similar_question_id
      and eligible.question_version_id = link.similar_version_id
     ${topicId ? "where origin.topic_id = $1" : ""}
     group by
       origin.id,
       origin.title,
       origin.topic_id,
       origin.question_version_id
     order by origin.topic_id, origin.title, origin.id`,
    params,
  );
  return rows.map((row) => ({
    eligibleSiblingCount: Number(row.eligible_sibling_count),
    linkedSiblingCount: Number(row.linked_sibling_count),
    originQuestionId: String(row.origin_question_id),
    originTitle: String(row.origin_title),
    originVersionId: Number(row.origin_version_id),
    targetSiblingCount: 3,
    topicId: String(row.topic_id),
  })) satisfies QuestionSimilarityCoverageDto[];
}

async function selectLinks(query: DatabaseQueryExecutor, questionId: string) {
  const rows = await readDatabaseRows(
    query,
    `select
       link.*,
       origin_version.snapshot_json ->> 'title' as origin_title,
       similar_version.snapshot_json ->> 'title' as similar_title,
       actor.display_name as created_by_display_name,
       revoker.display_name as revoked_by_display_name,
       exists (
         select 1
         from app_public_questions origin
         join app_reserve_practice_questions eligible
           on eligible.id = link.similar_question_id
          and eligible.question_version_id = link.similar_version_id
         where origin.id = link.origin_question_id
           and origin.question_version_id = link.origin_version_id
           and link.revoked_at is null
       ) as eligible
     from question_similarity_links link
     join question_versions origin_version on origin_version.id = link.origin_version_id
     join question_versions similar_version on similar_version.id = link.similar_version_id
     join users actor on actor.id = link.created_by_user_id
     left join users revoker on revoker.id = link.revoked_by_user_id
     where link.origin_question_id = $1 or link.similar_question_id = $1
     order by link.revoked_at nulls first, link.origin_question_id, link.slot,
       link.similar_question_id, link.created_at desc`,
    [questionId],
  );
  return rows.map((row) => ({
    createdAt: toIsoString(row.created_at),
    createdBy: {
      displayName: String(row.created_by_display_name),
      occurredAt: toIsoString(row.created_at),
      userId: String(row.created_by_user_id),
    },
    eligible: Boolean(row.eligible),
    id: Number(row.id),
    originQuestionId: String(row.origin_question_id),
    originTitle: String(row.origin_title),
    originVersionId: Number(row.origin_version_id),
    relationshipType: "similar_practice",
    revokedAt:
      row.revoked_at === null || row.revoked_at === undefined
        ? undefined
        : toIsoString(row.revoked_at),
    revokedBy:
      row.revoked_by_user_id === null || row.revoked_by_user_id === undefined
        ? undefined
        : {
            displayName: String(row.revoked_by_display_name),
            occurredAt: toIsoString(row.revoked_at),
            userId: String(row.revoked_by_user_id),
          },
    similarQuestionId: String(row.similar_question_id),
    similarTitle: String(row.similar_title),
    similarVersionId: Number(row.similar_version_id),
    slot: Number(row.slot) as 1 | 2 | 3,
  })) satisfies QuestionSimilarityLinkDto[];
}

async function readWithConfiguredSelectionRepository<T>(
  read: (repository: QuestionSimilaritySelectionRepository) => Promise<T>,
) {
  if (selectionRepositoryOverride) return read(selectionRepositoryOverride);
  const policy = getOperatingModePolicy();
  if (policy.repositorySource === "demo") {
    return read(emptySelectionRepository);
  }
  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    if (policy.allowDemoFallback) return read(emptySelectionRepository);
    throw new DataServiceUnavailableError("content");
  }
  try {
    return await read(
      createDatabaseQuestionSimilaritySelectionRepository(queryPostgres),
    );
  } catch (cause) {
    if (policy.allowDemoFallback) return read(emptySelectionRepository);
    throw new DataServiceUnavailableError("content", { cause });
  }
}

async function strictDatabaseRead<T>(
  read: (query: DatabaseQueryExecutor) => Promise<T>,
) {
  const policy = getOperatingModePolicy();
  const env = getServerEnv();
  if (policy.repositorySource === "demo" || !env.DATABASE_URL) {
    throw new DataServiceUnavailableError("content");
  }
  return read(queryPostgres);
}

function toIsoString(value: unknown) {
  return new Date(String(value)).toISOString();
}

const emptySelectionRepository: QuestionSimilaritySelectionRepository = {
  async listEligibleForOrigin() {
    return [];
  },
};

export function setQuestionSimilaritySelectionRepositoryForTests(
  repository: QuestionSimilaritySelectionRepository | undefined,
) {
  selectionRepositoryOverride = repository;
}
