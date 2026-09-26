"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Archive, RefreshCw } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { coursePath } from "@/lib/courses/paths";
import type { CourseSection } from "@/lib/courses/types";

/**
 * The Settings tab: the two fields students see when they join, the join code
 * with its regenerate action, and archiving. Nothing here changes what has
 * been released.
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

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    if (trimmedLabel.length === 0) {
      setLabelError("Give the section a label, for example Sec 01.");
      return;
    }
    dispatch({
      type: "section/update",
      sectionId: section.id,
      patch: { label: trimmedLabel, meetingTime: meetingTime.trim() },
    });
    toast({ title: "Section settings saved", tone: "success" });
  }

  function archive() {
    dispatch({
      type: "section/update",
      sectionId: section.id,
      patch: { status: "archived" },
    });
    toast({
      title: `${section.label} archived`,
      description: "Released questions and student history are kept.",
      action: {
        label: "Undo",
        onClick: () =>
          dispatch({
            type: "section/update",
            sectionId: section.id,
            patch: { status: "active" },
          }),
      },
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
          <p className="type-small max-w-prose text-ink-muted">
            What a student sees when they join with the code.
          </p>
        </div>
        <form
          className="flex flex-col gap-4 rounded-panel bg-sheet p-5 sm:p-6"
          noValidate
          onSubmit={handleSave}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field error={labelError} label="Label">
              <Input
                autoComplete="off"
                name="label"
                onChange={(event) => {
                  setLabel(event.target.value);
                  setLabelError(undefined);
                }}
                placeholder="Sec 01…"
                value={label}
              />
            </Field>
            <Field label="Meeting time" optional>
              <Input
                autoComplete="off"
                name="meetingTime"
                onChange={(event) => setMeetingTime(event.target.value)}
                placeholder="MWF 10:00…"
                value={meetingTime}
              />
            </Field>
          </div>
          <div>
            <Button type="submit">Save settings</Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="section-join-code" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="section-join-code">
            Join code
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            Students type it once. Regenerating stops the old code working;
            students who already joined stay.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-panel bg-sheet p-5 sm:p-6">
          <span className="type-mono-input text-ink">{section.joinCode}</span>
          <Button
            onClick={onRegenerateJoinCode}
            type="button"
            variant="secondary"
          >
            <RefreshCw aria-hidden="true" />
            Regenerate code
          </Button>
        </div>
      </section>

      <section aria-labelledby="section-archive" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="section-archive">
            Archive
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            Removes the section from the course&rsquo;s active list and stops
            new joins. Released questions and student history are kept.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-panel bg-sheet p-5 sm:p-6">
          <Button
            disabled={archived}
            onClick={() => setConfirmingArchive(true)}
            type="button"
            variant="destructive"
          >
            <Archive aria-hidden="true" />
            {archived ? "Archived" : `Archive ${section.label}`}
          </Button>
          <p className="type-caption">
            Delivery settings (attempts, hints, solution reveal) are set per
            released question in Availability.
          </p>
        </div>
      </section>

      <ConfirmDialog
        confirmLabel={`Archive ${section.label}`}
        description={`${section.label} stops accepting joins and leaves the course's active list. Students keep their history.`}
        destructive
        onConfirm={archive}
        onOpenChange={setConfirmingArchive}
        open={confirmingArchive}
        title={`Archive ${section.label}?`}
      />
    </div>
  );
}
