import {
  LANDING_COLUMN,
  LandingFooter,
  LandingHeadline,
  LandingStatements,
} from "@/components/landing/landing-headline";
import { LandingHowItWorks } from "@/components/landing/landing-how-it-works";
import { LandingScreen } from "@/components/landing/landing-screen";
import type { SyllabusRailTopic } from "@/components/shell/app-rail";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { EmptyState } from "@/components/ui/empty-state";
import { normalizeSummary } from "@/lib/api/question-serialization";
import { currentAuthenticatedUser } from "@/lib/auth/authorization";
import {
  getApprovedQuestions,
  getQuestionCounts,
  getTopics,
} from "@/lib/data/data-store";
import { getServerEnv } from "@/lib/env/server";
import type { CourseTopic, StudentPracticeQuestion } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The hero is a real question, so it has to be the *same* real question on
 * every render — a rotating hero would mean a visitor who reloads loses the
 * answer they were half way through typing.
 *
 * Third topic with questions, first question in it: the first two topics of a
 * probability course are set-up (Venn diagrams, axioms), and the third is
 * where the subject starts being interesting. Falls back to the very first
 * question while the course is still filling up.
 */
export function heroQuestionFor(
  topics: readonly CourseTopic[],
  questions: readonly StudentPracticeQuestion[],
  countsByTopic: Record<string, number>,
) {
  const topicsWithQuestions = topics.filter(
    (topic) => (countsByTopic[topic.id] ?? 0) > 0,
  );
  const preferredTopicId = topicsWithQuestions[2]?.id;
  const preferred = preferredTopicId
    ? questions.find((question) => question.topicId === preferredTopicId)
    : undefined;
  return preferred ?? questions[0];
}

/**
 * Whether a section code takes the demo's ghost student door. Read
 * defensively: the landing page must render even when the environment is
 * incomplete, and then the code simply goes to the syllabus.
 */
function ghostLoginEnabled() {
  try {
    return getServerEnv().GHOST_LOGIN_ENABLED;
  } catch {
    return false;
  }
}

function canonicalOrder(topics: readonly CourseTopic[]) {
  return [...topics].sort((left, right) => left.order - right.order);
}

export default async function HomePage() {
  const [topics, counts, questions, isSignedIn] = await Promise.all([
    getTopics(),
    getQuestionCounts(),
    getApprovedQuestions().then((approved) => approved.map(normalizeSummary)),
    currentAuthenticatedUser()
      .then((principal) => Boolean(principal))
      // Header decoration must not make the public landing page unavailable
      // when identity storage is temporarily unreachable.
      .catch(() => false),
  ]);

  const orderedTopics = canonicalOrder(topics);
  const topicIndex = new Map(
    orderedTopics.map((topic, index) => [topic.id, index] as const),
  );
  // Questions in syllabus order, so "the first question" means the earliest
  // one in the course rather than the earliest one in the database.
  const orderedQuestions = [...questions].sort(
    (left, right) =>
      (topicIndex.get(left.topicId) ?? Number.MAX_SAFE_INTEGER) -
      (topicIndex.get(right.topicId) ?? Number.MAX_SAFE_INTEGER),
  );

  const heroQuestion = heroQuestionFor(
    orderedTopics,
    orderedQuestions,
    counts.byTopic,
  );
  const heroTopic = orderedTopics.find(
    (topic) => topic.id === heroQuestion?.topicId,
  );

  // Every topic is a row, including the empty ones: skipping them would make
  // the week numbers jump, and a student would wonder what happened to Week 5.
  const railTopics: SyllabusRailTopic[] = orderedTopics.map((topic) => {
    const count = counts.byTopic[topic.id] ?? 0;
    return {
      glyph: count > 0 ? "todo" : "closed",
      href: `/learn/${topic.id}`,
      id: topic.id,
      meta: count > 0 ? undefined : "no questions yet",
      title: topic.title,
      weekNumber: topic.weekNumber,
    };
  });
  const railFooter = `${counts.total} question${
    counts.total === 1 ? "" : "s"
  } · ${orderedTopics.length} topic${orderedTopics.length === 1 ? "" : "s"}`;

  const continueNote =
    counts.total > 0
      ? `Your syllabus has ${counts.total} practice question${
          counts.total === 1 ? "" : "s"
        } from your professor.`
      : undefined;

  // The landing page does not use ThreeColumn, so it renders the one <main>
  // itself (the skip link's target). Headline and the section-code door
  // first, then the sheet (live signed in, a locked preview signed out), then how it works and two statements; the
  // footer sits outside <main>.
  return (
    <>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="bg-surface outline-none"
      >
        <LandingHeadline
          signedIn={isSignedIn}
          ghostLoginEnabled={ghostLoginEnabled()}
          continueNote={continueNote}
        />
        {heroQuestion ? (
          <LandingScreen
            question={heroQuestion}
            weekNumber={heroTopic?.weekNumber ?? 1}
            railTopics={railTopics}
            railFooter={railFooter}
            // Signed out, the question is a preview: readable, not
            // answerable, until the visitor signs in or joins a section.
            locked={!isSignedIn}
          />
        ) : (
          <div className={LANDING_COLUMN}>
            <EmptyState>
              Your professor has not published any practice questions yet.
            </EmptyState>
          </div>
        )}
        <LandingHowItWorks />
        <LandingStatements />
      </main>
      <LandingFooter />
    </>
  );
}
