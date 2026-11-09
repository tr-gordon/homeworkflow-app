"use client";

import { useState } from "react";
import { DIFFICULTY_LABELS, type Estimate } from "@/lib/domain/estimates";
import { formatMinutes } from "@/lib/domain/timer";
import type { Difficulty } from "@/lib/domain/types";
import { assignmentInputSchema, LIMITS, type AssignmentInput } from "@/lib/validation";
import { errorMessage } from "@/lib/hooks";
import { PlacePicker } from "./PlacePicker";
import { Button, ErrorNote, Field, inputClass } from "./ui";

const DEFAULT_SUBJECTS = ["Math", "English", "Science", "History", "Spanish", "Art", "Music", "Other"];

export interface FormValues {
  title: string;
  subject: string;
  description: string;
  dueDate: string;
  difficulty: Difficulty | null;
  allocation: string;
  plannedDate: string;
  /** HH:MM, with a work day. */
  plannedStart: string;
  withParent: boolean;
  location: string;
}

export function emptyValues(): FormValues {
  return { title: "", subject: "", description: "", dueDate: "", difficulty: null, allocation: "", plannedDate: "", plannedStart: "", withParent: false, location: "" };
}

/**
 * Create / edit form. In "edit" mode the planned time is not part of the form:
 * it is changed through the allocation editor so every change is recorded.
 */
export function AssignmentForm({
  mode,
  initial,
  subjectOptions,
  suggest,
  submitLabel,
  today,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial?: FormValues;
  subjectOptions: string[];
  suggest?: (difficulty: Difficulty, subject: string) => Estimate;
  submitLabel: string;
  today: string;
  onSubmit: (input: AssignmentInput) => Promise<void>;
}) {
  const [v, setV] = useState<FormValues>(initial ?? emptyValues());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const suggestion = mode === "create" && v.difficulty && suggest ? suggest(v.difficulty, v.subject || "") : undefined;
  const subjects = Array.from(new Set([...subjectOptions, ...DEFAULT_SUBJECTS]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const allocation = v.allocation.trim() === "" ? null : Number(v.allocation);
    if (v.plannedStart !== "" && v.plannedDate === "") {
      setErrors({ plannedStart: "Pick a work day first" });
      return;
    }
    const parsed = assignmentInputSchema.safeParse({
      title: v.title,
      subject: v.subject,
      description: v.description,
      dueDate: v.dueDate,
      difficulty: v.difficulty,
      allocatedMinutes: Number.isNaN(allocation) ? -1 : allocation,
      plannedDate: v.plannedDate === "" ? null : v.plannedDate,
      plannedStart: v.plannedStart === "" ? null : v.plannedStart,
      withParent: v.withParent,
      location: v.location.trim() === "" ? null : v.location.trim(),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        const friendly: Record<string, string> = {
          dueDate: "Pick a due date",
          difficulty: "Pick how hard it is",
          plannedDate: "Pick a valid date",
        };
        next[key] ??= friendly[key] && issue.code !== "too_big" ? friendly[key] : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await onSubmit(parsed.data);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Field label="What is it?" htmlFor="title" error={errors.title}>
        <input id="title" value={v.title} maxLength={LIMITS.title} onChange={(e) => set("title", e.target.value)} className={inputClass} placeholder="e.g. Fractions worksheet" autoComplete="off" />
      </Field>

      <Field label="Subject" htmlFor="subject" error={errors.subject}>
        <input id="subject" list="subjects" value={v.subject} maxLength={LIMITS.subject} onChange={(e) => set("subject", e.target.value)} className={inputClass} placeholder="e.g. Math" autoComplete="off" />
        <datalist id="subjects">
          {subjects.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>

      <Field label="Details (optional)" htmlFor="description" error={errors.description}>
        <textarea id="description" value={v.description} maxLength={LIMITS.description} onChange={(e) => set("description", e.target.value)} rows={3} className={inputClass} placeholder="Pages, what the teacher asked for…" />
      </Field>

      <Field label="Due date" htmlFor="dueDate" error={errors.dueDate}>
        <input id="dueDate" type="date" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={inputClass} />
      </Field>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold">How hard is it?</legend>
        <div role="radiogroup" aria-label="Difficulty" className="grid grid-cols-5 gap-2">
          {([1, 2, 3, 4, 5] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={v.difficulty === d}
              aria-label={`${d}, ${DIFFICULTY_LABELS[d]}`}
              onClick={() => set("difficulty", d)}
              className={`flex min-h-14 flex-col items-center justify-center rounded-xl border text-sm font-semibold ${v.difficulty === d ? "border-brand bg-brand text-brand-contrast" : "border-border bg-surface hover:bg-surface-2"}`}
            >
              <span className="text-lg">{d}</span>
              <span className="text-[11px] font-medium leading-tight">{DIFFICULTY_LABELS[d]}</span>
            </button>
          ))}
        </div>
        {errors.difficulty ? <p role="alert" className="text-sm font-medium text-danger">{errors.difficulty}</p> : null}
      </fieldset>

      {mode === "create" ? (
        <Field label="How long will you give it? (minutes, optional)" htmlFor="allocation" error={errors.allocatedMinutes} hint="You can change this any time.">
          <input id="allocation" inputMode="numeric" value={v.allocation} onChange={(e) => set("allocation", e.target.value.replace(/[^0-9]/g, ""))} className={inputClass} placeholder="e.g. 30" />
          {suggestion ? (
            <p className="mt-2 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">
              <strong>Suggested: {formatMinutes(suggestion.minutes)}.</strong> {suggestion.explanation}{" "}
              <button type="button" className="font-semibold underline" onClick={() => set("allocation", String(suggestion.minutes))}>
                Use this
              </button>
            </p>
          ) : null}
        </Field>
      ) : null}

      <Field label="Work on it on (optional)" htmlFor="plannedDate" error={errors.plannedDate}>
        <div className="flex gap-2">
          <input id="plannedDate" type="date" value={v.plannedDate} onChange={(e) => set("plannedDate", e.target.value)} className={inputClass} />
          <Button variant="secondary" onClick={() => set("plannedDate", today)} disabled={!today}>
            Today
          </Button>
        </div>
      </Field>

      <Field label="Start time (optional)" htmlFor="plannedStart" error={errors.plannedStart} hint={v.plannedDate ? undefined : "Pick a work day first."}>
        <input id="plannedStart" type="time" value={v.plannedDate ? v.plannedStart : ""} disabled={!v.plannedDate} onChange={(e) => set("plannedStart", e.target.value)} className={inputClass} />
      </Field>

      <label className="flex min-h-11 items-center justify-between gap-4">
        <span>
          <span className="block text-sm font-semibold">Work together with a parent</span>
          <span className="block text-sm text-muted">Some work needs a parent there. It shows up for them too.</span>
        </span>
        <input type="checkbox" role="switch" aria-label="Work together with a parent" checked={v.withParent} onChange={(e) => set("withParent", e.target.checked)} className="h-6 w-11 shrink-0 accent-[var(--brand)]" />
      </label>

      <Field label="Where will you work on it? (optional)" htmlFor="location" error={errors.location}>
        <PlacePicker id="location" value={v.location} onChange={(x) => set("location", x)} />
      </Field>

      {formError ? <ErrorNote>{formError}</ErrorNote> : null}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
