"use client";

import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------ */
/* Time: always the browser's local zone, with its short name.          */
/* The server (and the first client render) uses UTC so the markup      */
/* matches; the browser then swaps in local time.                       */
/* ------------------------------------------------------------------ */

const noopSubscribe = () => () => {};

/** `false` on the server and during hydration, `true` afterwards. */
export function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function validDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  // Missing or epoch-0 dates render as nothing, never 1969/1970.
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return undefined;
  return date;
}

/** "Mon 6 Oct" in the browser's time zone (UTC before hydration). */
export function formatLocalDate(value: string | undefined, isClient: boolean) {
  const date = validDate(value);
  if (!date) return "";
  const timeZone = isClient ? undefined : "UTC";
  const now = new Date();
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    timeZone,
  }).format(date);
}

/** "Mon 6 Oct, 9:00 AM EDT" in the browser's time zone. */
export function formatLocalTime(value: string | undefined, isClient: boolean) {
  const date = validDate(value);
  if (!date) return "";
  const timeZone = isClient ? undefined : "UTC";
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
  return `${formatLocalDate(value, isClient)}, ${time}`;
}

/** The browser's short time zone name ("EDT"), for form hints. */
export function localZoneName() {
  const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((item) => item.type === "timeZoneName");
  return part?.value ?? "local time";
}

/**
 * An instant printed in the reader's own time zone, for server components
 * that cannot know it: "Mon 6 Oct" (`date`) or "Mon 6 Oct, 9:00 AM EDT"
 * (`datetime`). Renders inside a `<time>` with the ISO value.
 */
export function LocalDate({
  iso,
  format = "date",
}: {
  format?: "date" | "datetime";
  iso: string;
}) {
  const isClient = useIsClient();
  const text =
    format === "datetime"
      ? formatLocalTime(iso, isClient)
      : formatLocalDate(iso, isClient);
  if (!text) return null;
  return <time dateTime={iso}>{text}</time>;
}
