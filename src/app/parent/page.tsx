"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AllocationEditor } from "@/components/AllocationEditor";
import { AppShell } from "@/components/AppShell";
import { AssignmentCard } from "@/components/AssignmentCard";
import { AttentionBanner } from "@/components/AttentionBanner";
import { Button, Card, ErrorNote, Loading } from "@/components/ui";
import { getRepo } from "@/lib/data";
import { archivedOnly, visibleOnly } from "@/lib/domain/archive";
import { addDays, compareDates } from "@/lib/domain/dates";
import { toPlanItem } from "@/lib/domain/history";
import { isOverdue, summarizeWorkload } from "@/lib/domain/plan";
import { formatMinutes } from "@/lib/domain/timer";
import type { AssignmentWithTime, Profile } from "@/lib/domain/types";
import { assignmentHref } from "@/lib/links";
import { useDevice, useLoad, useNow, useRequireRole, useToday } from "@/lib/hooks";

type Filter = "attention" | "active" | "completed" | "archived";

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" | "warn" }) {
  return (
    <div className={`rounded-2xl border bg-surface p-3 ${tone === "danger" ? "border-danger" : "border-border"}`}>
      <p className={`text-3xl font-extrabold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</p>
      <p className="text-sm font-semibold text-muted">{label}</p>
    </div>
  );
}

/** Parent device: how old the student's data is, and whether changes are waiting to be sent. */
function Freshness({ studentId, name, version }: { studentId: string; name: string; version: string }) {
  const device = useDevice();
  const info = useLoad(async () => ({ snap: await getRepo().getSnapshotInfo(studentId), unsent: await getRepo().countUnsentChanges(studentId) }), [studentId, version]);
  if (device?.role !== "parent" || info.status !== "ready") return null;
  const { snap, unsent } = info.data;
  return (
    <div className="space-y-2">
      {snap ? (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
          Showing {name}&apos;s homework as of <strong>{new Date(snap.exportedAt).toLocaleString()}</strong>. Ask {name} to send a newer file to refresh.
        </p>
      ) : null}
      {unsent > 0 ? (
        <Link href="/share" className="block rounded-xl bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
          {unsent} time change{unsent === 1 ? "" : "s"} not sent to {name} yet. Send them from Share.
        </Link>
      ) : null}
    </div>
  );
}

function StudentView({ student }: { student: Profile }) {
  const repo = getRepo();
  const today = useToday();
  const clock = useNow(30_000);
  const data = useLoad(() => repo.listAssignments(student.id), [student.id]);
  const [filter, setFilter] = useState<Filter>("attention");
  const [editing, setEditing] = useState<string | null>(null);

  const now = useMemo(() => clock ?? new Date(0), [clock]);
  const items: AssignmentWithTime[] = useMemo(() => (data.status === "ready" ? data.data : []), [data]);
  const ready = data.status === "ready" && today !== "" && clock !== null;

  const view = useMemo(() => {
    if (!ready) return null;
    const shown = visibleOnly(items); // work the student archived is out of the tiles, lists and alerts (see "Archived")
    const summary = summarizeWorkload(shown.map((a) => toPlanItem(a, now)), today);
    const soon = addDays(today, 2);
    const active = shown.filter((a) => a.stage !== "completed");
    const attention = active.filter((a) => isOverdue(a, today) || compareDates(a.dueDate, soon) <= 0);
    const sort = (l: AssignmentWithTime[]) => [...l].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
    return {
      summary,
      lists: {
        attention: sort(attention),
        active: sort(active),
        completed: [...shown.filter((a) => a.stage === "completed")].sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
        archived: archivedOnly(items),
      },
    };
  }, [ready, items, now, today]);

  if (data.status === "error") return <ErrorNote>{data.error}</ErrorNote>;
  if (!view) return <Loading label={`Loading ${student.displayName}'s homework`} />;

  const list = view.lists[filter];
  const s = view.summary;
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "attention", label: "Needs attention", count: view.lists.attention.length },
    { id: "active", label: "All active", count: view.lists.active.length },
    { id: "completed", label: "Completed", count: view.lists.completed.length },
    ...(view.lists.archived.length > 0 ? [{ id: "archived" as const, label: "Archived", count: view.lists.archived.length }] : []),
  ];

  return (
    <div className="space-y-5">
      <Freshness studentId={student.id} name={student.displayName} version={items.map((a) => a.updatedAt).join()} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Overdue" value={s.overdue} tone={s.overdue > 0 ? "danger" : undefined} />
        <Tile label="Due in 2 days" value={s.dueSoon} />
        <Tile label="In progress" value={s.inProgress} />
        <Tile label="Completed" value={s.completed} />
      </div>

      <Card>
        <h2 className="text-lg font-bold">Planned vs actual (active work)</h2>
        <p className="mt-1 text-lg">
          <span className="text-muted">Planned </span>
          <strong>{formatMinutes(s.allocatedMinutes)}</strong>
          <span className="text-muted"> · Tracked </span>
          <strong>{formatMinutes(s.actualMinutes)}</strong>
        </p>
      </Card>

      <div role="tablist" aria-label="Filter assignments" className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${filter === f.id ? "border-brand bg-brand text-brand-contrast" : "border-border bg-surface hover:bg-surface-2"}`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <Card className="text-center text-muted">{filter === "attention" ? "Nothing needs attention right now." : "Nothing here yet."}</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              today={today}
              now={now}
              href={assignmentHref(a.id)}
              footer={
                editing === a.id ? (
                  <div className="space-y-2 rounded-xl bg-surface-2 p-3">
                    <p className="text-sm font-semibold">Change planned time</p>
                    <AllocationEditor
                      idPrefix={`alloc-${a.id}`}
                      value={a.allocatedMinutes}
                      onSave={async (m) => {
                        await repo.setAllocation(a.id, m);
                        setEditing(null); // close; the card now shows the new planned time
                        data.reload();
                      }}
                    />
                    <Button variant="ghost" onClick={() => setEditing(null)}>
                      Close
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {a.stage !== "completed" && !a.archivedAt ? (
                      <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => setEditing(a.id)}>
                        Change time
                      </Button>
                    ) : null}
                    <Link href={assignmentHref(a.id)} className="inline-flex min-h-10 items-center px-3 text-sm font-semibold text-brand-strong underline">
                      Details &amp; history
                    </Link>
                  </div>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Dashboard({ viewer }: { viewer: Profile }) {
  const students = useLoad(() => getRepo().listStudents(), []);
  const [chosen, setChosen] = useState<string | null>(null);

  if (students.status === "loading") return <Loading />;
  if (students.status === "error") return <ErrorNote>{students.error}</ErrorNote>;
  if (students.data.length === 0) {
    return (
      <Card className="mx-auto max-w-lg space-y-3 text-center">
        <h1 className="text-2xl font-extrabold">Hi, {viewer.displayName.split(" ")[0]}</h1>
        <p className="text-muted">No student yet. Ask the student to open Share in their HomeworkFlow and send you their homework file, then open it here.</p>
        <Link href="/share">
          <Button className="w-full">Open a homework file</Button>
        </Link>
      </Card>
    );
  }
  const student = students.data.find((s) => s.id === chosen) ?? students.data[0];

  return (
    <div className="space-y-5">
      <AttentionBanner viewer={viewer} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{student.displayName}&apos;s homework</h1>
        {students.data.length > 1 ? (
          <div role="tablist" aria-label="Choose student" className="flex gap-2">
            {students.data.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === student.id}
                type="button"
                onClick={() => setChosen(s.id)}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${s.id === student.id ? "border-brand bg-brand text-brand-contrast" : "border-border bg-surface hover:bg-surface-2"}`}
              >
                {s.displayName}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <StudentView key={student.id} student={student} />
    </div>
  );
}

export default function ParentPage() {
  const viewer = useRequireRole("parent");
  if (!viewer) return <Loading />;
  return (
    <AppShell viewer={viewer} active="home">
      <Dashboard viewer={viewer} />
    </AppShell>
  );
}
