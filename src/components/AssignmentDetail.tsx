"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { getRepo } from "@/lib/data";
import { estimateMinutes } from "@/lib/domain/estimates";
import { samplesFromAssignments } from "@/lib/domain/history";
import { activeSession, formatMinutes, totalActualSeconds } from "@/lib/domain/timer";
import type { Profile } from "@/lib/domain/types";
import { errorMessage, useDevice, useLoad, useNow, useToday } from "@/lib/hooks";
import { AllocationEditor } from "./AllocationEditor";
import { DifficultyText } from "./DifficultyText";
import { AssignmentForm, type FormValues } from "./AssignmentForm";
import { DueChip } from "./AssignmentCard";
import { HistoryList } from "./HistoryList";
import { StageBadge, StageSelector } from "./StageSelector";
import { TimeSummary } from "./TimeSummary";
import { TimerPanel } from "./TimerPanel";
import { Button, Card, Chip, ErrorNote, Loading } from "./ui";
import type { Stage } from "@/lib/domain/stages";

/**
 * One assignment, seen by the student (full control) or a linked parent
 * (read-only except planned time). The database enforces this; the UI just
 * doesn't offer what would be refused.
 */
export function AssignmentDetail({ viewer }: { viewer: Profile }) {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const repo = getRepo();
  const today = useToday();
  const now = useNow(30_000);
  const device = useDevice();
  const isStudent = viewer.role === "student";
  const onParentDevice = device?.role === "parent";
  const backHref = isStudent ? "/student" : "/parent";

  const data = useLoad(async () => {
    const assignment = await repo.getAssignment(id);
    if (!assignment) return null;
    const [history, siblings, students] = await Promise.all([
      repo.listAllocationHistory(id),
      repo.listAssignments(assignment.studentId),
      isStudent ? Promise.resolve([viewer]) : repo.listStudents(),
    ]);
    return { assignment, history, siblings, studentName: students.find((s) => s.id === assignment.studentId)?.displayName ?? "Student" };
  }, [id]);

  const [stageError, setStageError] = useState<string | null>(null);
  const [finishedSeconds, setFinishedSeconds] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loaded = data.status === "ready" ? data.data : null;
  const samples = useMemo(() => (loaded ? samplesFromAssignments(loaded.siblings, now ?? new Date()) : []), [loaded, now]);

  if (data.status === "loading") return <Loading />;
  if (data.status === "error") return <ErrorNote>{data.error}</ErrorNote>;
  if (!loaded) {
    return (
      <Card className="text-center">
        <p className="font-semibold">We couldn&apos;t find that assignment.</p>
        <Link href={backHref} className="mt-2 inline-block font-semibold text-brand-strong underline">
          Back
        </Link>
      </Card>
    );
  }

  const { assignment: a, history, siblings, studentName } = loaded;
  const reference = now ?? new Date(a.updatedAt);
  const other = siblings.find((s) => s.id !== a.id && activeSession(s.sessions));
  const otherActive = other ? { session: activeSession(other.sessions)!, title: other.title } : null;
  const estimate = estimateMinutes(a.difficulty, a.subject, samples);
  const subjects = Array.from(new Set(siblings.map((s) => s.subject)));

  async function setStage(stage: Stage) {
    setStageError(null);
    try {
      await repo.updateAssignment(a.id, { stage });
      setFinishedSeconds(null);
      data.reload();
    } catch (e) {
      setStageError(errorMessage(e));
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${a.title}"? Its tracked time and history will be deleted too.`)) return;
    try {
      await repo.deleteAssignment(a.id);
      router.replace(backHref);
    } catch (e) {
      setDeleteError(errorMessage(e));
    }
  }

  const initial: FormValues = {
    title: a.title,
    subject: a.subject,
    description: a.description,
    dueDate: a.dueDate,
    difficulty: a.difficulty,
    allocation: "",
    plannedDate: a.plannedDate ?? "",
  };
  const finished = a.sessions.filter((s) => s.state === "finished").sort((x, y) => y.startedAt.localeCompare(x.startedAt));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href={backHref} className="inline-flex min-h-11 items-center font-semibold text-brand-strong">
        ← {isStudent ? "Today" : "Dashboard"}
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="brand">{a.subject}</Chip>
          {today ? <DueChip dueDate={a.dueDate} stage={a.stage} today={today} /> : null}
          <StageBadge stage={a.stage} />
          {!isStudent ? <Chip>{studentName}</Chip> : null}
        </div>
        <h1 className="text-2xl font-extrabold leading-tight">{a.title}</h1>
        <p className="text-sm text-muted">
          <DifficultyText difficulty={a.difficulty} /> · due {a.dueDate}
          {a.plannedDate ? ` · planned for ${a.plannedDate}` : ""}
        </p>
        {a.description ? <p className="whitespace-pre-wrap">{a.description}</p> : null}
      </div>

      {isStudent ? (
        <TimerPanel assignment={a} otherActive={otherActive} onChanged={data.reload} onFinished={setFinishedSeconds} />
      ) : (
        <Card>
          <h2 className="text-lg font-bold">Planned vs actual</h2>
          <div className="mt-3">
            <TimeSummary allocatedMinutes={a.allocatedMinutes} actualSeconds={totalActualSeconds(a.sessions, reference)} />
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-bold">{isStudent ? "How far along are you?" : "How far along (their own report)"}</h2>
        {isStudent ? (
          <div className="mt-3 space-y-3">
            {finishedSeconds !== null ? (
              <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 text-sm font-semibold text-ok">
                Session saved: {formatMinutes(finishedSeconds / 60)}. Want to update how far along you are?
              </p>
            ) : null}
            <StageSelector value={a.stage} onChange={setStage} />
            <p className="text-sm text-muted">Pick the words that fit. This is your own sense of it, not a percentage.</p>
            {stageError ? <ErrorNote>{stageError}</ErrorNote> : null}
          </div>
        ) : (
          <p className="mt-2">
            <StageBadge stage={a.stage} />
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Planned time</h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          {isStudent
            ? "You can change this any time. A parent can change it too, and every change is listed below."
            : onParentDevice
              ? `You can change ${studentName}'s planned time. No approval is needed. Your change is saved here; send it to ${studentName} from Share and it applies when they open the file.`
              : `You can change ${studentName}'s planned time. No approval is needed, and ${studentName} will see who changed it.`}
        </p>
        <AllocationEditor
          key={`${a.id}-${a.allocatedMinutes}`}
          value={a.allocatedMinutes}
          suggestion={a.stage === "completed" ? undefined : estimate}
          onSave={async (minutes) => {
            await repo.setAllocation(a.id, minutes);
            data.reload();
          }}
        />
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Time log</h2>
        {finished.length === 0 && !activeSession(a.sessions) ? (
          <p className="mt-2 text-sm text-muted">No time tracked yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border text-sm">
            {activeSession(a.sessions) ? (
              <li className="flex justify-between py-2">
                <span>In progress</span>
                <span className="font-semibold">timer {activeSession(a.sessions)?.state}</span>
              </li>
            ) : null}
            {finished.map((s) => (
              <li key={s.id} className="flex justify-between py-2">
                <time dateTime={s.startedAt}>{new Date(s.startedAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</time>
                <span className="font-semibold">{s.accumulatedSeconds < 60 ? "under 1 min" : formatMinutes(s.accumulatedSeconds / 60)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">Time changes</h2>
        <HistoryList items={history} viewerId={viewer.id} />
      </Card>

      {isStudent ? (
        <>
          <Card>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Edit details</summary>
              <div className="mt-3">
                <AssignmentForm
                  mode="edit"
                  initial={initial}
                  today={today}
                  subjectOptions={subjects}
                  submitLabel="Save changes"
                  onSubmit={async (input) => {
                    await repo.updateAssignment(a.id, {
                      title: input.title,
                      subject: input.subject,
                      description: input.description,
                      dueDate: input.dueDate,
                      difficulty: input.difficulty,
                      plannedDate: input.plannedDate,
                    });
                    data.reload();
                  }}
                />
              </div>
            </details>
          </Card>
          <div className="pb-4">
            {deleteError ? <ErrorNote>{deleteError}</ErrorNote> : null}
            <Button variant="danger" className="mt-2 w-full" onClick={remove}>
              Delete assignment
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
