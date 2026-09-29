"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { replaceSearchParam } from "@/components/professor/professor-question-labels";
import {
  professorQuestionsTabFromParam,
  type ProfessorQuestionsTab,
} from "@/components/professor/professor-questions-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * "All questions" · "Add a question" on the question bank page. The tab lives
 * in the URL (`?tab=bank|intake`) so a reload, a shared link or the page's
 * "Add a question" button opens the same one. Both panels stay mounted: a
 * half-written draft survives a look at the list.
 */
export function ProfessorQuestionsTabs({
  bank,
  defaultTab,
  intake,
}: {
  bank: ReactNode;
  defaultTab: ProfessorQuestionsTab;
  intake: ReactNode;
}) {
  const searchParams = useSearchParams();
  const param = searchParams?.get("tab") ?? null;
  const [tab, setTab] = useState<ProfessorQuestionsTab>(defaultTab);
  const [seenParam, setSeenParam] = useState(param);
  // A link to ?tab=intake (the "Add a question" button) switches the tab even
  // when this component is already on screen.
  if (param !== seenParam) {
    setSeenParam(param);
    setTab(professorQuestionsTabFromParam(param));
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = professorQuestionsTabFromParam(value);
        setTab(next);
        replaceSearchParam("tab", next === "bank" ? undefined : next);
      }}
      className="gap-6"
    >
      <TabsList aria-label="Question bank views">
        <TabsTrigger value="bank">
          All questions
        </TabsTrigger>
        <TabsTrigger value="intake">
          Add a question
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="bank"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <h2 className="sr-only">All questions</h2>
        {bank}
      </TabsContent>
      <TabsContent
        value="intake"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        {intake}
      </TabsContent>
    </Tabs>
  );
}
