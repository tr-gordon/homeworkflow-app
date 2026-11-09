import { describe, expect, it } from "vitest";
import { archivedOnly, completedToArchive, isArchived, overdueToArchive, visibleOnly } from "@/lib/domain/archive";
import { buildDailyPlan, summarizeWorkload, type PlanItem } from "@/lib/domain/plan";
import { buildAttention } from "@/lib/domain/alerts";
import { buildIcs, type IcsItem } from "@/lib/domain/ics";
import type { Stage } from "@/lib/domain/stages";

const today = "2026-11-04";
type Row = PlanItem & { archivedAt: string | null };
const row = (id: string, dueDate: string, stage: Stage = "not_started", archivedAt: string | null = null): Row => ({
  id, title: id, subject: "Math", dueDate, plannedDate: null, stage, difficulty: 3, allocatedMinutes: 30, actualSeconds: 0, archivedAt,
});

const rows = [
  row("late", "2026-11-01"),
  row("late-archived", "2026-11-01", "not_started", "2026-11-03T10:00:00Z"),
  row("now", today),
  row("done", "2026-10-20", "completed"),
  row("done-archived", "2026-10-10", "completed", "2026-11-02T10:00:00Z"),
];

describe("archive helpers", () => {
  it("separates visible from archived (newest archived first)", () => {
    expect(visibleOnly(rows).map((r) => r.id)).toEqual(["late", "now", "done"]);
    expect(archivedOnly(rows).map((r) => r.id)).toEqual(["late-archived", "done-archived"]); // archived 3 Nov, then 2 Nov
    expect(isArchived(rows[1])).toBe(true);
    expect(isArchived(rows[0])).toBe(false);
  });

  it("knows what 'archive all overdue' and 'archive all completed' would hide", () => {
    expect(overdueToArchive(rows, today).map((r) => r.id)).toEqual(["late"]); // not due-today, not completed, not already archived
    expect(completedToArchive(rows).map((r) => r.id)).toEqual(["done"]);
  });

  it("archived work does not reach the plan, the attention counts or the workload tiles once filtered", () => {
    const shown = visibleOnly(rows);
    expect(buildDailyPlan(shown, today).overdue.map((r) => r.id)).toEqual(["late"]);
    expect(buildAttention(shown, today)).toMatchObject({ overdue: 1, dueToday: 1, badge: 2 });
    expect(summarizeWorkload(shown, today)).toMatchObject({ overdue: 1, completed: 1 });
    // ...whereas without filtering the archived overdue item would still nag:
    expect(buildAttention(rows, today).overdue).toBe(2);
  });
});

describe("calendar reminders", () => {
  const now = new Date("2026-11-04T15:00:00Z");
  const base: IcsItem = { id: "a1", title: "Essay", subject: "English", dueDate: "2026-11-10", plannedDate: "2026-11-08", stage: "not_started", allocatedMinutes: 30, updatedAt: "2026-11-04T12:00:00.000Z" };
  const lines = (i: IcsItem[]) => buildIcs(i, { now }).replace(/\r\n[ \t]/g, "").split("\r\n");

  it("adds the location to both events", () => {
    const l = lines([{ ...base, location: "Library" }]);
    expect(l.filter((x) => x === "LOCATION:Library")).toHaveLength(2); // due event and work-day event
  });

  it("omits LOCATION when there is none, and escapes awkward places", () => {
    expect(lines([base]).some((x) => x.startsWith("LOCATION"))).toBe(false);
    expect(lines([{ ...base, location: "Grandma's, upstairs; desk" }]).some((x) => x === "LOCATION:Grandma's\\, upstairs\; desk")).toBe(true);
  });

  it("leaves archived assignments out", () => {
    expect(lines([{ ...base, archivedAt: "2026-11-03T10:00:00Z" }]).some((x) => x.startsWith("BEGIN:VEVENT"))).toBe(false);
  });
});
