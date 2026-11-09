import { z } from "zod";
import { normalizeFieldValue, type ChangeField, type ChangeValue } from "../domain/changes";
import { elapsedSeconds } from "../domain/timer";
import type { AllocationChange, TimerSession } from "../domain/types";
import { LIMITS } from "../validation";
import { RepoError } from "./errors";
import { requireSubtle } from "./secure";
import {
  assignmentSchema,
  fieldChangeSchema,
  historySchema,
  legacyChangeSchema,
  legacyToFieldChange,
  sessionSchema,
  type AppState,
  type FieldChange,
} from "./state";

/**
 * File round-trip between a student device and a parent device (no server).
 *
 *   student ──snapshot.json──▶ parent        (read-only copy of the student's data)
 *   parent  ◀──changes.json─── (parent changes time and schedule, exports a signed file)
 *   student imports changes.json              (applied automatically: no approval step)
 *
 * The snapshot carries a random pairing secret. The changes file is signed
 * (HMAC-SHA256) with it, so the student device only accepts changes produced by
 * someone who holds that student's snapshot, and detects tampering. A snapshot
 * file is therefore as sensitive as the data in it: share it only with the parent.
 *
 * Changes file versions: 1 carries allocation changes only (the first release); 2 carries any field. A parent
 * app writes version 1 whenever only the allocation changed, so a student app that has not updated yet
 * (phones update on the second open) still accepts it. Both are accepted on import.
 */

export const FORMAT_VERSION = 1;
/** The newest changes-file version this app understands. */
export const CHANGES_VERSION = 2;
export const APP_ID = "homeworkflow";
/** Changes dated further ahead than this are treated as "now" (clock skew / forgery guard). */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

export const snapshotSchema = z.object({
  app: z.literal(APP_ID),
  kind: z.literal("snapshot"),
  version: z.literal(FORMAT_VERSION),
  exportedAt: z.string().min(10),
  student: z.object({ id: z.string().min(1), displayName: z.string().min(1).max(LIMITS.displayName) }),
  pairingSecret: z.string().min(20).max(100),
  assignments: z.array(assignmentSchema).max(5000),
  sessions: z.array(sessionSchema).max(20000),
  history: z.array(historySchema).max(20000),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

const envelope = {
  app: z.literal(APP_ID),
  kind: z.literal("changes"),
  exportedAt: z.string().min(10),
  studentId: z.string().min(1),
  parentName: z.string().min(1).max(LIMITS.displayName),
  /** base64 HMAC-SHA256 over canonicalChanges(). */
  mac: z.string().min(20),
};
export const changesFileSchemaV1 = z.object({ ...envelope, version: z.literal(1), changes: z.array(legacyChangeSchema).max(5000) });
export const changesFileSchemaV2 = z.object({ ...envelope, version: z.literal(2), changes: z.array(fieldChangeSchema).max(5000) });
export type ChangesFileV1 = z.infer<typeof changesFileSchemaV1>;
export type ChangesFileV2 = z.infer<typeof changesFileSchemaV2>;
export type ChangesFile = ChangesFileV1 | ChangesFileV2;
export type UnsignedChangesFile = Omit<ChangesFileV1, "mac"> | Omit<ChangesFileV2, "mac">;

/** A parsed file with its changes in the general shape; `version` still says how it was signed. */
export interface ParsedChanges {
  version: 1 | 2;
  exportedAt: string;
  studentId: string;
  parentName: string;
  changes: FieldChange[];
  raw: ChangesFile;
}

/** Version of a file that looks like one of ours but is newer than this app understands, else null. */
export function newerVersionThanSupported(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { app?: unknown; version?: unknown };
  return r.app === APP_ID && typeof r.version === "number" && r.version > Math.max(FORMAT_VERSION, CHANGES_VERSION) ? r.version : null;
}

export function parseChangesFile(raw: unknown): ParsedChanges | null {
  const v1 = changesFileSchemaV1.safeParse(raw);
  if (v1.success) {
    const f = v1.data;
    return { version: 1, exportedAt: f.exportedAt, studentId: f.studentId, parentName: f.parentName, changes: f.changes.map(legacyToFieldChange), raw: f };
  }
  const v2 = changesFileSchemaV2.safeParse(raw);
  if (v2.success) {
    const f = v2.data;
    return { version: 2, exportedAt: f.exportedAt, studentId: f.studentId, parentName: f.parentName, changes: f.changes, raw: f };
  }
  return null;
}

/** The file to write: version 1 if every change is an allocation change (older apps can read it), else version 2. */
export function toUnsignedChangesFile(o: { exportedAt: string; studentId: string; parentName: string; changes: FieldChange[] }): UnsignedChangesFile {
  const base = { app: APP_ID, kind: "changes", exportedAt: o.exportedAt, studentId: o.studentId, parentName: o.parentName } as const;
  if (o.changes.every((c) => c.field === "allocatedMinutes")) {
    return { ...base, version: 1, changes: o.changes.map((c) => ({ id: c.id, assignmentId: c.assignmentId, oldMinutes: c.from as number | null, newMinutes: c.to as number | null, changedAt: c.changedAt })) };
  }
  return { ...base, version: 2, changes: o.changes };
}

// ---- crypto helpers ---------------------------------------------------------

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function newPairingSecret(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * The exact bytes that are signed: fixed order, no ambiguity, and different for each version so a version 1
 * signature can never be replayed as version 2 (the version number is inside the signed bytes).
 */
export function canonicalChanges(f: UnsignedChangesFile): string {
  const head = [APP_ID, "changes", f.version, f.studentId, f.exportedAt, f.parentName];
  if (f.version === 1) return JSON.stringify([...head, f.changes.map((c) => [c.id, c.assignmentId, c.oldMinutes, c.newMinutes, c.changedAt])]);
  return JSON.stringify([...head, f.changes.map((c) => [c.id, c.assignmentId, c.field, c.from, c.to, c.changedAt])]);
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return requireSubtle().importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signChanges(file: UnsignedChangesFile, secret: string): Promise<string> {
  const sig = await requireSubtle().sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(canonicalChanges(file)));
  return toB64(new Uint8Array(sig));
}

/** Constant-time verification (SubtleCrypto.verify). */
export async function verifyChanges(file: ChangesFile, secret: string): Promise<boolean> {
  try {
    const { mac, ...rest } = file;
    return await requireSubtle().verify("HMAC", await hmacKey(secret, "verify"), fromB64(mac), new TextEncoder().encode(canonicalChanges(rest as UnsignedChangesFile)));
  } catch (e) {
    if (e instanceof RepoError) throw e; // "needs a secure page" is not the same as "bad signature"
    return false;
  }
}

// ---- snapshot ---------------------------------------------------------------

/** Student device: build the shareable snapshot of this student's data. */
export function buildSnapshot(state: AppState, now: Date): Snapshot {
  const student = state.students[0];
  if (state.role !== "student" || !student || !state.pairingSecret) throw new Error("not a student device");
  return {
    app: APP_ID,
    kind: "snapshot",
    version: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    student: { id: student.id, displayName: student.displayName },
    pairingSecret: state.pairingSecret,
    assignments: state.assignments.filter((a) => a.studentId === student.id),
    sessions: state.sessions.filter((s) => s.studentId === student.id),
    history: state.history,
  };
}

/**
 * A snapshot is a moment in time. A timer that was running when it was taken
 * must not keep counting on another device, so freeze it at the export time.
 */
export function freezeSessions(sessions: readonly TimerSession[], exportedAt: Date): TimerSession[] {
  return sessions.map((s) =>
    s.state === "running"
      ? { ...s, state: "paused" as const, accumulatedSeconds: elapsedSeconds(s, exportedAt), lastResumedAt: null }
      : s,
  );
}

// ---- applying changes (shared by parent edits, the student's own schedule edits, and the student's import) ---

export type ApplyOutcome = "applied" | "superseded" | "duplicate" | "missing_assignment" | "invalid";

function latestChangeAt(state: AppState, assignmentId: string, field: ChangeField): string {
  return state.history
    .filter((h) => h.assignmentId === assignmentId && h.field === field && h.status === "applied")
    .reduce((m, h) => (h.changedAt > m ? h.changedAt : m), "");
}

type Assignment = AppState["assignments"][number];

export function readField(a: Assignment, field: ChangeField): ChangeValue {
  switch (field) {
    case "allocatedMinutes":
      return a.allocatedMinutes;
    case "plannedDate":
      return a.plannedDate;
    case "plannedStart":
      return a.plannedStart;
    case "withParent":
      return a.withParent;
    case "location":
      return a.location;
  }
}

/** Sets one field and keeps the rules between fields: no work day means no start time. */
export function writeField(a: Assignment, field: ChangeField, value: ChangeValue): void {
  switch (field) {
    case "allocatedMinutes":
      a.allocatedMinutes = value as number | null;
      return;
    case "plannedDate":
      a.plannedDate = value as string | null;
      if (value === null) a.plannedStart = null;
      return;
    case "plannedStart":
      a.plannedStart = value as string | null;
      return;
    case "withParent":
      a.withParent = value as boolean;
      return;
    case "location":
      a.location = value as string | null;
      return;
  }
}

/** The history record for a change. Allocation changes keep their minutes fields (older readers rely on them). */
export function historyEntry(
  c: { id: string; assignmentId: string; field: ChangeField; from: ChangeValue; to: ChangeValue; changedAt: string },
  actor: { id: string | null; name: string | null; role: AllocationChange["changedByRole"] },
  status: AllocationChange["status"],
): AllocationChange {
  const alloc = c.field === "allocatedMinutes";
  return {
    id: c.id,
    assignmentId: c.assignmentId,
    field: c.field,
    oldMinutes: alloc ? (c.from as number | null) : null,
    newMinutes: alloc ? (c.to as number | null) : null,
    oldValue: alloc ? null : c.from,
    newValue: alloc ? null : c.to,
    changedBy: actor.id,
    changedByName: actor.name,
    changedByRole: actor.role,
    changedAt: c.changedAt,
    status,
  };
}

/**
 * Apply a change by a parent. Last writer wins by timestamp, PER FIELD: if a newer change to the same field
 * already exists the change is kept in history as "superseded" so nothing disappears, but the current value is
 * untouched. Idempotent by id. Values are validated here too (a signed file can still carry nonsense), and a change
 * that would break a rule between fields (a start time with no work day) is refused whole: nothing is half-applied.
 */
export function applyFieldChange(
  state: AppState,
  change: FieldChange,
  actor: { id: string; name: string },
  now: Date,
): ApplyOutcome {
  if (state.history.some((h) => h.id === change.id)) return "duplicate";
  const a = state.assignments.find((x) => x.id === change.assignmentId);
  if (!a) return "missing_assignment";
  const to = normalizeFieldValue(change.field, change.to);
  if (!to.ok) return "invalid";

  const max = new Date(now.getTime() + FUTURE_TOLERANCE_MS).toISOString();
  const changedAt = change.changedAt > max ? now.toISOString() : change.changedAt;
  const wins = changedAt >= latestChangeAt(state, a.id, change.field);

  if (wins && change.field === "plannedStart" && to.value !== null && a.plannedDate === null) return "invalid";

  const from = wins ? readField(a, change.field) : change.from;
  state.history.push(historyEntry({ ...change, from, to: to.value, changedAt }, { id: actor.id, name: actor.name, role: "parent" }, wins ? "applied" : "superseded"));
  if (wins) {
    writeField(a, change.field, to.value);
    a.updatedAt = now.toISOString();
  }
  return wins ? "applied" : "superseded";
}
