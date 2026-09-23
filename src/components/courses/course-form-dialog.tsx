"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { coursePath } from "@/lib/courses/paths";
import { getCourse } from "@/lib/courses/selectors";
import type { CourseId } from "@/lib/courses/types";

export type CourseFormMode = "create" | "clone";

/** What the index and the overview pass around to open this dialog. */
export type CourseFormRequest = {
  mode: CourseFormMode;
  sourceCourseId?: CourseId;
};

const DEFAULT_CODE = "MATH-255";
const DEFAULT_TITLE = "Probability & Statistics";

/**
 * `math-255-fall-2027`. The id is derived from what the professor typed so a
 * shared URL reads like the course, and a numeric suffix keeps a second offering
 * with the same name from colliding with the first.
 */
export function nextCourseId(code: string, term: string, taken: Set<string>) {
  const base =
    `${code}-${term}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "course";
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/**
 * One dialog for both "New course" and "Clone last term", because the fields are
 * the same three and only the consequence differs. Built on the native
 * `<dialog>` element: `showModal()` gives the focus trap, the inert background,
 * and Escape for free, so nothing here re-implements them.
 *
 * Mounted only while open, so the fields always start from the defaults for the
 * mode rather than from whatever the last open left behind.
 */
export function CourseFormDialog({
  mode,
  onClose,
  sourceCourseId,
}: {
  mode: CourseFormMode;
  onClose: () => void;
  sourceCourseId?: CourseId;
}) {
  const { state, dispatch } = useCoursesStore();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const codeId = useId();
  const nameId = useId();
  const termId = useId();

  const source = sourceCourseId ? getCourse(state, sourceCourseId) : undefined;
  const [code, setCode] = useState(source?.code ?? DEFAULT_CODE);
  const [title, setTitle] = useState(source?.title ?? DEFAULT_TITLE);
  const [term, setTerm] = useState("");

  useEffect(() => {
    // Remembered before the modal steals focus, restored in `onClose` below, so
    // Escape puts the professor back on the button they came from.
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const cloning = mode === "clone";
  const canSubmit = code.trim().length > 0 && term.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || (cloning && !source)) {
      return;
    }
    const nextCode = code.trim();
    const nextTerm = term.trim();
    const nextTitle = title.trim() || DEFAULT_TITLE;
    const id = nextCourseId(
      nextCode,
      nextTerm,
      new Set(state.courses.map((course) => course.id)),
    );

    if (cloning && source) {
      dispatch({
        type: "course/clone",
        sourceCourseId: source.id,
        newCourse: { id, code: nextCode, title: nextTitle, term: nextTerm },
        now: SEED_NOW,
      });
    } else {
      dispatch({
        type: "course/create",
        course: {
          id,
          code: nextCode,
          title: nextTitle,
          term: nextTerm,
          status: "active",
        },
        includeAllTopics: true,
        now: SEED_NOW,
      });
    }
    dispatch({ type: "course/setActive", courseId: id });
    dialogRef.current?.close();
    router.push(coursePath(id));
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-foreground/40"
      onClick={(event) => {
        // A click that lands on the dialog element itself is a click on the
        // backdrop: everything inside sits in the padded wrapper below.
        if (event.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
      onClose={() => {
        returnFocusRef.current?.focus();
        onClose();
      }}
      ref={dialogRef}
    >
      <form className="flex flex-col gap-5 p-6" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold" id={titleId}>
            {cloning ? "Clone course" : "New course"}
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {cloning
              ? "A clone is a new offering, not a copy of the question bank. Questions stay shared."
              : "One course per offering. It starts with all 11 canonical topics included, in canonical order."}
          </p>
        </div>

        {cloning && source ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
            Cloning from {source.code} · {source.term} — copies topics and
            sections with new join codes; released questions are copied as held
            so you re-release deliberately.
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor={codeId}>
              Course code
            </label>
            <Input
              id={codeId}
              onChange={(event) => setCode(event.target.value)}
              placeholder={DEFAULT_CODE}
              value={code}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor={nameId}>
              Title
            </label>
            <Input
              id={nameId}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={DEFAULT_TITLE}
              value={title}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor={termId}>
              Term
            </label>
            <Input
              autoFocus
              id={termId}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Spring 2027"
              value={term}
            />
            <p className="text-xs text-muted-foreground">
              The term is what tells two offerings apart, so it is required.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button
            onClick={() => dialogRef.current?.close()}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button disabled={!canSubmit} type="submit">
            {cloning ? "Clone course" : "Create course"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
