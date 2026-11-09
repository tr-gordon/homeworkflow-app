"use client";

import Link from "next/link";
import { useState } from "react";
import { getRepo } from "@/lib/data";
import {
  activeSession,
  elapsedSeconds,
  formatClock,
  formatMinutes,
  isStretchCapped,
  totalActualSeconds,
} from "@/lib/domain/timer";
import type { AssignmentWithTime, TimerSession } from "@/lib/domain/types";
import { assignmentHref } from "@/lib/links";
import { errorMessage, useNow } from "@/lib/hooks";
import { Button, Card, ErrorNote } from "./ui";
import { TimeSummary } from "./TimeSummary";

/**
 * Start / pause / resume / finish. Time lives on the server: this component
 * only shows server state plus a local one-second tick, so a refresh (or another
 * device) shows the same elapsed time.
 */
export function TimerPanel({
  assignment,
  otherActive,
  onChanged,
  onFinished,
}: {
  assignment: AssignmentWithTime;
  /** The student's active timer, if it belongs to a different assignment. */
  otherActive: { session: TimerSession; title: string } | null;
  onChanged: () => void;
  onFinished?: (seconds: number) => void;
}) {
  const repo = getRepo();
  const active = activeSession(assignment.sessions);
  const running = active?.state === "running";
  const now = useNow(running ? 1000 : 30_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<TimerSession>) {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      if (result.state === "finished") onFinished?.(result.accumulatedSeconds);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const reference = now ?? new Date(assignment.updatedAt);
  const sessionSeconds = active ? elapsedSeconds(active, reference) : 0;
  const totalSeconds = totalActualSeconds(assignment.sessions, reference);
  const capped = active ? isStretchCapped(active, reference) : false;

  return (
    <Card>
      <h2 className="text-lg font-bold">Timer</h2>
      <div className="mt-3 space-y-4">
        {active ? (
          <div className="text-center">
            <p role="timer" aria-label="Elapsed time this session" className="font-mono text-5xl font-bold tabular-nums">
              {formatClock(sessionSeconds)}
            </p>
            <p className="mt-1 text-sm font-semibold text-muted">{running ? "Running" : "Paused"}</p>
            {capped ? (
              <p className="mt-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                This timer ran for a very long time, so only the first 4 hours count. Finish it when you&apos;re done.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-center gap-3">
          {!active ? (
            otherActive ? (
              <p className="text-center text-sm text-muted">
                A timer is already running for{" "}
                <Link className="font-semibold text-brand-strong underline" href={assignmentHref(otherActive.session.assignmentId)}>
                  {otherActive.title}
                </Link>
                . Finish or pause it first.
              </p>
            ) : (
              <Button disabled={busy} onClick={() => run(() => repo.timerStart(assignment.id))} className="min-w-40">
                Start timer
              </Button>
            )
          ) : null}
          {active?.state === "running" ? (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => repo.timerPause(active.id))} className="min-w-32">
              Pause
            </Button>
          ) : null}
          {active?.state === "paused" ? (
            <Button disabled={busy} onClick={() => run(() => repo.timerResume(active.id))} className="min-w-32">
              Resume
            </Button>
          ) : null}
          {active ? (
            <Button variant="secondary" disabled={busy} onClick={() => run(() => repo.timerFinish(active.id))} className="min-w-32">
              Finish
            </Button>
          ) : null}
        </div>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {running && assignment.allocatedMinutes ? (
          <p className="text-center text-sm text-muted">Alerts ring while this app is open. A locked phone or a closed app can&apos;t ring.</p>
        ) : null}

        <TimeSummary allocatedMinutes={assignment.allocatedMinutes} actualSeconds={totalSeconds} />
        {assignment.sessions.filter((s) => s.state === "finished").length > 0 ? (
          <p className="text-sm text-muted">
            {assignment.sessions.filter((s) => s.state === "finished").length} finished session(s) so far
            {totalSeconds >= 60 ? `, ${formatMinutes(totalSeconds / 60)} in total` : ""}.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
