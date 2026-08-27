/**
 * Relative "time ago" labels for notification and queue rows. Display-only:
 * the value is always a real timestamp, never a stored relative string.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(at: Date | string, now: Date = new Date()): string {
  const then = typeof at === "string" ? new Date(at) : at;
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m}m ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h}h ago`;
  }
  if (diff < 30 * DAY) {
    const d = Math.floor(diff / DAY);
    return `${d}d ago`;
  }
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
