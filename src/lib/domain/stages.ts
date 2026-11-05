// Progress stages (PRD P1). Deliberately words, not percentages: a stage is a
// rough self-report, not a measurement. Do not map these to numbers in the UI.
export const STAGES = [
  "not_started",
  "getting_started",
  "halfway",
  "almost_done",
  "completed",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  not_started: "Not started",
  getting_started: "Getting started",
  halfway: "Halfway",
  almost_done: "Almost done",
  completed: "Completed",
};

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export function isDone(stage: Stage): boolean {
  return stage === "completed";
}
