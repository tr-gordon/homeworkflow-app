import { addDays } from "./dates";
import { isDone } from "./stages";
import type { Stage } from "./stages";

/**
 * Calendar reminders as an iCalendar (.ics) file (RFC 5545). The phone's own
 * calendar app fires the alarms, so they work even when HomeworkFlow is closed
 * and without any server. Everything is derived from the data on the device.
 *
 * Times are fixed, simple choices (no time of day is stored for homework):
 *   due date   : all-day event; alarms at 5 pm the day before and 7:30 am that day
 *   work day   : all-day event on the planned date; alarm at 3:30 pm
 * Re-importing the same file updates events (stable UID + SEQUENCE). Calendars do not
 * delete events for assignments that were removed or completed since.
 */

export interface IcsItem {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  plannedDate: string | null;
  stage: Stage;
  allocatedMinutes: number | null;
  updatedAt: string;
}

export interface IcsOptions {
  now: Date;
  /** Shown as the calendar name and prefixed to titles when exporting someone else's homework, e.g. "Sam". */
  who?: string;
}

const CRLF = "\r\n";

/** "2026-11-04" -> "20261104". */
export const icsDate = (d: string): string => d.replace(/-/g, "");

/** UTC timestamp, "20261104T153000Z". */
export function icsStamp(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** TEXT escaping: backslash, semicolon, comma and newlines. */
export function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets (RFC 5545 section 3.1) without splitting a multi-byte character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74; // continuation lines start with one space
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join(CRLF + " ");
}

/** A monotonic integer that changes whenever the assignment does (calendars use it to pick the newer copy). */
function sequenceOf(updatedAt: string): number {
  const ms = Date.parse(updatedAt);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000) % 2_147_483_647;
}

function alarm(trigger: string, description: string): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trigger}`, `DESCRIPTION:${icsEscape(description)}`, "END:VALARM"];
}

function event(opts: {
  uid: string;
  stamp: string;
  item: IcsItem;
  date: string;
  summary: string;
  description: string;
  alarms: string[][];
}): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${opts.stamp}`,
    `LAST-MODIFIED:${icsStamp(new Date(opts.item.updatedAt))}`,
    `SEQUENCE:${sequenceOf(opts.item.updatedAt)}`,
    `DTSTART;VALUE=DATE:${icsDate(opts.date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(opts.date, 1))}`,
    `SUMMARY:${icsEscape(opts.summary)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    "TRANSP:TRANSPARENT", // all-day reminders should not make the person look busy
    ...opts.alarms.flat(),
    "END:VEVENT",
  ];
}

/** The .ics text (CRLF line endings, folded). Completed assignments are left out. */
export function buildIcs(items: readonly IcsItem[], opts: IcsOptions): string {
  const stamp = icsStamp(opts.now);
  const prefix = opts.who ? `${opts.who}: ` : "";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HomeworkFlow//Homework reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.who ? `${opts.who}'s homework` : "Homework")}`,
  ];

  for (const item of items) {
    if (isDone(item.stage)) continue;
    const detail = [item.subject, item.allocatedMinutes ? `planned ${item.allocatedMinutes} min` : null].filter(Boolean).join(", ");
    lines.push(
      ...event({
        uid: `${item.id}-due@homeworkflow`,
        stamp,
        item,
        date: item.dueDate,
        summary: `${prefix}Due: ${item.title}`,
        description: detail,
        alarms: [alarm("-PT7H", `${prefix}Due tomorrow: ${item.title}`), alarm("PT7H30M", `${prefix}Due today: ${item.title}`)],
      }),
    );
    if (item.plannedDate) {
      lines.push(
        ...event({
          uid: `${item.id}-work@homeworkflow`,
          stamp,
          item,
          date: item.plannedDate,
          summary: `${prefix}Work on: ${item.title}${item.allocatedMinutes ? ` (${item.allocatedMinutes} min)` : ""}`,
          description: detail,
          alarms: [alarm("PT15H30M", `${prefix}Time to work on ${item.title}`)],
        }),
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** "homeworkflow-reminders-sam-2026-11-04.ics" */
export function icsFileName(who: string, today: string): string {
  const safe = who.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "homework";
  return `homeworkflow-reminders-${safe}-${today}.ics`;
}
