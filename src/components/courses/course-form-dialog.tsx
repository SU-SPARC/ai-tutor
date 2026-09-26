"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { useCoursesStore } from "@/components/courses/courses-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
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
 * One dialog for both "New course" and "Clone course", because the fields are
 * the same three and only the consequence differs. Built on the shared
 * `Dialog` (focus trap, inert page, Escape), with focus returned to the button
 * that opened it.
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
  const termRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const source = sourceCourseId ? getCourse(state, sourceCourseId) : undefined;
  const [code, setCode] = useState(source?.code ?? DEFAULT_CODE);
  const [title, setTitle] = useState(source?.title ?? DEFAULT_TITLE);
  const [term, setTerm] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const cloning = mode === "clone";
  const codeError =
    showErrors && code.trim().length === 0
      ? "Enter the course code, for example MATH-255."
      : undefined;
  const termError =
    showErrors && term.trim().length === 0
      ? "Enter a term, for example Spring 2027."
      : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextCode = code.trim();
    const nextTerm = term.trim();
    if (nextCode.length === 0 || nextTerm.length === 0) {
      // Say what is missing next to the field and put the cursor there,
      // rather than greying out the button without a reason.
      setShowErrors(true);
      (nextCode.length === 0 ? codeRef : termRef).current?.focus();
      return;
    }
    if (cloning && !source) {
      return;
    }
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
    onClose();
    router.push(coursePath(id));
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          // Code and title arrive filled in; the term is the one field left.
          event.preventDefault();
          termRef.current?.focus();
        }}
        size="md"
      >
        <form className="flex min-h-0 flex-1 flex-col" noValidate onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{cloning ? "Clone course" : "New course"}</DialogTitle>
            <DialogDescription>
              {cloning
                ? "A clone copies topics and sections with new join codes. The question bank stays shared."
                : `One course per offering. It starts with all ${state.topics.length} syllabus topics in their usual order.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {cloning && source ? (
              <p className="type-small max-w-prose rounded-control bg-surface-tint px-3 py-2 text-ink">
                Cloning {source.code} · {source.term}. Released questions come
                across as held, so you release them again on purpose.
              </p>
            ) : null}
            <Field error={codeError} label="Course code">
              <Input
                autoComplete="off"
                name="code"
                onChange={(event) => setCode(event.target.value)}
                placeholder={`${DEFAULT_CODE}…`}
                ref={codeRef}
                spellCheck={false}
                value={code}
              />
            </Field>
            <Field label="Title">
              <Input
                autoComplete="off"
                name="title"
                onChange={(event) => setTitle(event.target.value)}
                placeholder={`${DEFAULT_TITLE}…`}
                value={title}
              />
            </Field>
            <Field
              description="Required. It tells two offerings of the same course apart."
              error={termError}
              label="Term"
            >
              <Input
                autoComplete="off"
                name="term"
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Spring 2027…"
                ref={termRef}
                value={term}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">
              {cloning ? "Clone course" : "Create course"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
