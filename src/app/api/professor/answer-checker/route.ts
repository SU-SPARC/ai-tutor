import { NextResponse } from "next/server";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import { checkAnswer, type AnswerCheckInput } from "@/lib/tutor/answer-checker";
import { validateAnswerSpec } from "@/lib/tutor/answer/spec";

export async function POST(request: Request) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;
  const headers = { "Cache-Control": "no-store" };
  const malformed = () =>
    NextResponse.json(
      {
        error:
          "Provide a bounded answer configuration and an answer of at most 500 characters.",
      },
      { status: 400, headers },
    );
  // Stream the bounded body; Content-Length alone is not a trust boundary.
  const reader = request.body?.getReader();
  if (!reader) return malformed();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > 32768) {
      await reader.cancel();
      return malformed();
    }
    chunks.push(part.value);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return malformed();
  }
  const answer = body?.answer;
  if (
    typeof body?.studentAnswer !== "string" ||
    body.studentAnswer.length > 500 ||
    !answer ||
    typeof answer !== "object" ||
    Array.isArray(answer) ||
    !Array.isArray(answer.acceptedAnswers) ||
    answer.acceptedAnswers.length > 20 ||
    !answer.acceptedAnswers.every(
      (v: unknown) => typeof v === "string" && v.length <= 500,
    ) ||
    [answer.numericValue, answer.tolerance].some(
      (v) => v !== undefined && (typeof v !== "number" || !Number.isFinite(v)),
    ) ||
    (answer.tolerance !== undefined && answer.tolerance < 0)
  )
    return malformed();
  if (answer.spec !== undefined) {
    const issues = validateAnswerSpec(answer.spec, answer.acceptedAnswers);
    if (issues.length)
      return NextResponse.json(
        { error: issues.map((issue) => issue.message).join(" "), issues },
        { status: 400, headers },
      );
  }
  const result = checkAnswer({
    ...answer,
    studentAnswer: body.studentAnswer,
  } as AnswerCheckInput);
  return NextResponse.json(result, { headers });
}
