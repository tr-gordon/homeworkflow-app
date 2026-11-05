// Dates are plain `YYYY-MM-DD` strings (no time of day, no time zone).
// "Today" is always the viewer's device-local date, passed in explicitly so
// every function here stays pure and testable.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUtcMs(date: string): number {
  if (!isValidDateString(date)) throw new RangeError(`Invalid date: ${date}`);
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y, mo - 1, d);
}

/** Local calendar date of `now` as YYYY-MM-DD. */
export function toLocalDateString(now: Date): string {
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to` (positive when `to` is later). DST-safe. */
export function diffDays(to: string, from: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const dt = new Date(toUtcMs(date) + days * 86_400_000);
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function compareDates(a: string, b: string): number {
  // Valid YYYY-MM-DD strings sort lexically.
  return a < b ? -1 : a > b ? 1 : 0;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "Fri 7 Nov". */
export function formatShortDate(date: string): string {
  const dt = new Date(toUtcMs(date));
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** Human label for a due date relative to today. */
export function describeDue(dueDate: string, today: string): string {
  const diff = diffDays(dueDate, today);
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff === -1) return "1 day overdue";
  if (diff < -1) return `${-diff} days overdue`;
  return `Due ${formatShortDate(dueDate)}`;
}
