"use client";

import { useState } from "react";
import { getRepo } from "@/lib/data";
import { toLocalDateString } from "@/lib/domain/dates";
import { buildIcs, icsFileName } from "@/lib/domain/ics";
import { deliverFile } from "@/lib/files";
import { errorMessage } from "@/lib/hooks";
import { Button, ErrorNote } from "./ui";

/**
 * Exports due dates and planned work as a calendar file with alarms. The phone's own
 * calendar app fires them, so they work when HomeworkFlow is closed. Nothing is uploaded: the
 * file is made on this device and handed to the share sheet or downloaded.
 */
export function CalendarExport({ studentId, studentName, ownHomework }: { studentId: string; studentName: string; ownHomework: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // A parent usually wants alarms only for the work they have to be there for.
  const [onlyTogether, setOnlyTogether] = useState(!ownHomework);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const items = await getRepo().listAssignments(studentId);
      const now = new Date();
      const ics = buildIcs(items, { now, who: ownHomework ? undefined : studentName, onlyTogether: !ownHomework && onlyTogether });
      const count = items.filter((a) => a.stage !== "completed" && !a.archivedAt && (ownHomework || !onlyTogether || a.withParent)).length;
      if (count === 0) {
        setMsg({ ok: false, text: onlyTogether && !ownHomework ? "No work marked as together to add." : "No active assignments to add." });
        return;
      }
      const how = await deliverFile(icsFileName(studentName, toLocalDateString(now)), ics, "text/calendar", "HomeworkFlow reminders");
      setMsg({
        ok: true,
        text: how === "shared" ? `Reminders for ${count} assignment(s) are ready to add to your calendar.` : `Saved ${count} assignment(s) to your downloads. Open the file to add it to your calendar.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {!ownHomework ? (
        <label className="flex min-h-11 items-center justify-between gap-4 text-sm">
          <span className="font-semibold">Only the work we do together</span>
          <input type="checkbox" role="switch" checked={onlyTogether} onChange={(e) => setOnlyTogether(e.target.checked)} className="h-6 w-11 shrink-0 accent-[var(--brand)]" />
        </label>
      ) : null}
      <Button variant="secondary" disabled={busy} onClick={run}>
        Add reminders to my calendar{ownHomework ? "" : ` for ${studentName}`}
      </Button>
      {msg ? msg.ok ? <p role="status" className="rounded-xl bg-ok-soft px-3 py-2 text-sm font-semibold text-ok">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote> : null}
    </div>
  );
}
