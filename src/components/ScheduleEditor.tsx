"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/hooks";
import { Button, ErrorNote, Field, inputClass } from "./ui";
import { PlacePicker } from "./PlacePicker";

export interface ScheduleValues {
  plannedDate: string | null;
  plannedStart: string | null;
  withParent: boolean;
  location: string | null;
}

/**
 * Change when and where: the work day, the start time, whether it is done together with a parent, and the place.
 * Used by a parent (no approval needed; from their own device the change is sent to the student as a file).
 */
export function ScheduleEditor({
  value,
  today,
  onSave,
  idPrefix = "sched",
}: {
  value: ScheduleValues;
  today: string;
  onSave: (v: ScheduleValues) => Promise<void>;
  idPrefix?: string;
}) {
  const [date, setDate] = useState(value.plannedDate ?? "");
  const [time, setTime] = useState(value.plannedStart ?? "");
  const [together, setTogether] = useState(value.withParent);
  const [place, setPlace] = useState(value.location ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const next: ScheduleValues = { plannedDate: date || null, plannedStart: date ? time || null : null, withParent: together, location: place.trim() || null };
  const changed = JSON.stringify(next) !== JSON.stringify(value);
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setSaved(false);
  };

  async function save() {
    if (!changed) return;
    if (time && !date) {
      setError("Pick a work day before a start time.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Work day" htmlFor={`${idPrefix}-date`}>
        <div className="flex gap-2">
          <input id={`${idPrefix}-date`} type="date" value={date} onChange={(e) => touch(setDate)(e.target.value)} className={inputClass} />
          <Button variant="secondary" onClick={() => touch(setDate)(today)} disabled={!today}>
            Today
          </Button>
        </div>
      </Field>
      <Field label="Start time" htmlFor={`${idPrefix}-time`} hint={date ? undefined : "Pick a work day first."}>
        <input id={`${idPrefix}-time`} type="time" value={date ? time : ""} disabled={!date} onChange={(e) => touch(setTime)(e.target.value)} className={inputClass} />
      </Field>
      <label className="flex min-h-11 items-center justify-between gap-4">
        <span className="font-semibold">Work together with a parent</span>
        <input type="checkbox" role="switch" checked={together} onChange={(e) => touch(setTogether)(e.target.checked)} className="h-6 w-11 shrink-0 accent-[var(--brand)]" />
      </label>
      <Field label="Where" htmlFor={`${idPrefix}-place`}>
        <PlacePicker id={`${idPrefix}-place`} value={place} onChange={touch(setPlace)} />
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!changed || saving}>
          {saving ? "Saving…" : "Save schedule"}
        </Button>
        {saved && !changed ? (
          <span role="status" className="text-sm font-semibold text-ok">
            Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}
