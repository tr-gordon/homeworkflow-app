import type { AllocationChange } from "./types";
import { formatMinutes } from "./timer";

/**
 * Field-level changes. A parent (or the student) can change the allocation AND the schedule of an assignment:
 * the work day, the start time, whether it is done together with a parent, and where. Every change is one
 * record, so history, conflict resolution ("newest change wins", per field) and the signed changes file all
 * work the same for every field.
 */

export const CHANGE_FIELDS = ["allocatedMinutes", "plannedDate", "plannedStart", "withParent", "location"] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type ChangeValue = string | number | boolean | null;

/** The fields a parent may change (everything else about an assignment is the student's). */
export const SCHEDULE_FIELDS = ["plannedDate", "plannedStart", "withParent", "location"] as const;
export type ScheduleField = (typeof SCHEDULE_FIELDS)[number];

export function isChangeField(x: unknown): x is ChangeField {
  return typeof x === "string" && (CHANGE_FIELDS as readonly string[]).includes(x);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_LOCATION = 40;
export const DEFAULT_SESSION_MINUTES = 30;

function validDate(v: string): boolean {
  const m = DATE_RE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Is `value` acceptable for `field`? Returns the normalised value (for example a trimmed place, and an
 * empty place as null) or `invalid`. Cross-field rules (a start time needs a work day) are checked by the caller.
 */
export function normalizeFieldValue(field: ChangeField, value: unknown): { ok: true; value: ChangeValue } | { ok: false } {
  switch (field) {
    case "allocatedMinutes":
      if (value === null) return { ok: true, value: null };
      return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 600 ? { ok: true, value } : { ok: false };
    case "plannedDate":
      if (value === null) return { ok: true, value: null };
      return typeof value === "string" && validDate(value) ? { ok: true, value } : { ok: false };
    case "plannedStart":
      if (value === null) return { ok: true, value: null };
      return typeof value === "string" && TIME_RE.test(value) ? { ok: true, value } : { ok: false };
    case "withParent":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "location": {
      if (value === null) return { ok: true, value: null };
      if (typeof value !== "string") return { ok: false };
      const t = value.trim();
      if (t.length > MAX_LOCATION) return { ok: false };
      return { ok: true, value: t === "" ? null : t };
    }
  }
}

/** "16:30" -> "4:30 pm". Fixed 12-hour wording so every device shows the same thing. */
export function formatClockTime(hhmm: string): string {
  if (!TIME_RE.test(hhmm)) return hhmm;
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? "am" : "pm"}`;
}

/** Minutes since midnight for "16:30" (990). */
export function minutesOfDay(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
}

const NAMES: Record<ChangeField, string> = {
  allocatedMinutes: "planned time",
  plannedDate: "work day",
  plannedStart: "start time",
  withParent: "work together",
  location: "place",
};
export const fieldName = (f: ChangeField): string => NAMES[f];

function showValue(field: ChangeField, v: ChangeValue): string {
  if (v === null) return "none";
  if (field === "allocatedMinutes") return formatMinutes(Number(v));
  if (field === "plannedStart") return formatClockTime(String(v));
  if (field === "withParent") return v ? "yes" : "no";
  return String(v);
}

/** The history sentence after the actor's name: "changed the start time from 4:00 pm to 4:30 pm". */
export function describeChange(c: Pick<AllocationChange, "field" | "oldMinutes" | "newMinutes" | "oldValue" | "newValue">): string {
  if (c.field === "allocatedMinutes") {
    if (c.oldMinutes === null && c.newMinutes !== null) return `set the time to ${formatMinutes(c.newMinutes)}`;
    if (c.newMinutes === null) return `removed the planned time (was ${formatMinutes(c.oldMinutes ?? 0)})`;
    return `changed the time from ${formatMinutes(c.oldMinutes ?? 0)} to ${formatMinutes(c.newMinutes)}`;
  }
  const name = fieldName(c.field);
  if (c.field === "withParent") return c.newValue ? "marked it as work to do together with a parent" : "marked it as work to do alone";
  if (c.newValue === null) return `cleared the ${name} (was ${showValue(c.field, c.oldValue)})`;
  if (c.oldValue === null) return `set the ${name} to ${showValue(c.field, c.newValue)}`;
  return `changed the ${name} from ${showValue(c.field, c.oldValue)} to ${showValue(c.field, c.newValue)}`;
}
