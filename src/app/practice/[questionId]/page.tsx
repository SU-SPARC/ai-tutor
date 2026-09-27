import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PracticeWorkspace } from "@/components/tutor/practice-workspace";
import { normalizeSummary } from "@/lib/api/question-serialization";
import { requirePracticePageAccess } from "@/lib/auth/practice-page-access";
import {
  getApprovedQuestionById,
  getApprovedQuestions,
  getTopics,
} from "@/lib/data/data-store";
import { getServerEnv } from "@/lib/env/server";
import { studentQuestionTitle } from "@/lib/labels";

export const dynamic = "force-dynamic";

type PracticeQuestionPageProps = {
  params: Promise<{ questionId: string }>;
  searchParams?: Promise<{ sessionId?: string | string[] }>;
};

export async function generateMetadata({
  params,
}: PracticeQuestionPageProps): Promise<Metadata> {
  const { questionId } = await params;
  const question = await getApprovedQuestionById(questionId);
  if (!question) {
    return { title: "Question not found" };
  }
  return {
    title: studentQuestionTitle(question.title),
    description: question.prompt.slice(0, 150),
  };
}

export default async function PracticeQuestionPage({
  params,
  searchParams,
}: PracticeQuestionPageProps) {
  const { questionId } = await params;
  // The learn page links "Resume" with the owned session id; anything that is
  // not a well-formed id is ignored and the stored per-question session is used.
  const requestedSessionId = (await searchParams)?.sessionId;
  const initialSessionId =
    typeof requestedSessionId === "string" &&
    /^[A-Za-z0-9:_-]{1,128}$/.test(requestedSessionId)
      ? requestedSessionId
      : undefined;
  const env = getServerEnv();
  await requirePracticePageAccess(
    env,
    `/practice/${encodeURIComponent(questionId)}`,
  );

  const question = await getApprovedQuestionById(questionId);
  if (!question) {
    notFound();
  }

  const [topics, questions] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
  ]);

  return (
    <PracticeWorkspace
      aiHelpEnabled={env.AI_ENABLED}
      initialQuestionId={question.id}
      initialSessionId={initialSessionId}
      topics={topics}
      questions={questions.map(normalizeSummary)}
    />
  );
}
