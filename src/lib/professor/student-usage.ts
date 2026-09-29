/**
 * Professor-facing presentation of the two usage metrics. This module reads
 * no environment: the typed server environment decides whether Sketchpad
 * measurement is active (`SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED`) and the
 * page passes that decision down, so a component test renders the same way as
 * the page without touching `process.env`.
 */
export const SKETCHPAD_MEASUREMENT_FLAG =
  "SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED";

export const SKETCHPAD_NOT_YET_MEASURED = "Not yet measured";

export function formatActiveTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds === 0) return "0m";
  if (seconds < 60) return "<1m";

  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * While the external Sketchpad is not instrumented, every stored total is a
 * "nothing reported" zero rather than a measured zero, so the display says so
 * instead of rendering `0m`. Once measurement is enabled a genuine zero shows
 * as `0m` and credited buckets show as an estimated duration.
 */
export function sketchpadTimeDisplay(
  totalSeconds: number,
  measurementEnabled: boolean,
) {
  return measurementEnabled
    ? formatActiveTime(totalSeconds)
    : SKETCHPAD_NOT_YET_MEASURED;
}
