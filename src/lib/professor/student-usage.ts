/**
 * Presentation of the two usage metrics, for professors and for the student
 * notice that discloses them. This module reads no environment: the typed
 * server environment decides whether Sketchpad measurement is active
 * (`SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED`) and the page passes that
 * decision down, so a component test renders the same way as the page
 * without touching `process.env`.
 */
export const SKETCHPAD_MEASUREMENT_FLAG =
  "SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED";

function unit(value: number, one: string, many: string) {
  return `${value} ${value === 1 ? one : many}`;
}

/**
 * Estimated Sketchpad time in words, never abbreviated: "None yet",
 * "Under a minute", "12 minutes", "1 hour", "2 hours 5 minutes". Only shown
 * while measurement is on, so a zero here is a measured zero.
 */
export function formatActiveTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds === 0) return "None yet";
  if (seconds < 60) return "Under a minute";

  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return unit(minutes, "minute", "minutes");
  const hourText = unit(hours, "hour", "hours");
  return minutes === 0
    ? hourText
    : `${hourText} ${unit(minutes, "minute", "minutes")}`;
}

/**
 * The one sentence that tells a student what their professor sees of their
 * tool use. Professors see counts only: no professor screen or route reads
 * tutor messages or Sketchpad content. The Sketchpad clause appears exactly
 * when measurement is on, so the notice never promises or hides a number.
 */
export function studentUsageDisclosure(sketchpadMeasurementEnabled: boolean) {
  return sketchpadMeasurementEnabled
    ? "Your professor also sees how many times you asked the AI tutor and about how long you spent on the sketchpad, not what you wrote or drew."
    : "Your professor also sees how many times you asked the AI tutor, not what you wrote.";
}
