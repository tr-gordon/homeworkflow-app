"use client";

import { useState } from "react";
import type { Estimate } from "@/lib/domain/estimates";
import { formatMinutes } from "@/lib/domain/timer";
import { LIMITS } from "@/lib/validation";
import { errorMessage } from "@/lib/hooks";
import { Button, ErrorNote, inputClass } from "./ui";

const PRESETS = [15, 30, 45, 60, 90];

/**
 * Set or change the planned time. Used by the student and, with no approval
 * step, by a linked parent. Every save is recorded in allocation history.
 */
export function AllocationEditor({
  value,
  onSave,
  suggestion,
  idPrefix = "alloc",
}: {
  value: number | null;
  onSave: (minutes: number | null) => Promise<void>;
  suggestion?: Estimate;
  idPrefix?: string;
}) {
  const [draft, setDraft] = useState<string>(value === null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = draft.trim() === "" ? null : Number(draft);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= LIMITS.minMinutes && parsed <= LIMITS.maxMinutes);
  const changed = parsed !== value;

  function bump(delta: number) {
    const base = parsed ?? (suggestion?.minutes ?? 0);
    const next = Math.min(LIMITS.maxMinutes, Math.max(LIMITS.minMinutes, base + delta));
    setDraft(String(next));
    setSaved(false);
  }

  async function save() {
    if (!valid || !changed) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(parsed);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" aria-label="5 minutes less" className="w-12 px-0 text-xl" onClick={() => bump(-5)}>
          −
        </Button>
        <div className="flex-1">
          <label htmlFor={`${idPrefix}-minutes`} className="sr-only">
            Planned minutes
          </label>
          <input
            id={`${idPrefix}-minutes`}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Minutes"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.replace(/[^0-9]/g, ""));
              setSaved(false);
            }}
            className={`${inputClass} text-center text-lg font-bold`}
          />
        </div>
        <Button variant="secondary" aria-label="5 minutes more" className="w-12 px-0 text-xl" onClick={() => bump(5)}>
          +
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Quick amounts">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setDraft(String(m));
              setSaved(false);
            }}
            className="min-h-10 rounded-full border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2"
          >
            {formatMinutes(m)}
          </button>
        ))}
      </div>

      {suggestion ? (
        <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">
          <strong>Suggested: {formatMinutes(suggestion.minutes)}.</strong> {suggestion.explanation}{" "}
          <button type="button" className="font-semibold underline" onClick={() => setDraft(String(suggestion.minutes))}>
            Use this
          </button>
        </p>
      ) : null}

      {!valid ? <ErrorNote>Enter a whole number from {LIMITS.minMinutes} to {LIMITS.maxMinutes} minutes, or leave it empty.</ErrorNote> : null}
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!valid || !changed || saving}>
          {saving ? "Saving…" : "Save time"}
        </Button>
        {saved && !changed ? <span role="status" className="text-sm font-semibold text-ok">Saved</span> : null}
      </div>
    </div>
  );
}
