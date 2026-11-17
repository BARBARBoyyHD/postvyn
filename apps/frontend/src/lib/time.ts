/**
 * Time, shown to a human.
 *
 * Timestamps are unix-ms UTC everywhere in storage; only display converts. Two displays matter in this
 * milestone: a slot in the workspace's zone (a due list sorted in UTC is a due list nobody trusts) and
 * an attempt's duration (the difference between "stuck" and "slow").
 */

/** Value for `<input type="datetime-local">`: the browser's own zone, which is what the picker means. */
export function slotInputValue(instant: number | null): string {
  const date = instant === null ? tomorrowAtNine() : new Date(instant);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The workspace's `timezone` is data from a row, so a bad value falls back to UTC rather than throwing. */
export function formatInZone(instant: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(instant));
  } catch {
    return `${new Date(instant).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

/** `1.4s` for a normal attempt, `running` while one is in flight, `null` before the first attempt. */
export function formatAttemptDuration(
  started: number | null,
  finished: number | null,
): string | null {
  if (started === null) return null;
  if (finished === null) return "running";
  const seconds = (finished - started) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds / 60)}m`;
}

/** Tomorrow at 09:00 local, which is the answer nine times out of ten. */
function tomorrowAtNine(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}
