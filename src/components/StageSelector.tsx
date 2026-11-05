"use client";

import { STAGES, STAGE_LABELS, type Stage } from "@/lib/domain/stages";
import { Chip } from "./ui";

/**
 * Progress is a rough self-report in words (PRD P1). Deliberately NOT a
 * percentage, slider or filled bar: those would imply precision that isn't there.
 */
export function StageSelector({ value, onChange, disabled }: { value: Stage; onChange: (s: Stage) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="How far along are you?" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {STAGES.map((s) => {
        const selected = s === value;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(s)}
            className={`min-h-12 rounded-xl border px-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
              selected ? "border-brand bg-brand text-brand-contrast" : "border-border bg-surface hover:bg-surface-2"
            } ${s === "completed" ? "col-span-2 sm:col-span-1" : ""}`}
          >
            {STAGE_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <Chip tone={stage === "completed" ? "ok" : stage === "not_started" ? "neutral" : "brand"}>{STAGE_LABELS[stage]}</Chip>;
}
