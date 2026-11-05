import type { Difficulty } from "./types";

/**
 * Rule-based time estimates (PRD T4).
 *
 * 1. Start from a fixed baseline per difficulty.
 * 2. Once the student has MIN_SAMPLES finished assignments with timer data,
 *    blend toward the median of their actual times. Weight grows with sample
 *    size (10% per sample) up to MAX_WEIGHT, so one outlier never takes over.
 * 3. Prefer same-subject samples at the same difficulty when there are enough;
 *    otherwise use all samples at that difficulty.
 */

export const BASE_MINUTES: Record<Difficulty, number> = { 1: 15, 2: 25, 3: 40, 4: 60, 5: 90 };
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Medium",
  4: "Hard",
  5: "Very hard",
};

export const MIN_SAMPLES = 3;
export const MAX_WEIGHT = 0.8;
export const WEIGHT_PER_SAMPLE = 0.1;
/** Ignore sessions under 2 minutes: usually an accidental start. */
export const MIN_SAMPLE_SECONDS = 120;
const MIN_ESTIMATE = 5;
const MAX_ESTIMATE = 240;

export interface HistorySample {
  subject: string;
  difficulty: Difficulty;
  actualSeconds: number;
}

export interface Estimate {
  minutes: number;
  basis: "difficulty" | "history";
  sampleSize: number;
  scope: "none" | "subject" | "difficulty";
  explanation: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function roundTo5(minutes: number): number {
  return Math.round(minutes / 5) * 5;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function norm(subject: string): string {
  return subject.trim().toLowerCase();
}

export function estimateMinutes(
  difficulty: Difficulty,
  subject: string,
  history: readonly HistorySample[],
): Estimate {
  const base = BASE_MINUTES[difficulty];
  const usable = history.filter(
    (h) => h.difficulty === difficulty && h.actualSeconds >= MIN_SAMPLE_SECONDS,
  );
  const sameSubject = usable.filter((h) => norm(h.subject) === norm(subject));

  let samples = usable;
  let scope: Estimate["scope"] = "difficulty";
  if (sameSubject.length >= MIN_SAMPLES) {
    samples = sameSubject;
    scope = "subject";
  }

  const label = DIFFICULTY_LABELS[difficulty].toLowerCase();
  if (samples.length < MIN_SAMPLES) {
    return {
      minutes: base,
      basis: "difficulty",
      sampleSize: samples.length,
      scope: "none",
      explanation: `Based on difficulty (${label}). Improves after ${MIN_SAMPLES} finished ${label} assignments with the timer.`,
    };
  }

  const weight = Math.min(MAX_WEIGHT, samples.length * WEIGHT_PER_SAMPLE);
  const med = median(samples.map((s) => s.actualSeconds / 60));
  const blended = base * (1 - weight) + med * weight;
  const minutes = clamp(roundTo5(blended), MIN_ESTIMATE, MAX_ESTIMATE);
  const where = scope === "subject" ? `${subject.trim()} ` : "";
  return {
    minutes,
    basis: "history",
    sampleSize: samples.length,
    scope,
    explanation: `Based on your ${samples.length} finished ${where}${label} assignments (typical ${Math.round(med)} min) and the difficulty baseline.`,
  };
}
