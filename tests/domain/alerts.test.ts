import { describe, expect, it } from "vitest";
import {
  WARNING_SECONDS,
  alertKey,
  alertsToFire,
  attentionText,
  buildAttention,
  timerAlertMessage,
  timerAlertState,
  titleList,
  type TimerAlertKind,
} from "@/lib/domain/alerts";
import type { PlanItem } from "@/lib/domain/plan";

const none = new Set<TimerAlertKind>();

describe("timerAlertState", () => {
  it("is null without a plan", () => {
    expect(timerAlertState(100, null)).toBeNull();
    expect(timerAlertState(100, 0)).toBeNull();
  });

  it("warns in the last 5 minutes and reports reached at the planned time", () => {
    // 30 min plan = 1800 s
    expect(timerAlertState(1499, 30)).toMatchObject({ warning: false, reached: false });
    expect(timerAlertState(1500, 30)).toMatchObject({ warning: true, reached: false, overSeconds: 0 });
    expect(timerAlertState(1799, 30)).toMatchObject({ warning: true, reached: false });
    expect(timerAlertState(1800, 30)).toMatchObject({ reached: true, overSeconds: 0 });
    expect(timerAlertState(2100, 30)).toMatchObject({ reached: true, overSeconds: 300 });
  });

  it("skips the heads-up for plans under 10 minutes", () => {
    expect(timerAlertState(1, 5)?.warning).toBe(false);
    expect(timerAlertState(299, 5)?.warning).toBe(false);
    expect(timerAlertState(300, 5)?.reached).toBe(true);
    // Boundary: a 9 min plan gets no heads-up, a 10 min plan gets it at the 5 minute mark.
    expect(timerAlertState(4 * 60 + 30, 9)?.warning).toBe(false);
    expect(timerAlertState(WARNING_SECONDS - 1, 10)?.warning).toBe(false);
    expect(timerAlertState(WARNING_SECONDS, 10)?.warning).toBe(true);
  });
});

describe("alertsToFire", () => {
  it("fires each alert once", () => {
    const s = timerAlertState(1500, 30);
    expect(alertsToFire(s, none)).toEqual(["warning"]);
    expect(alertsToFire(s, new Set<TimerAlertKind>(["warning"]))).toEqual([]);
    const done = timerAlertState(1800, 30);
    expect(alertsToFire(done, new Set<TimerAlertKind>(["warning"]))).toEqual(["reached"]);
    expect(alertsToFire(done, new Set<TimerAlertKind>(["warning", "reached"]))).toEqual([]);
  });

  it("fires only 'reached' when the planned time is already up (phone was asleep)", () => {
    expect(alertsToFire(timerAlertState(5000, 30), none)).toEqual(["reached"]);
  });

  it("fires nothing before the heads-up window or without a plan", () => {
    expect(alertsToFire(timerAlertState(10, 30), none)).toEqual([]);
    expect(alertsToFire(null, none)).toEqual([]);
  });

  it("keys differ per session and per plan, so a longer plan can alert again", () => {
    expect(alertKey("s1", 30, "reached")).not.toBe(alertKey("s1", 45, "reached"));
    expect(alertKey("s1", 30, "reached")).not.toBe(alertKey("s2", 30, "reached"));
  });
});

describe("timerAlertMessage", () => {
  it("words each case", () => {
    expect(timerAlertMessage("warning", 30, 0, "Essay").title).toBe("5 minutes left");
    expect(timerAlertMessage("reached", 30, 20, "Essay").title).toBe("Planned time is up");
    expect(timerAlertMessage("reached", 30, 600, "Essay")).toMatchObject({ title: "Past your planned time", body: expect.stringContaining("10 min over") });
  });
});

const item = (id: string, dueDate: string, stage: PlanItem["stage"] = "not_started"): PlanItem => ({
  id,
  title: id,
  subject: "Math",
  dueDate,
  plannedDate: null,
  stage,
  difficulty: 3,
  allocatedMinutes: null,
  actualSeconds: 0,
});

describe("attention (due soon and overdue)", () => {
  const today = "2026-11-04";
  const a = buildAttention(
    [item("late-2", "2026-11-02"), item("late-1", "2026-11-03"), item("now", today), item("later", "2026-11-05"), item("done", "2026-11-01", "completed")],
    today,
  );

  it("counts overdue and due today, ignoring completed and future work", () => {
    expect(a).toMatchObject({ overdue: 2, dueToday: 1, badge: 3 });
    expect(a.overdueTitles).toEqual(["late-2", "late-1"]); // oldest first
    expect(a.dueTodayTitles).toEqual(["now"]);
  });

  it("writes short text", () => {
    expect(attentionText(a)).toBe("2 overdue, 1 due today");
    expect(attentionText({ overdue: 0, dueToday: 2 })).toBe("2 due today");
    expect(attentionText({ overdue: 0, dueToday: 0 })).toBe("");
    expect(titleList(["a", "b", "c", "d", "e"])).toBe("a, b, c and 2 more");
    expect(titleList(["a", "b"])).toBe("a, b");
  });

  it("is empty when nothing needs attention", () => {
    expect(buildAttention([item("x", "2026-12-01")], today).badge).toBe(0);
  });
});
