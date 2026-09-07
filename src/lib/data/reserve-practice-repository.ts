import "server-only";

import {
  readDatabaseRows,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { mapQuestionRow } from "@/lib/data/database-repository";
import { queryPostgres } from "@/lib/data/postgres";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import { getServerEnv } from "@/lib/env/server";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import type { TutorQuestion } from "@/lib/types";

export type ReservePracticeCandidate = {
  question: TutorQuestion;
  reservedAt: string;
  versionId: number;
};

export type ReservePracticeRepository = {
  getEligibleQuestion(
    questionId: string,
    versionId: number,
  ): Promise<ReservePracticeCandidate | undefined>;
  listEligibleQuestions(): Promise<ReservePracticeCandidate[]>;
};

let repositoryOverride: ReservePracticeRepository | undefined;

export async function listEligibleReservePracticeQuestions() {
  return readWithConfiguredRepository((repository) =>
    repository.listEligibleQuestions(),
  );
}

export async function getEligibleReservePracticeQuestion(
  questionId: string,
  versionId: number,
) {
  return readWithConfiguredRepository((repository) =>
    repository.getEligibleQuestion(questionId, versionId),
  );
}

export function createDatabaseReservePracticeRepository(
  query: DatabaseQueryExecutor,
): ReservePracticeRepository {
  async function readCandidates(
    where = "",
    params: Array<string | number> = [],
  ) {
    const rows = await readDatabaseRows(
      query,
      `select reserve_question.*, q.reserved_at
       from app_reserve_practice_questions reserve_question
       join questions q on q.id = reserve_question.id
       ${where}
       order by q.reserved_at, reserve_question.id`,
      params,
    );

    return rows.map((row) => ({
      question: mapQuestionRow(row as Parameters<typeof mapQuestionRow>[0]),
      reservedAt: new Date(String(row.reserved_at)).toISOString(),
      versionId: Number(row.question_version_id),
    }));
  }

  return {
    async getEligibleQuestion(questionId, versionId) {
      return (
        await readCandidates(
          "where reserve_question.id = $1 and reserve_question.question_version_id = $2",
          [questionId, versionId],
        )
      )[0];
    },
    async listEligibleQuestions() {
      return readCandidates();
    },
  };
}

async function readWithConfiguredRepository<T>(
  read: (repository: ReservePracticeRepository) => Promise<T>,
) {
  if (repositoryOverride) return read(repositoryOverride);

  const policy = getOperatingModePolicy();
  if (policy.repositorySource === "demo") {
    return read(emptyReservePracticeRepository);
  }

  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    if (policy.allowDemoFallback) return read(emptyReservePracticeRepository);
    throw new DataServiceUnavailableError("content");
  }

  try {
    return await read(createDatabaseReservePracticeRepository(queryPostgres));
  } catch (cause) {
    if (policy.allowDemoFallback) return read(emptyReservePracticeRepository);
    throw new DataServiceUnavailableError("content", { cause });
  }
}

const emptyReservePracticeRepository: ReservePracticeRepository = {
  async getEligibleQuestion() {
    return undefined;
  },
  async listEligibleQuestions() {
    return [];
  },
};

export function setReservePracticeRepositoryForTests(
  repository: ReservePracticeRepository | undefined,
) {
  repositoryOverride = repository;
}
