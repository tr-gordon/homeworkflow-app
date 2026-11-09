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

describe("making the timer alert reliable", () => {
  it("extends a plan by the chosen minutes, within the allowed maximum", async () => {
    const { extendedPlan, EXTRA_MINUTE_CHOICES } = await import("@/lib/domain/alerts");
    expect(extendedPlan(30, 5)).toBe(35);
    expect(extendedPlan(30, 10)).toBe(40);
    expect(extendedPlan(595, 10)).toBe(600); // never above 10 hours
    expect(extendedPlan(1, -5)).toBe(1); // never below 1 minute
    expect([...EXTRA_MINUTE_CHOICES]).toEqual([5, 10]);
  });

  it("an extended plan can alert again, because the alert key includes the plan", () => {
    const first = alertKey("s1", 30, "reached");
    const afterExtending = alertKey("s1", 40, "reached");
    expect(first).not.toBe(afterExtending);
    // old "reached" is recorded; at the new plan the state is not yet reached, then the heads-up is due again
    expect(alertsToFire(timerAlertState(2100, 40), new Set<TimerAlertKind>())).toEqual(["warning"]);
  });

  it("holds the screen awake only while a timer with a plan is running", async () => {
    const { wantsWakeLock } = await import("@/lib/domain/alerts");
    const on = { keepAwake: true, timerRunning: true, hasPlan: true };
    expect(wantsWakeLock(on)).toBe(true);
    expect(wantsWakeLock({ ...on, keepAwake: false })).toBe(false); // turned off in Settings
    expect(wantsWakeLock({ ...on, timerRunning: false })).toBe(false); // paused or none
    expect(wantsWakeLock({ ...on, hasPlan: false })).toBe(false); // nothing to alert about
  });

  it("repeats the time-is-up nudge a bounded number of times", async () => {
    const { MAX_REPEATS, REPEAT_EVERY_MS } = await import("@/lib/domain/alerts");
    expect(MAX_REPEATS * REPEAT_EVERY_MS).toBeLessThanOrEqual(10 * 60_000); // never nags for more than 10 minutes
    expect(REPEAT_EVERY_MS).toBeGreaterThanOrEqual(15_000);
  });
});

describe("start-time alerts", async () => {
  const { dueStartAlerts, startAlertKey, startAlertMessage, START_GRACE_MINUTES, START_LEAD_MINUTES } = await import("@/lib/domain/alerts");
  type Item = Parameters<typeof dueStartAlerts>[0][number];
  const today = "2026-11-08";
  const item = (over: Partial<Item> = {}): Item => ({ id: "a1", title: "Science lab", plannedDate: today, plannedStart: "16:30", stage: "not_started", archivedAt: null, withParent: false, location: null, ...over });
  const at = (h: number, m: number, s = 0) => h * 60 + m + s / 60;
  const none = () => false;
  const due = (items: Item[], nowMin: number, hasFired: (k: string) => boolean = none, audience: "student" | "parent" = "student") => dueStartAlerts(items, today, nowMin, hasFired, audience);

  it("fires the heads-up inside the lead window and 'time to start' at the start", () => {
    expect(due([item()], at(16, 19))).toEqual([]); // 11 minutes before: too early
    expect(due([item()], at(16, 20))[0]).toMatchObject({ kind: "starting-soon", minutesLeft: 10 });
    expect(due([item()], at(16, 25, 30))[0]).toMatchObject({ kind: "starting-soon", minutesLeft: 5 }); // 4.5 minutes rounds up
    expect(due([item()], at(16, 29, 30))[0]).toMatchObject({ kind: "starting-soon", minutesLeft: 1 });
    expect(due([item()], at(16, 30))[0]).toMatchObject({ kind: "start-now", minutesLeft: 0 });
    expect(START_LEAD_MINUTES).toBe(10);
  });

  it("a late open still says 'time to start' for a few minutes, then nothing (never stale)", () => {
    expect(due([item()], at(16, 30) + START_GRACE_MINUTES)[0]).toMatchObject({ kind: "start-now" });
    expect(due([item()], at(16, 30) + START_GRACE_MINUTES + 0.5)).toEqual([]);
    expect(due([item()], at(20, 0))).toEqual([]);
  });

  it("only one alert per item at a time, and each fires once", () => {
    expect(due([item()], at(16, 30))).toHaveLength(1);
    const soonKey = startAlertKey(item(), "starting-soon");
    expect(due([item()], at(16, 25), (k) => k === soonKey)).toEqual([]);
    expect(due([item()], at(16, 30), (k) => k === soonKey)[0].kind).toBe("start-now"); // heads-up done, start still due
    expect(due([item()], at(16, 30), () => true)).toEqual([]);
  });

  it("moving the start time lets the alerts fire again", () => {
    expect(startAlertKey(item(), "start-now")).not.toBe(startAlertKey(item({ plannedStart: "17:00" }), "start-now"));
    expect(startAlertKey(item(), "start-now")).not.toBe(startAlertKey(item({ plannedDate: "2026-11-09" }), "start-now"));
  });

  it("ignores work that is not today's, unfinished, unarchived and timed", () => {
    for (const x of [item({ plannedDate: "2026-11-09" }), item({ plannedDate: null }), item({ plannedStart: null }), item({ stage: "completed" }), item({ archivedAt: "2026-11-01T00:00:00Z" })]) {
      expect(due([x], at(16, 25))).toEqual([]);
    }
  });

  it("a parent is only alerted for work to be done together", () => {
    const solo = item({ id: "solo" });
    const together = item({ id: "tog", withParent: true });
    expect(due([solo, together], at(16, 25), none, "parent").map((a) => a.item.id)).toEqual(["tog"]);
    expect(due([solo, together], at(16, 25), none, "student").map((a) => a.item.id).sort()).toEqual(["solo", "tog"]);
  });

  it("words the alerts for the student and for the parent", () => {
    const t = item({ withParent: true, location: "Library" });
    expect(startAlertMessage({ kind: "starting-soon", item: t, minutesLeft: 10 }, { audience: "student" })).toEqual({ title: "Starting in 10 minutes", body: "Science lab together with a parent at Library." });
    expect(startAlertMessage({ kind: "starting-soon", item: t, minutesLeft: 1 }, { audience: "student" }).title).toBe("Starting in 1 minute");
    expect(startAlertMessage({ kind: "start-now", item: t, minutesLeft: 0 }, { audience: "parent", studentName: "Sam" })).toEqual({ title: "Time to work together", body: "Science lab together with Sam at Library." });
    expect(startAlertMessage({ kind: "start-now", item: item(), minutesLeft: 0 }, { audience: "student" })).toEqual({ title: "Time to start", body: "Science lab." });
  });
});

describe("several start-time alerts at once become one alert", async () => {
  const { combineStartAlerts, dueStartAlerts } = await import("@/lib/domain/alerts");
  const today = "2026-11-08";
  const mk = (id: string, title: string, start: string, over: Record<string, unknown> = {}) => ({ id, title, plannedDate: today, plannedStart: start, stage: "not_started" as const, archivedAt: null, withParent: false, location: null, ...over });
  const entries = (items: ReturnType<typeof mk>[], nowMin: number, audience: "student" | "parent" = "student", name = "Sam") =>
    dueStartAlerts(items, today, nowMin, () => false, audience).map((alert) => ({ alert, studentName: name }));
  const at = (h: number, m: number) => h * 60 + m;

  it("nothing due means no alert", () => {
    expect(combineStartAlerts([], "student")).toBeNull();
  });

  it("one alert reads as before", () => {
    expect(combineStartAlerts(entries([mk("a", "Science lab", "16:30", { withParent: true, location: "Library" })], at(16, 20)), "student")).toEqual({
      title: "Starting in 10 minutes",
      body: "Science lab together with a parent at Library.",
    });
  });

  it("two things at the same time are both named, so neither is hidden", () => {
    const a = combineStartAlerts(entries([mk("a", "Science lab", "16:30", { withParent: true }), mk("b", "Solo reading", "16:30")], at(16, 20)), "student")!;
    expect(a.title).toBe("Starting in 10 minutes");
    expect(a.body).toContain("Science lab together with a parent");
    expect(a.body).toContain("Solo reading");
  });

  it("uses the soonest start for the title", () => {
    const a = combineStartAlerts(entries([mk("a", "A", "16:30"), mk("b", "B", "16:33")], at(16, 25)), "student")!;
    expect(a.title).toBe("Starting in 5 minutes");
  });

  it("'time to start' leads when some are starting now and others soon, and says which is which", () => {
    const a = combineStartAlerts(entries([mk("a", "Now thing", "16:30"), mk("b", "Soon thing", "16:36")], at(16, 30)), "student")!;
    expect(a.title).toBe("Time to start");
    expect(a.body).toBe("Now: Now thing. In 6 min: Soon thing.");
  });

  it("a parent with several children hears each name", () => {
    const e = [...entries([mk("a", "Lab", "16:30", { withParent: true })], at(16, 30), "parent", "Sam"), ...entries([mk("b", "Maths", "16:30", { withParent: true })], at(16, 30), "parent", "Riley")];
    const a = combineStartAlerts(e, "parent")!;
    expect(a.title).toBe("Time to work together");
    expect(a.body).toContain("together with Sam");
    expect(a.body).toContain("together with Riley");
  });
});
