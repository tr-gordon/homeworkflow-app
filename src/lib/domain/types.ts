import type { ChangeField, ChangeValue } from "./changes";
import type { Stage } from "./stages";

export type Role = "student" | "parent";
export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type TimerState = "running" | "paused" | "finished";

export interface Profile {
  id: string;
  role: Role;
  displayName: string;
}

export interface Assignment {
  id: string;
  studentId: string;
  title: string;
  subject: string;
  description: string;
  /** YYYY-MM-DD */
  dueDate: string;
  difficulty: Difficulty;
  stage: Stage;
  allocatedMinutes: number | null;
  /** YYYY-MM-DD the student plans to work on it, if set. */
  plannedDate: string | null;
  /** HH:MM (24 hour) the work is planned to start; only with a plannedDate. */
  plannedStart: string | null;
  /** Work to do together with a parent (so the parent needs to be there). */
  withParent: boolean;
  /** Where the student plans to work on it (for example "Library"), if set. */
  location: string | null;
  /** When it was archived (hidden from the dashboard, alerts and calendar), or null. */
  archivedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimerSession {
  id: string;
  assignmentId: string;
  studentId: string;
  state: TimerState;
  /** ISO timestamps. */
  startedAt: string;
  /** Non-null only while running. */
  lastResumedAt: string | null;
  /** Seconds already committed (excludes the live stretch while running). */
  accumulatedSeconds: number;
  finishedAt: string | null;
}

export interface AllocationChange {
  id: string;
  assignmentId: string;
  /** Which field changed. Older records are all "allocatedMinutes". */
  field: ChangeField;
  /** For "allocatedMinutes" (kept so older readers and files still work). */
  oldMinutes: number | null;
  newMinutes: number | null;
  /** For the schedule fields (work day, start time, together, place). */
  oldValue: ChangeValue;
  newValue: ChangeValue;
  /** Who made the change (a device-local id), kept with a name so history stays readable offline. */
  changedBy: string | null;
  changedByName: string | null;
  changedByRole: Role | "system";
  changedAt: string;
  /**
   * "superseded": a parent's change that arrived (via file) after a newer change
   * had already been made, so it was recorded but not applied.
   */
  status: "applied" | "superseded";
}

/** Assignment plus its timer sessions, as returned to the UI. */
export interface AssignmentWithTime extends Assignment {
  sessions: TimerSession[];
}
