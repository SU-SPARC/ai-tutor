import { LandingHeadline } from "@/components/landing/landing-headline";
import { LandingScreen } from "@/components/landing/landing-screen";
import type { SyllabusRailTopic } from "@/components/shell/app-rail";
import { normalizeSummary } from "@/lib/api/question-serialization";
import { currentAuthenticatedUser } from "@/lib/auth/authorization";
import {
  getApprovedQuestions,
  getQuestionCounts,
  getTopics,
} from "@/lib/data/data-store";
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

  return (
    <main className="min-h-svh bg-background">
      {heroQuestion ? (
        <LandingScreen
          question={heroQuestion}
          weekNumber={heroTopic?.weekNumber ?? 1}
          railTopics={railTopics}
          railFooter={railFooter}
        />
      ) : null}
      <LandingHeadline signedIn={isSignedIn} />
    </main>
  );
}
