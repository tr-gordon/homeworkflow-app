import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsDate, icsEscape, icsFileName, icsStamp, type IcsItem } from "@/lib/domain/ics";

const now = new Date("2026-11-04T15:30:00Z");
const base: IcsItem = {
  id: "a1",
  title: "Fractions worksheet",
  subject: "Math",
  dueDate: "2026-11-10",
  plannedDate: null,
  stage: "not_started",
  allocatedMinutes: 30,
  updatedAt: "2026-11-04T12:00:00.000Z",
};

/** Unfold per RFC 5545, then split into content lines. */
const lines = (ics: string) => ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);

describe("ics helpers", () => {
  it("formats dates and UTC stamps", () => {
    expect(icsDate("2026-11-04")).toBe("20261104");
    expect(icsStamp(now)).toBe("20261104T153000Z");
  });
  it("escapes text", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
  });
  it("folds long lines at 75 octets and unfolds back to the original", () => {
    const long = "SUMMARY:" + "x".repeat(200);
    const folded = foldLine(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
  it("never splits a multi-byte character when folding", () => {
    const long = "SUMMARY:" + "é".repeat(100) + "😀".repeat(30);
    const folded = foldLine(long);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });
  it("makes safe file names", () => {
    expect(icsFileName("Sam O'Neil", "2026-11-04")).toBe("homeworkflow-reminders-sam-o-neil-2026-11-04.ics");
    expect(icsFileName("???", "2026-11-04")).toBe("homeworkflow-reminders-homework-2026-11-04.ics");
  });
});

describe("buildIcs", () => {
  const ics = buildIcs([base], { now });
  const l = lines(ics);

  it("is a valid calendar envelope with CRLF endings", () => {
    expect(l[0]).toBe("BEGIN:VCALENDAR");
    expect(l.at(-1)).toBe("END:VCALENDAR");
    expect(l).toContain("VERSION:2.0");
    expect(l.some((x) => x.startsWith("PRODID:"))).toBe(true);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/); // no bare newlines
  });

  it("makes an all-day due event with two alarms and a stable UID", () => {
    expect(l).toContain("UID:a1-due@homeworkflow");
    expect(l).toContain("DTSTART;VALUE=DATE:20261110");
    expect(l).toContain("DTEND;VALUE=DATE:20261111");
    expect(l).toContain("SUMMARY:Due: Fractions worksheet");
    expect(l).toContain("DESCRIPTION:Math\\, planned 30 min");
    expect(l).toContain("TRANSP:TRANSPARENT");
    expect(l.filter((x) => x === "BEGIN:VALARM")).toHaveLength(2);
    expect(l).toContain("TRIGGER:-PT7H"); // 5 pm the day before
    expect(l).toContain("TRIGGER:PT7H30M"); // 7:30 am on the day
    expect(l.filter((x) => x === "ACTION:DISPLAY")).toHaveLength(2);
  });

  it("every alarm has the properties calendars require", () => {
    const text = l.join("\n");
    const alarms = text.split("BEGIN:VALARM").slice(1).map((a) => a.split("END:VALARM")[0]);
    expect(alarms.length).toBe(2);
    for (const a of alarms) expect(a).toMatch(/ACTION:DISPLAY[\s\S]*TRIGGER:.+[\s\S]*DESCRIPTION:.+/);
  });

  it("has balanced BEGIN/END blocks", () => {
    const count = (re: RegExp) => l.filter((x) => re.test(x)).length;
    expect(count(/^BEGIN:VEVENT$/)).toBe(count(/^END:VEVENT$/));
    expect(count(/^BEGIN:VALARM$/)).toBe(count(/^END:VALARM$/));
  });

  it("adds a work-day event when the work is planned for a day", () => {
    const withPlan = lines(buildIcs([{ ...base, plannedDate: "2026-11-08" }], { now }));
    expect(withPlan).toContain("UID:a1-work@homeworkflow");
    expect(withPlan).toContain("DTSTART;VALUE=DATE:20261108");
    expect(withPlan).toContain("SUMMARY:Work on: Fractions worksheet (30 min)");
    expect(withPlan).toContain("TRIGGER:PT15H30M");
  });

  it("leaves out completed assignments", () => {
    const out = lines(buildIcs([{ ...base, stage: "completed" }], { now }));
    expect(out.some((x) => x.startsWith("BEGIN:VEVENT"))).toBe(false);
  });

  it("labels someone else's homework with their name", () => {
    const out = lines(buildIcs([base], { now, who: "Sam" }));
    expect(out).toContain("SUMMARY:Sam: Due: Fractions worksheet");
    expect(out).toContain("X-WR-CALNAME:Sam's homework");
    expect(out.some((x) => x.startsWith("DESCRIPTION:Sam: Due today"))).toBe(true);
  });

  it("escapes awkward titles and keeps the text recoverable after folding", () => {
    const title = "Read ch. 1, 2; then write: \"why?\"\nDone" + " very long".repeat(15);
    const out = lines(buildIcs([{ ...base, title }], { now }));
    const summary = out.find((x) => x.startsWith("SUMMARY:"))!;
    expect(summary).toBe(`SUMMARY:Due: ${icsEscape(title)}`);
    expect(summary).not.toMatch(/\n/);
  });

  it("changes SEQUENCE when the assignment changes, so calendars take the update", () => {
    const seq = (updatedAt: string) => Number(lines(buildIcs([{ ...base, updatedAt }], { now })).find((x) => x.startsWith("SEQUENCE:"))!.slice(9));
    expect(seq("2026-11-04T13:00:00.000Z")).toBeGreaterThan(seq("2026-11-04T12:00:00.000Z"));
  });

  it("produces an empty but valid calendar when nothing is active", () => {
    const out = lines(buildIcs([], { now }));
    expect(out[0]).toBe("BEGIN:VCALENDAR");
    expect(out.some((x) => x.startsWith("BEGIN:VEVENT"))).toBe(false);
  });
});

describe("timed work blocks and 'together'", () => {
  const now2 = new Date("2026-11-04T15:00:00Z");
  const item: IcsItem = { id: "t1", title: "Science lab", subject: "Science", dueDate: "2026-11-12", plannedDate: "2026-11-08", plannedStart: "16:30", stage: "not_started", allocatedMinutes: 45, updatedAt: "2026-11-04T12:00:00.000Z" };
  const lines2 = (items: IcsItem[], o: { who?: string; onlyTogether?: boolean } = {}) => buildIcs(items, { now: now2, ...o }).replace(/\r\n[ \t]/g, "").split("\r\n");
  const workEvent = (l: string[]) => {
    const i = l.indexOf("UID:t1-work@homeworkflow");
    return l.slice(i, l.indexOf("END:VEVENT", i));
  };

  it("a start time makes a timed event as long as the planned time, with two alarms", () => {
    const ev = workEvent(lines2([item]));
    expect(ev).toContain("DTSTART:20261108T163000");
    expect(ev).toContain("DTEND:20261108T171500"); // 45 minutes later
    expect(ev.some((x) => x.includes("VALUE=DATE"))).toBe(false);
    expect(ev).toContain("TRANSP:OPAQUE"); // a real time block
    expect(ev).toContain("TRIGGER:-PT15M");
    expect(ev).toContain("TRIGGER:PT0S");
    expect(ev.filter((x) => x === "BEGIN:VALARM")).toHaveLength(2);
    expect(ev.find((x) => x.startsWith("DESCRIPTION:Work on")) ?? ev.find((x) => x.startsWith("DESCRIPTION:"))).toBeTruthy();
  });

  it("times are floating (no zone): the same local time on every phone", () => {
    const ev = workEvent(lines2([item]));
    expect(ev.find((x) => x.startsWith("DTSTART:"))).not.toMatch(/Z$/);
    expect(ev.some((x) => x.startsWith("DTSTART;TZID"))).toBe(false);
  });

  it("defaults to 30 minutes with no planned time, and carries over midnight", () => {
    expect(workEvent(lines2([{ ...item, allocatedMinutes: null }]))).toContain("DTEND:20261108T170000");
    const late = workEvent(lines2([{ ...item, plannedStart: "23:45", allocatedMinutes: 30 }]));
    expect(late).toContain("DTSTART:20261108T234500");
    expect(late).toContain("DTEND:20261109T001500");
  });

  it("the due-date event stays all-day", () => {
    const l = lines2([item]);
    const i = l.indexOf("UID:t1-due@homeworkflow");
    expect(l.slice(i, l.indexOf("END:VEVENT", i))).toContain("DTSTART;VALUE=DATE:20261112");
  });

  it("work done together is labelled, with or without a start time", () => {
    const timed = workEvent(lines2([{ ...item, withParent: true }]));
    expect(timed).toContain("SUMMARY:Together: Science lab (45 min)");
    expect(timed.some((x) => x.includes("together with a parent"))).toBe(true);
    expect(timed.some((x) => x.startsWith("DESCRIPTION:") && x.includes("Together in 15 minutes (4:30 pm)"))).toBe(true);
    const allDay = workEvent(lines2([{ ...item, withParent: true, plannedStart: null }]));
    expect(allDay).toContain("DTSTART;VALUE=DATE:20261108");
    expect(allDay).toContain("TRIGGER:PT15H30M");
    expect(allDay.some((x) => x.includes("Time to work together on Science lab"))).toBe(true);
  });

  it("a parent's calendar can hold only the work done together", () => {
    const other: IcsItem = { ...item, id: "t2", title: "Solo reading" };
    const all = lines2([{ ...item, withParent: true }, other]);
    expect(all.some((x) => x.includes("Solo reading"))).toBe(true);
    const only = lines2([{ ...item, withParent: true }, other], { onlyTogether: true });
    expect(only.some((x) => x.includes("Solo reading"))).toBe(false);
    expect(only.filter((x) => x === "BEGIN:VEVENT")).toHaveLength(2); // the together item's due event and its work block
    expect(only).toContain("UID:t1-work@homeworkflow");
  });

  it("names the student when it is someone else's homework", () => {
    expect(workEvent(lines2([{ ...item, withParent: true }], { who: "Sam" }))).toContain("SUMMARY:Sam: Together: Science lab (45 min)");
  });
});

describe("addMinutesLocal", async () => {
  const { addMinutesLocal } = await import("@/lib/domain/ics");
  it("adds minutes within a day and across midnight", () => {
    expect(addMinutesLocal("2026-11-08", "16:30", 45)).toEqual({ date: "2026-11-08", hhmm: "17:15" });
    expect(addMinutesLocal("2026-11-08", "23:59", 1)).toEqual({ date: "2026-11-09", hhmm: "00:00" });
    expect(addMinutesLocal("2026-12-31", "23:30", 60)).toEqual({ date: "2027-01-01", hhmm: "00:30" });
    expect(addMinutesLocal("2026-11-08", "00:00", 0)).toEqual({ date: "2026-11-08", hhmm: "00:00" });
    expect(addMinutesLocal("2026-11-08", "10:00", 600)).toEqual({ date: "2026-11-08", hhmm: "20:00" });
  });
});
