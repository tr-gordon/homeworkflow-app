"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { AssignmentCard } from "@/components/AssignmentCard";
import { AttentionBanner } from "@/components/AttentionBanner";
import { DailyPlanView } from "@/components/DailyPlanView";
import { Button, Card, ErrorNote, Loading } from "@/components/ui";
import { getRepo } from "@/lib/data";
import { archivedOnly, completedToArchive, visibleOnly } from "@/lib/domain/archive";
import { buildDailyPlan } from "@/lib/domain/plan";
import { toPlanItem } from "@/lib/domain/history";
import { activeSession, elapsedSeconds, formatClock, totalActualSeconds } from "@/lib/domain/timer";
import type { AssignmentWithTime, Profile } from "@/lib/domain/types";
import { assignmentHref } from "@/lib/links";
import { DATA_CHANGED_EVENT, errorMessage, useLoad, useNow, useRequireRole, useToday } from "@/lib/hooks";

function ActiveTimerBar({ assignment }: { assignment: AssignmentWithTime }) {
  const now = useNow(1000);
  const s = activeSession(assignment.sessions);
  if (!s) return null;
  return (
    <Link
      href={assignmentHref(assignment.id)}
      className="flex items-center justify-between gap-3 rounded-2xl bg-brand px-4 py-3 text-brand-contrast shadow-sm"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold opacity-90">{s.state === "running" ? "Timer running" : "Timer paused"}</span>
        <span className="block truncate font-bold">{assignment.title}</span>
      </span>
      <span role="timer" className="font-mono text-2xl font-bold tabular-nums">
        {formatClock(now ? elapsedSeconds(s, now) : s.accumulatedSeconds)}
      </span>
    </Link>
  );
}

function Dashboard({ viewer }: { viewer: Profile }) {
  const repo = getRepo();
  const today = useToday();
  const clock = useNow(30_000);
  const data = useLoad(() => repo.listAssignments(viewer.id), [viewer.id]);
  const [showDone, setShowDone] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);

  async function archive(ids: string[], what: string) {
    if (ids.length === 0 || !window.confirm(`Archive ${ids.length} ${what}? They move to Archived and stop showing alerts. You can restore them any time.`)) return;
    setOrganizeError(null);
    try {
      await repo.archiveAssignments(ids);
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    } catch (e) {
      setOrganizeError(errorMessage(e));
    }
  }

  async function restore(id: string) {
    setOrganizeError(null);
    try {
      await repo.restoreAssignment(id);
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
    } catch (e) {
      setOrganizeError(errorMessage(e));
    }
  }

  const now = useMemo(() => clock ?? new Date(0), [clock]);
  const ready = data.status === "ready" && today !== "" && clock !== null;
  const items = useMemo(() => (data.status === "ready" ? data.data : []), [data]);

  const view = useMemo(() => {
    if (!ready) return null;
    const shown = visibleOnly(items); // archived work never reaches the plan, lists or alerts
    const planItems = shown.map((a) => toPlanItem(a, now));
    const plan = buildDailyPlan(planItems, today);
    const byId = new Map(shown.map((a) => [a.id, { ...a, actualSeconds: totalActualSeconds(a.sessions, now) }]));
    const hydrate = (l: { id: string }[]) => l.map((p) => byId.get(p.id)!);
    const placed = new Set([...plan.overdue, ...plan.dueToday, ...plan.plannedToday, ...plan.comingUp].map((p) => p.id));
    return {
      plan: {
        ...plan,
        overdue: hydrate(plan.overdue),
        dueToday: hydrate(plan.dueToday),
        plannedToday: hydrate(plan.plannedToday),
        comingUp: hydrate(plan.comingUp),
      },
      upcoming: shown.filter((a) => a.stage !== "completed" && !placed.has(a.id)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      done: shown.filter((a) => a.stage === "completed").sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
      doneToArchive: completedToArchive(shown).map((a) => a.id),
      archived: archivedOnly(items),
      active: items.find((a) => activeSession(a.sessions)),
      empty: items.length === 0,
    };
  }, [ready, items, now, today]);

  if (data.status === "error") return <ErrorNote>{data.error}</ErrorNote>;
  if (!view) return <Loading label="Loading your homework" />;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Hi, {viewer.displayName.split(" ")[0]}</h1>
          <p className="text-muted">
            {new Date(today + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <Link href="/new" className="hidden md:block">
          <Button>Add assignment</Button>
        </Link>
      </div>

      <AttentionBanner viewer={viewer} />

      {view.active ? <ActiveTimerBar assignment={view.active} /> : null}

      <DailyPlanView plan={view.plan} today={today} now={now} timerBusy={Boolean(view.active)} onChanged={data.reload} />

      {view.upcoming.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-xl font-extrabold">Later</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {view.upcoming.map((a) => (
              <AssignmentCard key={a.id} assignment={a} today={today} now={now} href={assignmentHref(a.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {view.empty ? (
        <Card className="text-center">
          <p className="font-semibold">No homework yet.</p>
          <Link href="/new">
            <Button className="mt-3">Add your first assignment</Button>
          </Link>
        </Card>
      ) : null}

      {view.done.length > 0 ? (
        <section className="space-y-3">
          <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-xl text-left text-xl font-extrabold" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>
            <span>Completed ({view.done.length})</span>
            <span aria-hidden className="text-muted">{showDone ? "Hide" : "Show"}</span>
          </button>
          {showDone ? (
            <>
              <Button variant="secondary" onClick={() => archive(view.doneToArchive, "completed assignments")}>
                Archive all completed
              </Button>
              <div className="grid gap-3 md:grid-cols-2">
                {view.done.map((a) => (
                  <AssignmentCard key={a.id} assignment={a} today={today} now={now} href={assignmentHref(a.id)} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {organizeError ? <ErrorNote>{organizeError}</ErrorNote> : null}

      {view.archived.length > 0 ? (
        <section className="space-y-3">
          <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-xl text-left text-xl font-extrabold" aria-expanded={showArchived} onClick={() => setShowArchived((s) => !s)}>
            <span>Archived ({view.archived.length})</span>
            <span aria-hidden className="text-muted">{showArchived ? "Hide" : "Show"}</span>
          </button>
          {showArchived ? (
            <div className="grid gap-3 md:grid-cols-2">
              {view.archived.map((a) => (
                <AssignmentCard
                  key={a.id}
                  assignment={a}
                  today={today}
                  now={now}
                  href={assignmentHref(a.id)}
                  footer={
                    <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => restore(a.id)}>
                      Restore
                    </Button>
                  }
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default function StudentPage() {
  const viewer = useRequireRole("student");
  if (!viewer) return <Loading />;
  return (
    <AppShell viewer={viewer} active="home">
      <Dashboard viewer={viewer} />
    </AppShell>
  );
}
