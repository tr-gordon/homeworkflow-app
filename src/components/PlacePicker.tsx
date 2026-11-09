"use client";

import { LIMITS } from "@/lib/validation";
import { inputClass } from "./ui";

export const PLACES = ["Home", "Library", "School"];

/** Quick place choices plus a free-text box. An empty value means "not set". */
export function PlacePicker({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <div role="group" aria-label="Common places" className="mb-2 flex flex-wrap gap-2">
        {PLACES.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={value === p}
            onClick={() => onChange(value === p ? "" : p)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${value === p ? "border-brand bg-brand text-brand-contrast" : "border-border bg-surface hover:bg-surface-2"}`}
          >
            {p}
          </button>
        ))}
      </div>
      <input id={id} value={value} maxLength={LIMITS.location} onChange={(e) => onChange(e.target.value)} className={inputClass} placeholder="Or type a place" autoComplete="off" />
    </>
  );
}
