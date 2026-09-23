"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { coursePath } from "@/lib/courses/paths";
import type { CourseSection } from "@/lib/courses/types";

export function SectionSettingsPanel({
  section,
  onRegenerateJoinCode,
}: {
  section: CourseSection;
  onRegenerateJoinCode: () => void;
}) {
  const { dispatch } = useCoursesStore();
  const router = useRouter();
  const fieldId = useId();
  const [label, setLabel] = useState(section.label);
  const [meetingTime, setMeetingTime] = useState(section.meetingTime);
  const [saved, setSaved] = useState(false);

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({
      type: "section/update",
      sectionId: section.id,
      patch: { label: label.trim(), meetingTime: meetingTime.trim() },
    });
    setSaved(true);
  }

  function handleArchive() {
    const confirmed = window.confirm(
      `Archive ${section.label}? Students keep their history, but the section stops accepting new joins and disappears from the course's active list.`,
    );
    if (!confirmed) {
      return;
    }
    dispatch({
      type: "section/update",
      sectionId: section.id,
      patch: { status: "archived" },
    });
    router.push(coursePath(section.courseId));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Section settings</CardTitle>
        <CardDescription>
          The label and meeting time are what a student sees when they join with
          the code. Nothing here changes what has been released.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form className="flex flex-col gap-4" onSubmit={handleSave}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm font-medium"
                htmlFor={`${fieldId}-label`}
              >
                Label
              </label>
              <Input
                id={`${fieldId}-label`}
                onChange={(event) => {
                  setLabel(event.target.value);
                  setSaved(false);
                }}
                placeholder="Sec 01"
                value={label}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm font-medium"
                htmlFor={`${fieldId}-meeting`}
              >
                Meeting time
              </label>
              <Input
                id={`${fieldId}-meeting`}
                onChange={(event) => {
                  setMeetingTime(event.target.value);
                  setSaved(false);
                }}
                placeholder="MWF 10:00"
                value={meetingTime}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit">Save</Button>
            {saved ? (
              <span className="text-sm text-success">Saved.</span>
            ) : null}
          </div>
        </form>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Join code</span>
            <span className="text-sm text-muted-foreground">
              Students type this once to join. Regenerating breaks the old one.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-md border border-border px-3 py-1.5 font-mono text-sm">
              {section.joinCode}
            </span>
            <Button onClick={onRegenerateJoinCode} size="sm" variant="outline">
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </Button>
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Archive section</span>
            <span className="text-sm text-muted-foreground">
              Removes it from the course&rsquo;s active sections. Released
              questions and student history are kept.
            </span>
          </div>
          <Button
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={section.status === "archived"}
            onClick={handleArchive}
            variant="outline"
          >
            {section.status === "archived" ? "Archived" : "Archive section"}
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Delivery defaults (attempts, hints, solution reveal) are set per
          released question in Availability.
        </p>
      </CardContent>
    </Card>
  );
}
