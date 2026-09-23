/**
 * Professor-facing destinations for courses, sections, and topics. Kept in one
 * place (like `question-paths.ts`) so cards, breadcrumbs, and the builder agree
 * on where a link lands.
 */
export function coursesIndexPath() {
  return "/professor/courses";
}

export function coursePath(courseId: string) {
  return `/professor/courses/${encodeURIComponent(courseId)}`;
}

export function courseTopicsPath(courseId: string, sectionId?: string) {
  const base = `${coursePath(courseId)}/topics`;
  if (!sectionId) return base;
  const params = new URLSearchParams({ section: sectionId });
  return `${base}?${params.toString()}`;
}

export function courseTopicPath(courseId: string, topicId: string) {
  return `${coursePath(courseId)}/topics/${encodeURIComponent(topicId)}`;
}

export function courseSectionPath(
  courseId: string,
  sectionId: string,
  tab?: "progress" | "availability" | "settings",
) {
  const base = `${coursePath(courseId)}/sections/${encodeURIComponent(sectionId)}`;
  if (!tab || tab === "progress") return base;
  const params = new URLSearchParams({ tab });
  return `${base}?${params.toString()}`;
}

/**
 * Course, section, and topic IDs are slugs. Anything else in a hand-typed URL
 * is rejected before it reaches the store.
 */
export function isCourseEntityId(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/u.test(value);
}
