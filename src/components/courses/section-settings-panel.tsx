"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Archive, RefreshCw } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { sectionLabelText } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { coursePath } from "@/lib/courses/paths";
import type { CourseSection } from "@/lib/courses/types";

/**
 * The Settings tab: the two fields students see when they join, "Make a new
 * join code" (the only place it lives), and archiving. Nothing here changes
 * which questions students see.
 */
export function SectionSettingsPanel({
  section,
  onRegenerateJoinCode,
}: {
  section: CourseSection;
  onRegenerateJoinCode: () => void;
}) {
  const { dispatch } = useCoursesStore();
  const router = useRouter();
  const [label, setLabel] = useState(section.label);
  const [meetingTime, setMeetingTime] = useState(section.meetingTime);
  const [labelError, setLabelError] = useState<string | undefined>();
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const archived = section.status === "archived";
  const name = sectionLabelText(section);

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) {
      setLabelError("Give the section a name, for example Section 1.");
      return;
    }
    dispatch({
      type: "section/update",
      sectionId: section.id,
      patch: { label: trimmedLabel, meetingTime: meetingTime.trim() },
    });
    toast({
      title: `Saved. Students see the name ${sectionLabelText(trimmedLabel)} when they join.`,
      tone: "success",
    });
  }

  function archive() {
    dispatch({
      type: "section/update",
      sectionId: section.id,
      patch: { status: "archived" },
    });
    toast({
      title: `${name} is archived.`,
      description: "Students can no longer join. Their work is kept.",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: "section/update",
            sectionId: section.id,
            patch: { status: "active" },
          }),
      },
      duration: 15_000,
    });
    router.push(coursePath(section.courseId));
  }

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="section-details" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="section-details">
            Details
          </h2>
          <p className="type-body max-w-prose text-ink-muted">
            What a student sees when they join with the code.
          </p>
        </div>
        <form
          className="flex flex-col gap-4 rounded-panel bg-sheet p-5 sm:p-6"
          noValidate
          onSubmit={handleSave}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              error={labelError}
              label="Section name, e.g. Section 1 or Tue/Thu 10am"
            >
              <Input
                autoComplete="off"
                name="label"
                onChange={(event) => {
                  setLabel(event.target.value);
                  setLabelError(undefined);
                }}
                placeholder="Section 1"
                value={label}
              />
            </Field>
            <Field label="Meeting time, e.g. MWF 10:00" optional>
              <Input
                autoComplete="off"
                name="meetingTime"
                onChange={(event) => setMeetingTime(event.target.value)}
                placeholder="MWF 10:00"
                value={meetingTime}
              />
            </Field>
          </div>
          <div>
            <Button className="min-h-11" type="submit">
              Save name and time
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="section-join-code" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="section-join-code">
            Join code
          </h2>
          <p className="type-body max-w-prose text-ink-muted">
            Students type it once. A new code stops the old one working;
            students who already joined stay. Only do this if the code was
            shared with people who should not join.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-panel bg-sheet p-5 sm:p-6">
          <span className="type-metric text-ink">{section.joinCode}</span>
          <Button
            className="min-h-11"
            onClick={onRegenerateJoinCode}
            type="button"
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" />
            Make a new join code
          </Button>
        </div>
      </section>

      <section aria-labelledby="section-archive" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="section-archive">
            Archive
          </h2>
          <p className="type-body max-w-prose text-ink-muted">
            Students can no longer join this section. Their work is kept, and
            you can restore the section from the course page.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-panel bg-sheet p-5 sm:p-6">
          <Button
            className="min-h-11"
            disabled={archived}
            onClick={() => setConfirmingArchive(true)}
            type="button"
            variant="destructive"
          >
            <Archive aria-hidden="true" />
            {archived ? "Archived" : `Archive ${name}`}
          </Button>
        </div>
      </section>

      <ConfirmDialog
        cancelLabel="Keep it"
        confirmLabel={`Archive ${name}`}
        description={`Students can no longer join ${name}; their work is kept.`}
        destructive
        onConfirm={archive}
        onOpenChange={setConfirmingArchive}
        open={confirmingArchive}
        title={`Archive ${name}?`}
      />
    </div>
  );
}
