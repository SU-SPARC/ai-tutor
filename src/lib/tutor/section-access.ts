import "server-only";

import {
  AnonymousPilotUnavailableError,
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  requireStudentAccess,
} from "@/lib/auth/authorization";
import type { StudentOwner } from "@/lib/auth/principal";
import type { DeliverySettings } from "@/lib/courses/types";
import type {
  SectionReleaseDto,
  StudentSectionDto,
} from "@/lib/data/courses-repository";
import {
  getStudentQuestionVersion,
  getStudentSectionReleases,
} from "@/lib/data/data-store";
import {
  findVisibleSectionRelease,
  visibleSectionReleases,
} from "@/lib/tutor/section-content";
import type { PracticeQuestion } from "@/lib/types";

export type StudentSectionContent = {
  /**
   * With `{ pinnedContent: true }`: each visible release's question at the
   * version the section pinned, keyed by question id (pass it to
   * `withPinnedQuestions`). A release whose pinned content could not be read
   * is absent, so that question is not listed.
   */
  pinnedQuestions?: Record<string, PracticeQuestion>;
  releases: SectionReleaseDto[];
  section: StudentSectionDto;
};

/**
 * The current visitor's section and its releases, or `undefined` for a
 * visitor with no identity or no section (they see the global list).
 *
 * Pass the owner when the caller already resolved it. A visitor with no
 * identity at all is simply "no section". If the sections store cannot be
 * read, the visitor also gets the global published list rather than a
 * broken page: everything in that list is already approved for students,
 * so failing open only loses the section's narrowing, never exposes drafts.
 */
export async function readStudentSectionContent(
  owner?: StudentOwner,
  options: { pinnedContent?: boolean } = {},
): Promise<StudentSectionContent | undefined> {
  let resolved = owner;
  if (!resolved) {
    try {
      resolved = (await requireStudentAccess({ allowAnonymous: true })).owner;
    } catch (error) {
      if (
        error instanceof AuthenticationRequiredError ||
        error instanceof AuthorizationDeniedError ||
        error instanceof AnonymousPilotUnavailableError
      ) {
        return undefined;
      }
      console.warn("sections: the student identity could not be read", error);
      return undefined;
    }
  }

  let content: StudentSectionContent | undefined;
  try {
    content = await getStudentSectionReleases(resolved);
  } catch (error) {
    console.warn("sections: the student's section could not be read", error);
    return undefined;
  }
  if (!content || !options.pinnedContent) {
    return content;
  }
  return {
    ...content,
    pinnedQuestions: await readPinnedQuestions(resolved, content.releases),
  };
}

/**
 * The visible releases' questions at their pinned versions. One unreadable
 * version drops that question only (logged); the rest of the section stays.
 */
async function readPinnedQuestions(
  owner: StudentOwner,
  releases: readonly SectionReleaseDto[],
): Promise<Record<string, PracticeQuestion>> {
  const visible = visibleSectionReleases(releases);
  const questions = await Promise.all(
    visible.map(async (release) => {
      try {
        return await getStudentQuestionVersion(
          owner,
          release.questionId,
          release.questionVersionId,
        );
      } catch (error) {
        console.warn(
          "sections: a pinned question version could not be read",
          error,
        );
        return undefined;
      }
    }),
  );
  const pinned: Record<string, PracticeQuestion> = {};
  visible.forEach((release, index) => {
    const question = questions[index];
    if (question && question.id === release.questionId) {
      pinned[release.questionId] = question;
    }
  });
  return pinned;
}

/**
 * The delivery settings that govern one question for this student, or
 * `undefined` when they are not in a section or the section does not
 * release the question right now (their practice is then unrestricted, as
 * before sections existed). Fails open like `readStudentSectionContent`.
 */
export async function readSectionDelivery(
  owner: StudentOwner,
  questionId: string,
): Promise<DeliverySettings | undefined> {
  const content = await readStudentSectionContent(owner);
  if (!content) {
    return undefined;
  }
  return findVisibleSectionRelease(content.releases, questionId)?.delivery;
}
