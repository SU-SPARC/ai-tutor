"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BarChart3, Database, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  InstructorAnalyticsDashboard,
  ProfessorAnalyticsDashboard,
} from "@/lib/types";

type AnalyticsPayload = {
  analytics?: ProfessorAnalyticsDashboard;
  error?: string;
};

export function InstructorAnalyticsPanel() {
  const [analytics, setAnalytics] =
    useState<InstructorAnalyticsDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadAnalytics() {
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/professor/analytics");
      const payload = (await response.json()) as AnalyticsPayload;

      if (!response.ok || !payload.analytics) {
        setAnalytics(null);
        setMessage(payload.error ?? "Analytics could not load.");
        return;
      }

      setAnalytics(payload.analytics.instructor);
      setMessage("Analytics loaded.");
    } catch {
      setAnalytics(null);
      setMessage("Analytics could not load.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button type="button" disabled={isLoading} onClick={loadAnalytics}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Load analytics
        </Button>
      </div>

      {message ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      {analytics ? (
        <AnalyticsDashboard analytics={analytics} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function AnalyticsDashboard({
  analytics,
}: {
  analytics: InstructorAnalyticsDashboard;
}) {
  const reviewRows = [
    ["Approved", analytics.generatedQuestions.approved],
    ["Rejected", analytics.generatedQuestions.rejected],
    ["Needs review", analytics.generatedQuestions.needsReview],
    ["Needs edit", analytics.generatedQuestions.needsEdit],
    ["Needs regeneration", analytics.generatedQuestions.needsRegeneration],
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={analytics.mode === "database" ? "success" : "secondary"}
        >
          {analytics.mode}
        </Badge>
        {analytics.notes.map((note) => (
          <Badge key={note} variant="outline" className="whitespace-normal">
            {note}
          </Badge>
        ))}
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Tutor sessions"
          value={analytics.totals.totalTutorSessions}
        />
        <MetricTile label="Attempts" value={analytics.totals.totalAttempts} />
        <MetricTile
          label="Average hints used"
          value={formatDecimal(analytics.totals.averageHintsUsed)}
        />
        <MetricTile
          label="LLM calls used"
          value={analytics.totals.llmCallsUsed}
        />
        <MetricTile
          label="Generated approved"
          value={analytics.totals.generatedQuestionsApproved}
        />
        <MetricTile
          label="Generated rejected"
          value={analytics.totals.generatedQuestionsRejected}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Most practiced topics">
          <TopicBars topics={analytics.mostPracticedTopics} />
        </Panel>

        <Panel title="Generated question review">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Questions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviewRows.map(([label, value]) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatNumber(value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </section>

      <Panel title="Most missed questions">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead className="text-right">Missed</TableHead>
              <TableHead className="text-right">Miss rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analytics.mostMissedQuestions.length === 0 ? (
              <EmptyTableRow columns={4} label="No missed-question data yet." />
            ) : (
              analytics.mostMissedQuestions.map((question) => (
                <TableRow key={question.questionId}>
                  <TableCell className="font-medium">
                    {question.questionTitle}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {question.topicTitle}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(question.missedAttempts)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatPercent(question.missRate)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>

      <Panel title="Common misconceptions">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Misconception</TableHead>
              <TableHead>Question</TableHead>
              <TableHead className="text-right">Linked misses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analytics.commonMisconceptions.length === 0 ? (
              <EmptyTableRow columns={3} label="No misconception data yet." />
            ) : (
              analytics.commonMisconceptions.map((misconception) => (
                <TableRow
                  key={`${misconception.questionId}-${misconception.misconceptionId}`}
                >
                  <TableCell className="max-w-xl">
                    {misconception.feedback}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {misconception.questionTitle}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatNumber(misconception.missedAttempts)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}

function TopicBars({
  topics,
}: {
  topics: InstructorAnalyticsDashboard["mostPracticedTopics"];
}) {
  const maxAttempts = useMemo(
    () => Math.max(1, ...topics.map((topic) => topic.attempts)),
    [topics],
  );

  if (topics.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
        No topic practice data yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {topics.map((topic) => (
        <div key={topic.topicId} className="grid gap-1">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{topic.topicTitle}</span>
            <span className="text-muted-foreground">
              {formatNumber(topic.attempts)} attempts
            </span>
          </div>
          <div className="h-2 rounded-sm bg-muted">
            <div
              className="h-2 rounded-sm bg-primary"
              style={{
                width: `${Math.max(6, (topic.attempts / maxAttempts) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-md border border-border p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium">
        <BarChart3 className="h-4 w-4" />
        {title}
      </div>
      {children}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
      <Database className="h-5 w-5" />
      <span>
        Enter the admin secret to load aggregate instructor analytics.
      </span>
    </div>
  );
}

function EmptyTableRow({ columns, label }: { columns: number; label: string }) {
  return (
    <TableRow>
      <TableCell
        colSpan={columns}
        className="py-6 text-center text-muted-foreground"
      >
        {label}
      </TableCell>
    </TableRow>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDecimal(value: number) {
  return value.toFixed(1);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
