import { minutesOfDay } from "./changes";
import { addDays, compareDates } from "./dates";
import { isDone } from "./stages";
import type { PlanItem } from "./plan";

/**
 * Alert rules (pure; no browser APIs). The browser side (sound, vibration,
 * notifications, badge) lives in src/lib/notify.ts and the host components.
 */

// ---- timer alerts -------------------------------------------------------------

/** Heads-up this long before the planned time is reached. */
export const WARNING_SECONDS = 5 * 60;
/** Skip the heads-up for short plans: with 5 min planned it would fire at once. */
export const MIN_MINUTES_FOR_WARNING = 10;

export type TimerAlertKind = "warning" | "reached";

export interface TimerAlertState {
  /** Within the last 5 minutes of the plan (and the plan is long enough for a heads-up). */
  warning: boolean;
  /** Planned time has been used up. */
  reached: boolean;
  /** Seconds past the planned time (0 until reached). */
  overSeconds: number;
}

/** What has happened so far for a timer with `elapsed` seconds against a plan. Null when there is no plan. */
export function timerAlertState(elapsedSeconds: number, allocatedMinutes: number | null): TimerAlertState | null {
  if (allocatedMinutes === null || allocatedMinutes <= 0) return null;
  const planned = allocatedMinutes * 60;
  const reached = elapsedSeconds >= planned;
  return {
    warning: allocatedMinutes >= MIN_MINUTES_FOR_WARNING && elapsedSeconds >= planned - WARNING_SECONDS,
    reached,
    overSeconds: reached ? Math.floor(elapsedSeconds - planned) : 0,
  };
}

/**
 * Which alerts should fire now, given which have already fired. If the planned
 * time is already up (for example the phone was asleep), only "reached" fires:
 * a stale "5 minutes left" would be wrong.
 */
export function alertsToFire(state: TimerAlertState | null, fired: ReadonlySet<TimerAlertKind>): TimerAlertKind[] {
  if (!state) return [];
  if (state.reached) return fired.has("reached") ? [] : ["reached"];
  return state.warning && !fired.has("warning") ? ["warning"] : [];
}

/** Unique per timer session and plan, so changing the plan later allows the alerts to fire again. */
export function alertKey(sessionId: string, allocatedMinutes: number, kind: TimerAlertKind): string {
  return `${sessionId}|${allocatedMinutes}|${kind}`;
}

export function timerAlertMessage(kind: TimerAlertKind, allocatedMinutes: number, overSeconds: number, title: string): { title: string; body: string } {
  if (kind === "warning") return { title: "5 minutes left", body: `${title}: you planned ${allocatedMinutes} min.` };
  const overMin = Math.floor(overSeconds / 60);
  return overMin < 1
    ? { title: "Planned time is up", body: `${title}: you planned ${allocatedMinutes} min. Finish up, or add time.` }
    : { title: "Past your planned time", body: `${title}: ${overMin} min over your ${allocatedMinutes} min plan.` };
}

// ---- making the alert reliable ---------------------------------------------------

/** While the "time is up" alert is on screen it repeats (beep and vibration) this often, up to MAX_REPEATS times. */
export const REPEAT_EVERY_MS = 30_000;
export const MAX_REPEATS = 10;

/** Quick extensions offered on the "time is up" alert. */
export const EXTRA_MINUTE_CHOICES = [5, 10] as const;

/** The plan after adding minutes, never above the largest allowed plan. */
export function extendedPlan(allocatedMinutes: number, extraMinutes: number, maxMinutes = 600): number {
  return Math.min(maxMinutes, Math.max(1, allocatedMinutes + extraMinutes));
}

/**
 * Hold the screen awake only while a timer with a plan is actually running: a sleeping phone
 * cannot ring. Not while paused, not without a plan, and not if the person turned it off.
 */
export function wantsWakeLock(o: { keepAwake: boolean; timerRunning: boolean; hasPlan: boolean }): boolean {
  return o.keepAwake && o.timerRunning && o.hasPlan;
}

// ---- start-time alerts ------------------------------------------------------------

/** "Starting soon" fires this many minutes before a planned start time. */
export const START_LEAD_MINUTES = 10;
/** "Time to start" still fires for this long after the start (an app opened a little late); later is stale and skipped. */
export const START_GRACE_MINUTES = 10;

export type StartAlertKind = "starting-soon" | "start-now";

export interface StartItem {
  id: string;
  title: string;
  plannedDate: string | null;
  plannedStart: string | null;
  stage: PlanItem["stage"];
  archivedAt: string | null;
  withParent: boolean;
  location: string | null;
}

export interface StartAlert<T extends StartItem> {
  kind: StartAlertKind;
  item: T;
  key: string;
  /** Whole minutes until the start (0 when it is time). */
  minutesLeft: number;
}

/** Unique per assignment, day, start time and kind: moving the start time allows the alerts to fire again. */
export const startAlertKey = (item: Pick<StartItem, "id" | "plannedDate" | "plannedStart">, kind: StartAlertKind): string =>
  `start|${item.id}|${item.plannedDate}|${item.plannedStart}|${kind}`;

/**
 * Which start-time alerts are due right now. Only for today's unfinished, unarchived work with a start time. A parent
 * (audience "parent") is only alerted for work to be done together. If the app is opened after the heads-up window,
 * only "time to start" is considered, and nothing at all once it is more than START_GRACE_MINUTES late.
 */
export function dueStartAlerts<T extends StartItem>(
  items: readonly T[],
  today: string,
  nowMinutes: number,
  hasFired: (key: string) => boolean,
  audience: "student" | "parent",
): StartAlert<T>[] {
  const out: StartAlert<T>[] = [];
  for (const item of items) {
    if (isDone(item.stage) || item.archivedAt || item.plannedDate !== today || !item.plannedStart) continue;
    if (audience === "parent" && !item.withParent) continue;
    const left = minutesOfDay(item.plannedStart) - nowMinutes;
    if (left <= 0) {
      if (left < -START_GRACE_MINUTES) continue;
      const key = startAlertKey(item, "start-now");
      if (!hasFired(key)) out.push({ kind: "start-now", item, key, minutesLeft: 0 });
    } else if (left <= START_LEAD_MINUTES) {
      const key = startAlertKey(item, "starting-soon");
      if (!hasFired(key)) out.push({ kind: "starting-soon", item, key, minutesLeft: Math.ceil(left) });
    }
  }
  return out;
}

export function startAlertMessage(a: Pick<StartAlert<StartItem>, "kind" | "item" | "minutesLeft">, who: { audience: "student" | "parent"; studentName?: string }): { title: string; body: string } {
  const { kind, item, minutesLeft } = a;
  const together = item.withParent ? (who.audience === "parent" ? ` together with ${who.studentName ?? "your child"}` : " together with a parent") : "";
  const place = item.location ? ` at ${item.location}` : "";
  const body = `${item.title}${together}${place}.`;
  if (kind === "start-now") return { title: who.audience === "parent" && item.withParent ? "Time to work together" : "Time to start", body };
  return { title: `Starting in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}`, body };
}

/**
 * Several start-time alerts can be due in the same moment (two things planned for 4:30 pm, or two children). They are
 * shown as ONE alert, so the second never hides the first. One alert reads as before; several list every item, with
 * "now" before "soon" when both kinds are present.
 */
export function combineStartAlerts<T extends StartItem>(
  entries: readonly { alert: StartAlert<T>; studentName?: string }[],
  audience: "student" | "parent",
): { title: string; body: string } | null {
  if (entries.length === 0) return null;
  const msg = (e: (typeof entries)[number]) => startAlertMessage(e.alert, { audience, studentName: e.studentName });
  if (entries.length === 1) return msg(entries[0]);

  const now = entries.filter((e) => e.alert.kind === "start-now");
  const soon = entries.filter((e) => e.alert.kind === "starting-soon");
  const allTogether = entries.every((e) => e.alert.item.withParent);
  const soonest = Math.min(...soon.map((e) => e.alert.minutesLeft));
  const title =
    now.length > 0 ? (audience === "parent" && allTogether ? "Time to work together" : "Time to start") : `Starting in ${soonest} minute${soonest === 1 ? "" : "s"}`;
  const same = now.length === 0 || soon.length === 0;
  const body = [...now, ...soon].map((e) => (same ? msg(e).body : `${e.alert.kind === "start-now" ? "Now" : `In ${e.alert.minutesLeft} min`}: ${msg(e).body}`)).join(" ");
  return { title, body };
}

// ---- due-soon and overdue -------------------------------------------------------

export interface AttentionSummary {
  overdue: number;
  dueToday: number;
  /** Titles, oldest due first, for short messages. */
  overdueTitles: string[];
  dueTodayTitles: string[];
  /** Overdue + due today: the number shown on the app icon. */
  badge: number;
}

export function buildAttention(items: readonly PlanItem[], today: string): AttentionSummary {
  const active = items.filter((i) => !isDone(i.stage)).sort((a, b) => compareDates(a.dueDate, b.dueDate) || a.title.localeCompare(b.title));
  const overdue = active.filter((i) => compareDates(i.dueDate, today) < 0);
  const dueToday = active.filter((i) => i.dueDate === today);
  return {
    overdue: overdue.length,
    dueToday: dueToday.length,
    overdueTitles: overdue.map((i) => i.title),
    dueTodayTitles: dueToday.map((i) => i.title),
    badge: overdue.length + dueToday.length,
  };
}

/** "2 overdue, 1 due today" or "" when there is nothing. */
export function attentionText(a: Pick<AttentionSummary, "overdue" | "dueToday">): string {
  const parts: string[] = [];
  if (a.overdue > 0) parts.push(`${a.overdue} overdue`);
  if (a.dueToday > 0) parts.push(`${a.dueToday} due today`);
  return parts.join(", ");
}

/** Used by the notification text: first few titles, then "and N more". */
export function titleList(titles: readonly string[], max = 3): string {
  if (titles.length <= max) return titles.join(", ");
  return `${titles.slice(0, max).join(", ")} and ${titles.length - max} more`;
}

/** Date of the day after `today`, for "due tomorrow" wording and calendar all-day ends. */
export const nextDay = (today: string): string => addDays(today, 1);
