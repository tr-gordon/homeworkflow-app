import type { TimerSession, TimerState } from "./types";

/**
 * Timer maths and state transitions (PRD R1 to R4).
 *
 * The authoritative implementation is the SQL functions in
 * supabase/migrations (server clock). This module mirrors them for display
 * (live ticking) and for DemoRepo. Keep the two in step; the database tests
 * exercise the SQL side.
 */

/** A single running stretch is capped when committed (R3). Mirrors SQL. */
export const MAX_RUNNING_STRETCH_SECONDS = 4 * 60 * 60;

export type TimerErrorCode =
  | "timer_active_exists"
  | "timer_not_running"
  | "timer_not_paused"
  | "timer_already_finished"
  | "timer_not_found";

export class TimerError extends Error {
  constructor(
    public readonly code: TimerErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "TimerError";
  }
}

function secondsBetween(fromIso: string, to: Date): number {
  const ms = to.getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 1000));
}

/** Seconds in the live (uncommitted) stretch, after applying the cap. */
export function liveStretchSeconds(session: TimerSession, now: Date): number {
  if (session.state !== "running" || !session.lastResumedAt) return 0;
  return Math.min(secondsBetween(session.lastResumedAt, now), MAX_RUNNING_STRETCH_SECONDS);
}

/** True if the live stretch has hit the cap (the user probably forgot it). */
export function isStretchCapped(session: TimerSession, now: Date): boolean {
  if (session.state !== "running" || !session.lastResumedAt) return false;
  return secondsBetween(session.lastResumedAt, now) > MAX_RUNNING_STRETCH_SECONDS;
}

export function elapsedSeconds(session: TimerSession, now: Date): number {
  return session.accumulatedSeconds + liveStretchSeconds(session, now);
}

/** Total tracked seconds across all sessions of an assignment. */
export function totalActualSeconds(sessions: readonly TimerSession[], now: Date): number {
  return sessions.reduce((sum, s) => sum + elapsedSeconds(s, now), 0);
}

export function activeSession(sessions: readonly TimerSession[]): TimerSession | undefined {
  return sessions.find((s) => s.state === "running" || s.state === "paused");
}

export function isActive(state: TimerState): boolean {
  return state === "running" || state === "paused";
}

export function newSession(
  id: string,
  assignmentId: string,
  studentId: string,
  now: Date,
): TimerSession {
  return {
    id,
    assignmentId,
    studentId,
    state: "running",
    startedAt: now.toISOString(),
    lastResumedAt: now.toISOString(),
    accumulatedSeconds: 0,
    finishedAt: null,
  };
}

export function pauseSession(session: TimerSession, now: Date): TimerSession {
  if (session.state === "finished") throw new TimerError("timer_already_finished");
  if (session.state !== "running") throw new TimerError("timer_not_running");
  return {
    ...session,
    state: "paused",
    accumulatedSeconds: elapsedSeconds(session, now),
    lastResumedAt: null,
  };
}

export function resumeSession(session: TimerSession, now: Date): TimerSession {
  if (session.state === "finished") throw new TimerError("timer_already_finished");
  if (session.state !== "paused") throw new TimerError("timer_not_paused");
  return { ...session, state: "running", lastResumedAt: now.toISOString() };
}

export function finishSession(session: TimerSession, now: Date): TimerSession {
  if (session.state === "finished") throw new TimerError("timer_already_finished");
  return {
    ...session,
    state: "finished",
    accumulatedSeconds: elapsedSeconds(session, now),
    lastResumedAt: null,
    finishedAt: now.toISOString(),
  };
}

/** "1:05:09" or "5:09". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** "45 min", "1 h 05 min", "0 min". Rounds to the nearest minute. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${String(rem).padStart(2, "0")} min`;
}
