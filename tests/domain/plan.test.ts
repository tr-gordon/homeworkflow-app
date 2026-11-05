import { describe, expect, it } from "vitest";
import { addDays, describeDue, diffDays, isValidDateString, toLocalDateString } from "@/lib/domain/dates";
import { buildDailyPlan, isOverdue, summarizeWorkload, type PlanItem } from "@/lib/domain/plan";

const TODAY = "2026-11-04";

function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  return {
    title: over.id,
    subject: "Math",
    dueDate: addDays(TODAY, 5),
    plannedDate: null,
    stage: "not_started",
    difficulty: 3,
    allocatedMinutes: null,
    actualSeconds: 0,
    ...over,
  };
}

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(isValidDateString("2026-02-29")).toBe(false);
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2026-1-1")).toBe(false);
  });
  it("does arithmetic across month/DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(diffDays("2026-11-02", "2026-10-31")).toBe(2);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("formats local dates", () => {
    expect(toLocalDateString(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
  });
  it("describes due dates relative to today", () => {
    expect(describeDue(TODAY, TODAY)).toBe("Due today");
    expect(describeDue(addDays(TODAY, 1), TODAY)).toBe("Due tomorrow");
    expect(describeDue(addDays(TODAY, -3), TODAY)).toBe("3 days overdue");
  });
});

describe("overdue (D2)", () => {
  it("is overdue only when past due and not completed", () => {
    expect(isOverdue({ dueDate: "2026-11-03", stage: "halfway" }, TODAY)).toBe(true);
    expect(isOverdue({ dueDate: "2026-11-03", stage: "completed" }, TODAY)).toBe(false);
    expect(isOverdue({ dueDate: TODAY, stage: "not_started" }, TODAY)).toBe(false);
  });
});

describe("buildDailyPlan (D1)", () => {
  const items = [
    item({ id: "late", dueDate: "2026-11-01", allocatedMinutes: 30, actualSeconds: 600 }),
    item({ id: "now", dueDate: TODAY, allocatedMinutes: 20 }),
    item({ id: "planned", dueDate: addDays(TODAY, 4), plannedDate: TODAY, allocatedMinutes: 45 }),
    item({ id: "carried", dueDate: addDays(TODAY, 4), plannedDate: addDays(TODAY, -1) }),
    item({ id: "soon", dueDate: addDays(TODAY, 2) }),
    item({ id: "later", dueDate: addDays(TODAY, 3) }),
    item({ id: "future-planned", dueDate: addDays(TODAY, 1), plannedDate: addDays(TODAY, 1) }),
    item({ id: "done", dueDate: "2026-11-01", stage: "completed" }),
  ];
  const plan = buildDailyPlan(items, TODAY);

  it("sorts items into sections, each item once", () => {
    expect(plan.overdue.map((i) => i.id)).toEqual(["late"]);
    expect(plan.dueToday.map((i) => i.id)).toEqual(["now"]);
    expect(plan.plannedToday.map((i) => i.id).sort()).toEqual(["carried", "planned"]);
    expect(plan.comingUp.map((i) => i.id)).toEqual(["soon"]);
  });
  it("never includes completed work or deliberately scheduled-later items", () => {
    const all = [...plan.overdue, ...plan.dueToday, ...plan.plannedToday, ...plan.comingUp].map((i) => i.id);
    expect(all).not.toContain("done");
    expect(all).not.toContain("future-planned");
    expect(all).not.toContain("later");
  });
  it("totals planned vs actual for today's list", () => {
    expect(plan.totals.allocatedMinutes).toBe(30 + 20 + 45);
    expect(plan.totals.actualMinutes).toBe(10);
    expect(plan.totals.remainingMinutes).toBe(20 + 20 + 45);
    expect(plan.totals.unallocatedCount).toBe(1); // "carried"
  });
});

describe("summarizeWorkload", () => {
  it("counts overdue, due soon, in progress and completed", () => {
    const s = summarizeWorkload(
      [
        item({ id: "a", dueDate: "2026-11-01", stage: "halfway", allocatedMinutes: 30, actualSeconds: 900 }),
        item({ id: "b", dueDate: addDays(TODAY, 1) }),
        item({ id: "c", dueDate: addDays(TODAY, 9), stage: "getting_started" }),
        item({ id: "d", stage: "completed" }),
      ],
      TODAY,
    );
    expect(s).toMatchObject({ overdue: 1, dueSoon: 1, inProgress: 2, notStarted: 1, completed: 1 });
    expect(s.allocatedMinutes).toBe(30);
    expect(s.actualMinutes).toBe(15);
  });
});
