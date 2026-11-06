"use client";

import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CalendarExport } from "@/components/CalendarCard";
import { Button, Card, ErrorNote, Loading } from "@/components/ui";
import { getRepo } from "@/lib/data";
import type { ChangesImportResult, SnapshotImportResult } from "@/lib/data/types";
import { deliverJsonFile, fileNameFor, readJsonFile } from "@/lib/files";
import { errorMessage, useDevice, useLoad, useRequireRole } from "@/lib/hooks";
import type { Profile } from "@/lib/domain/types";

type Msg = { ok: boolean; text: string } | null;

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return msg.ok ? (
    <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 text-sm font-semibold text-ok">
      {msg.text}
    </p>
  ) : (
    <ErrorNote>{msg.text}</ErrorNote>
  );
}

/** A "choose file" button that reads one .json file and hands its content to `onFile`. */
function FilePicker({ label, onFile, busy }: { label: string; onFile: (content: unknown) => Promise<void>; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <input
        ref={ref}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow picking the same file again
          if (!file) return;
          setError(null);
          try {
            await onFile(await readJsonFile(file));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't read that file.");
          }
        }}
      />
      <Button variant="secondary" disabled={busy} onClick={() => ref.current?.click()}>
        {label}
      </Button>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </div>
  );
}

function snapshotText(r: SnapshotImportResult): Msg {
  if (r.kind === "older_than_current") return { ok: false, text: `That file is older than the data already here for ${r.studentName}, so it was not used.` };
  if (r.kind === "restored") return { ok: true, text: `Restored ${r.assignments} assignment(s) for ${r.studentName}.` };
  return {
    ok: true,
    text: `Updated ${r.studentName}: ${r.assignments} assignment(s).${r.reappliedChanges > 0 ? ` Your ${r.reappliedChanges} unsent change(s) were kept.` : ""}`,
  };
}

function changesText(r: ChangesImportResult): Msg {
  const parts = [`${r.applied} applied`];
  if (r.superseded) parts.push(`${r.superseded} older than a newer change (recorded, not applied)`);
  if (r.duplicates) parts.push(`${r.duplicates} already imported`);
  if (r.missingAssignment) parts.push(`${r.missingAssignment} for deleted assignments`);
  return { ok: true, text: `Changes from ${r.parentName}: ${parts.join(", ")}.` };
}

function MyCalendar() {
  const students = useLoad(() => getRepo().listStudents(), []);
  if (students.status !== "ready" || !students.data[0]) return null;
  return <CalendarExport studentId={students.data[0].id} studentName={students.data[0].displayName} ownHomework />;
}

/** Student device (or its parent view): export the snapshot, import the parent's changes, back up and restore. */
function StudentShare() {
  const repo = getRepo();
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<Msg>(null);

  async function exportSnapshot(kind: string) {
    setBusy(true);
    setMsg(null);
    try {
      const me = (await repo.listStudents())[0];
      const how = await deliverJsonFile(fileNameFor("snapshot", me.displayName), await repo.exportSnapshot(), `HomeworkFlow ${kind}`);
      setMsg({ ok: true, text: how === "shared" ? "Ready to send." : "Saved to your downloads. Send the file to your parent." });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Send your homework to a parent</h2>
        <p className="text-sm text-muted">
          This makes a file with all your assignments, time and history. Your parent opens it in HomeworkFlow on their device to see your homework. It also contains a private key that proves
          their changes are really theirs, so <strong>only send it to your parent</strong>.
        </p>
        <Button disabled={busy} onClick={() => exportSnapshot("snapshot")}>
          Share my homework file
        </Button>
        <Message msg={msg} />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Calendar reminders</h2>
        <p className="text-sm text-muted">
          Adds your due dates and planned work to your phone&apos;s calendar with alarms (5 pm the day before and 7:30 am on the day). Your calendar fires them even when HomeworkFlow is closed. Open the
          file again after changes; it updates the same events. Calendars don&apos;t remove events for work you later finish or delete.
        </p>
        <MyCalendar />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Get changes from a parent</h2>
        <p className="text-sm text-muted">If your parent changed planned time, they send you a changes file. Open it here and the new times are applied. Each change shows who made it and when.</p>
        <FilePicker
          label="Open a changes file"
          busy={busy}
          onFile={async (content) => {
            setBusy(true);
            setMsg(null);
            try {
              setMsg(changesText(await repo.importChanges(content)));
            } catch (e) {
              setMsg({ ok: false, text: errorMessage(e) });
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Back up and restore</h2>
        <p className="text-sm text-muted">Your homework lives only on this device. If you clear browser data or change phones, it&apos;s gone unless you saved a file. The same file works as a backup.</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => exportSnapshot("backup")}>
            Save a backup
          </Button>
          <FilePicker
            label="Restore from a backup"
            busy={busy}
            onFile={async (content) => {
              if (!window.confirm("Restore from this file? It replaces the homework on this device.")) return;
              setBusy(true);
              setRestoreMsg(null);
              try {
                setRestoreMsg(snapshotText(await repo.importSnapshot(content)));
              } catch (e) {
                setRestoreMsg({ ok: false, text: errorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        <Message msg={restoreMsg} />
      </Card>
    </div>
  );
}

function StudentCard({ student, onChanged }: { student: Profile; onChanged: () => void }) {
  const repo = getRepo();
  const info = useLoad(async () => ({ snap: await repo.getSnapshotInfo(student.id), unsent: await repo.countUnsentChanges(student.id) }), [student.id]);
  const [msg, setMsg] = useState<Msg>(null);
  if (info.status !== "ready") return <Loading />;
  const { snap, unsent } = info.data;
  return (
    <Card className="space-y-3">
      <h3 className="text-lg font-bold">{student.displayName}</h3>
      <p className="text-sm text-muted">
        {snap ? `Data from ${new Date(snap.exportedAt).toLocaleString()}.` : "No data yet."} Changes to send: <strong>{unsent}</strong>.
      </p>
      <Button
        disabled={unsent === 0}
        onClick={async () => {
          setMsg(null);
          try {
            const file = await repo.exportChanges(student.id);
            if (!file) return;
            const parent = (await repo.getViewer())?.displayName ?? "parent";
            const how = await deliverJsonFile(fileNameFor("changes", `${student.displayName}-from-${parent}`), file, `Changes for ${student.displayName}`);
            setMsg({ ok: true, text: how === "shared" ? "Ready to send." : "Saved to your downloads. Send the file to the student." });
            onChanged();
          } catch (e) {
            setMsg({ ok: false, text: errorMessage(e) });
          }
        }}
      >
        Send my changes to {student.displayName}
      </Button>
      <p className="text-sm text-muted">The student opens this file in their app and the new times apply right away. Sending again is safe: changes already applied are skipped.</p>
      <Message msg={msg} />
      <div className="border-t border-border pt-3">
        <p className="mb-2 text-sm text-muted">Get {student.displayName}&apos;s due dates as alarms in your own calendar (as of the data above).</p>
        <CalendarExport studentId={student.id} studentName={student.displayName} ownHomework={false} />
      </div>
    </Card>
  );
}

/** Parent device: import a student's snapshot, then send back signed changes. */
function ParentShare() {
  const repo = getRepo();
  const students = useLoad(() => repo.listStudents(), []);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">Get a student&apos;s homework</h2>
        <p className="text-sm text-muted">Ask the student to open Share and send you their homework file, then open it here. Open a newer file any time to refresh. Your unsent changes are kept.</p>
        <FilePicker
          label="Open a homework file"
          busy={busy}
          onFile={async (content) => {
            setBusy(true);
            setMsg(null);
            try {
              setMsg(snapshotText(await repo.importSnapshot(content)));
              students.reload();
            } catch (e) {
              setMsg({ ok: false, text: errorMessage(e) });
            } finally {
              setBusy(false);
            }
          }}
        />
        <Message msg={msg} />
      </Card>
      {students.status === "ready" && students.data.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Send your changes</h2>
          {students.data.map((s) => (
            <StudentCard key={s.id} student={s} onChanged={students.reload} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

export default function SharePage() {
  const viewer = useRequireRole("any");
  const device = useDevice();
  if (!viewer || !device) return <Loading />;
  return (
    <AppShell viewer={viewer} active="share">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-extrabold">Share</h1>
        <p className="text-muted">There is no server. Homework moves between a student&apos;s device and a parent&apos;s device as small files, sent however you like (message, email, AirDrop).</p>
        {device.role === "student" ? <StudentShare /> : <ParentShare />}
      </div>
    </AppShell>
  );
}
