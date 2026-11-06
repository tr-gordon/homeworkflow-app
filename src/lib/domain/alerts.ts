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
