import { describe, expect, it } from "vitest";
import { describeChange, formatClockTime, minutesOfDay, normalizeFieldValue, SCHEDULE_FIELDS, isChangeField, type ChangeField, type ChangeValue } from "@/lib/domain/changes";

describe("normalizeFieldValue", () => {
  const ok = (f: ChangeField, v: unknown) => normalizeFieldValue(f, v);

  it("allocation: whole minutes 1 to 600, or none", () => {
    expect(ok("allocatedMinutes", 30)).toEqual({ ok: true, value: 30 });
    expect(ok("allocatedMinutes", null)).toEqual({ ok: true, value: null });
    for (const bad of [0, 601, 12.5, "30", true]) expect(ok("allocatedMinutes", bad).ok).toBe(false);
  });

  it("work day: a real calendar date, or none", () => {
    expect(ok("plannedDate", "2026-11-08")).toEqual({ ok: true, value: "2026-11-08" });
    for (const bad of ["2026-02-30", "2026-1-1", "tomorrow", 20261108]) expect(ok("plannedDate", bad).ok).toBe(false);
  });

  it("start time: 24 hour HH:MM, or none", () => {
    for (const good of ["00:00", "09:05", "16:30", "23:59"]) expect(ok("plannedStart", good)).toEqual({ ok: true, value: good });
    for (const bad of ["24:00", "9:30", "12:60", "16:30:00", "4pm", 1630]) expect(ok("plannedStart", bad).ok).toBe(false);
  });

  it("together: only true or false", () => {
    expect(ok("withParent", true)).toEqual({ ok: true, value: true });
    expect(ok("withParent", false)).toEqual({ ok: true, value: false });
    for (const bad of [null, "yes", 1, 0]) expect(ok("withParent", bad).ok).toBe(false);
  });

  it("place: trimmed, empty means none, 40 characters at most", () => {
    expect(ok("location", "  Library ")).toEqual({ ok: true, value: "Library" });
    expect(ok("location", "   ")).toEqual({ ok: true, value: null });
    expect(ok("location", "x".repeat(40)).ok).toBe(true);
    expect(ok("location", "x".repeat(41)).ok).toBe(false);
    expect(ok("location", 5).ok).toBe(false);
  });

  it("knows the schedule fields a parent may change", () => {
    expect([...SCHEDULE_FIELDS].sort()).toEqual(["location", "plannedDate", "plannedStart", "withParent"]);
    expect(isChangeField("allocatedMinutes")).toBe(true);
    expect(isChangeField("title")).toBe(false); // a parent can never change these
    expect(isChangeField("stage")).toBe(false);
    expect(isChangeField(undefined)).toBe(false);
  });
});

describe("times", () => {
  it("writes 12-hour times the same on every device", () => {
    expect(formatClockTime("00:00")).toBe("12:00 am");
    expect(formatClockTime("00:05")).toBe("12:05 am");
    expect(formatClockTime("09:30")).toBe("9:30 am");
    expect(formatClockTime("12:00")).toBe("12:00 pm");
    expect(formatClockTime("16:30")).toBe("4:30 pm");
    expect(formatClockTime("23:59")).toBe("11:59 pm");
    expect(formatClockTime("nonsense")).toBe("nonsense");
  });
  it("converts to minutes of the day", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("16:30")).toBe(990);
    expect(minutesOfDay("23:59")).toBe(1439);
  });
});

describe("describeChange (history sentence)", () => {
  const c = (field: ChangeField, over: Partial<{ oldMinutes: number | null; newMinutes: number | null; oldValue: ChangeValue; newValue: ChangeValue }>) => ({
    field,
    oldMinutes: null,
    newMinutes: null,
    oldValue: null,
    newValue: null,
    ...over,
  });

  it("keeps the allocation wording from before", () => {
    expect(describeChange(c("allocatedMinutes", { newMinutes: 40 }))).toBe("set the time to 40 min");
    expect(describeChange(c("allocatedMinutes", { oldMinutes: 30, newMinutes: 45 }))).toBe("changed the time from 30 min to 45 min");
    expect(describeChange(c("allocatedMinutes", { oldMinutes: 30 }))).toBe("removed the planned time (was 30 min)");
  });

  it("describes the schedule fields", () => {
    expect(describeChange(c("plannedStart", { newValue: "16:30" }))).toBe("set the start time to 4:30 pm");
    expect(describeChange(c("plannedStart", { oldValue: "16:00", newValue: "16:30" }))).toBe("changed the start time from 4:00 pm to 4:30 pm");
    expect(describeChange(c("plannedStart", { oldValue: "16:00" }))).toBe("cleared the start time (was 4:00 pm)");
    expect(describeChange(c("plannedDate", { newValue: "2026-11-08" }))).toBe("set the work day to 2026-11-08");
    expect(describeChange(c("location", { oldValue: "Home", newValue: "Library" }))).toBe("changed the place from Home to Library");
    expect(describeChange(c("withParent", { newValue: true }))).toBe("marked it as work to do together with a parent");
    expect(describeChange(c("withParent", { newValue: false }))).toBe("marked it as work to do alone");
  });
});
