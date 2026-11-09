import { z } from "zod";
import { CHANGE_FIELDS, TIME_RE } from "../domain/changes";
import { stageSchema, difficultySchema, minutesSchema } from "../validation";

/**
 * The whole app state, stored as ONE JSON blob in localStorage (like MEDS).
 * Validated with zod on every load: stored data is untrusted input too
 * (it can be edited by hand, by another app version, or be damaged).
 */
export const STATE_VERSION = 2;

const iso = z.string().min(10);
const date = z.iso.date();

export const assignmentSchema = z.object({
  id: z.string().min(1),
  studentId: z.string().min(1),
  title: z.string(),
  subject: z.string(),
  description: z.string(),
  dueDate: date,
  difficulty: difficultySchema,
  stage: stageSchema,
  allocatedMinutes: minutesSchema.nullable(),
  plannedDate: date.nullable(),
  // Added after the first release: older saved data and older files simply lack them.
  plannedStart: z.string().regex(TIME_RE).nullable().default(null),
  withParent: z.boolean().default(false),
  location: z.string().max(40).nullable().default(null),
  archivedAt: iso.nullable().default(null),
  completedAt: iso.nullable(),
  createdAt: iso,
  updatedAt: iso,
});

export const sessionSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  studentId: z.string().min(1),
  state: z.enum(["running", "paused", "finished"]),
  startedAt: iso,
  lastResumedAt: iso.nullable(),
  accumulatedSeconds: z.number().int().nonnegative(),
  finishedAt: iso.nullable(),
});

export const changeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const changeFieldSchema = z.enum(CHANGE_FIELDS);

export const historySchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  /** Older records predate field-level changes and are all allocation changes. */
  field: changeFieldSchema.default("allocatedMinutes"),
  oldMinutes: z.number().int().nullable(),
  newMinutes: z.number().int().nullable(),
  oldValue: changeValueSchema.default(null),
  newValue: changeValueSchema.default(null),
  changedBy: z.string().nullable(),
  changedByName: z.string().nullable(),
  changedByRole: z.enum(["student", "parent", "system"]),
  changedAt: iso,
  status: z.enum(["applied", "superseded"]).default("applied"),
});

/** One change to one field of an assignment, made by a parent or the student. */
export const fieldChangeSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  field: changeFieldSchema,
  from: changeValueSchema,
  to: changeValueSchema,
  changedAt: iso,
});
export type FieldChange = z.infer<typeof fieldChangeSchema>;

/** The first release's change record (allocation only). Still seen in saved data and in older changes files. */
export const legacyChangeSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  oldMinutes: z.number().int().nullable(),
  newMinutes: minutesSchema.nullable(),
  changedAt: iso,
});
export type LegacyChange = z.infer<typeof legacyChangeSchema>;

export const legacyToFieldChange = (c: LegacyChange): FieldChange => ({
  id: c.id,
  assignmentId: c.assignmentId,
  field: "allocatedMinutes",
  from: c.oldMinutes,
  to: c.newMinutes,
  changedAt: c.changedAt,
});

/** Saved unsent changes from before field-level changes are converted when read, so nothing a parent did is lost. */
const outboxEntrySchema = z.preprocess(
  (v) => (v && typeof v === "object" && "newMinutes" in v ? { ...legacyToFieldChange(v as LegacyChange), studentId: (v as { studentId?: string }).studentId } : v),
  fieldChangeSchema.extend({ studentId: z.string().min(1) }),
);

export const stateSchema = z.object({
  version: z.literal(STATE_VERSION),
  deviceId: z.string().min(1),
  /** null until the first-run setup is finished. */
  role: z.enum(["student", "parent"]).nullable(),
  displayName: z.string(),
  /** Student device: the name used when a parent edits on this device. */
  parentName: z.string().nullable(),
  pin: z.object({ salt: z.string(), hash: z.string(), iterations: z.number().int().positive() }).nullable(),
  pinFailures: z.number().int().nonnegative(),
  pinLockedUntil: iso.nullable(),
  /** Student device: just the one student. Parent device: students imported from snapshots. */
  students: z.array(z.object({ id: z.string().min(1), displayName: z.string() })),
  assignments: z.array(assignmentSchema),
  sessions: z.array(sessionSchema),
  history: z.array(historySchema),
  /** Parent device only: changes not yet confirmed back by a newer snapshot. */
  outbox: z.array(outboxEntrySchema),
  /** Student device: this student's secret used to authenticate changes files. */
  pairingSecret: z.string().nullable(),
  /** Parent device: per imported student, when it was exported/imported and the secret it carried. */
  snapshots: z.record(z.string(), z.object({ exportedAt: iso, importedAt: iso, pairingSecret: z.string() })),
  demo: z.boolean(),
});

export type AppState = z.infer<typeof stateSchema>;

export function emptyState(deviceId: string, demo = false): AppState {
  return {
    version: STATE_VERSION,
    deviceId,
    role: null,
    displayName: "",
    parentName: null,
    pin: null,
    pinFailures: 0,
    pinLockedUntil: null,
    students: [],
    assignments: [],
    sessions: [],
    history: [],
    outbox: [],
    pairingSecret: null,
    snapshots: {},
    demo,
  };
}
