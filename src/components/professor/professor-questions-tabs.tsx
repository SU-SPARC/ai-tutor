"use client";

import { useState, type ReactNode } from "react";

import { replaceSearchParam } from "@/components/professor/professor-question-labels";
import {
  professorQuestionsTabFromParam,
  type ProfessorQuestionsTab,
} from "@/components/professor/professor-questions-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Bank · Intake on the questions page. The tab lives in the URL (`?tab=`)
 * so a reload or a shared link opens the same one. Both panels stay mounted:
 * a half-written intake draft survives a look at the bank.
 */
export function ProfessorQuestionsTabs({
  bank,
  bankCount,
  defaultTab,
  intake,
}: {
  bank: ReactNode;
  bankCount: number;
  defaultTab: ProfessorQuestionsTab;
  intake: ReactNode;
}) {
  const [tab, setTab] = useState<ProfessorQuestionsTab>(defaultTab);

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
      <TabsList aria-label="Question views">
        <TabsTrigger value="bank" count={bankCount}>
          Bank
        </TabsTrigger>
        <TabsTrigger value="intake">Intake</TabsTrigger>
      </TabsList>
      <TabsContent
        value="bank"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        <h2 className="sr-only">Question bank</h2>
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
