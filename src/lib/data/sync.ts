import { z } from "zod";
import { elapsedSeconds } from "../domain/timer";
import type { AllocationChange, TimerSession } from "../domain/types";
import { LIMITS } from "../validation";
import {
  assignmentSchema,
  changeSchema,
  historySchema,
  sessionSchema,
  type AllocationChangeRecord,
  type AppState,
} from "./state";

/**
 * File round-trip between a student device and a parent device (no server).
 *
 *   student ──snapshot.json──▶ parent        (read-only copy of the student's data)
 *   parent  ◀──changes.json─── (parent adjusts allocations, exports a signed file)
 *   student imports changes.json              (applied automatically: no approval step)
 *
 * The snapshot carries a random pairing secret. The changes file is signed
 * (HMAC-SHA256) with it, so the student device only accepts changes produced by
 * someone who holds that student's snapshot, and detects tampering. A snapshot
 * file is therefore as sensitive as the data in it: share it only with the parent.
 */

export const FORMAT_VERSION = 1;
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

export const changesFileSchema = z.object({
  app: z.literal(APP_ID),
  kind: z.literal("changes"),
  version: z.literal(FORMAT_VERSION),
  exportedAt: z.string().min(10),
  studentId: z.string().min(1),
  parentName: z.string().min(1).max(LIMITS.displayName),
  changes: z.array(changeSchema).max(5000),
  /** base64 HMAC-SHA256 over canonicalChanges(). */
  mac: z.string().min(20),
});
export type ChangesFile = z.infer<typeof changesFileSchema>;

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

/** The exact bytes that are signed: fixed order, no ambiguity. */
export function canonicalChanges(f: Omit<ChangesFile, "mac">): string {
  return JSON.stringify([
    APP_ID,
    "changes",
    f.version,
    f.studentId,
    f.exportedAt,
    f.parentName,
    f.changes.map((c) => [c.id, c.assignmentId, c.oldMinutes, c.newMinutes, c.changedAt]),
  ]);
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signChanges(file: Omit<ChangesFile, "mac">, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(canonicalChanges(file)));
  return toB64(new Uint8Array(sig));
}

/** Constant-time verification (SubtleCrypto.verify). */
export async function verifyChanges(file: ChangesFile, secret: string): Promise<boolean> {
  try {
    const { mac, ...rest } = file;
    return await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromB64(mac), new TextEncoder().encode(canonicalChanges(rest)));
  } catch {
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

// ---- applying allocation changes (shared by parent edits and student import) ---

export type ApplyOutcome = "applied" | "superseded" | "duplicate" | "missing_assignment";

function latestChangeAt(state: AppState, assignmentId: string): string {
  return state.history.filter((h) => h.assignmentId === assignmentId && h.status === "applied").reduce((m, h) => (h.changedAt > m ? h.changedAt : m), "");
}

/**
 * Apply a parent's allocation change. Last writer wins by timestamp: if a newer
 * change already exists the change is kept in history as "superseded" so
 * nothing disappears, but the current allocation is untouched. Idempotent by id.
 * `actor` is who made the change (identity comes from the file's signed parent name).
 */
export function applyAllocationChange(
  state: AppState,
  change: AllocationChangeRecord,
  actor: { id: string; name: string },
  now: Date,
): ApplyOutcome {
  if (state.history.some((h) => h.id === change.id)) return "duplicate";
  const a = state.assignments.find((x) => x.id === change.assignmentId);
  if (!a) return "missing_assignment";

  const max = new Date(now.getTime() + FUTURE_TOLERANCE_MS).toISOString();
  const changedAt = change.changedAt > max ? now.toISOString() : change.changedAt;
  const wins = changedAt >= latestChangeAt(state, a.id);

  const entry: AllocationChange = {
    id: change.id,
    assignmentId: a.id,
    oldMinutes: wins ? a.allocatedMinutes : change.oldMinutes,
    newMinutes: change.newMinutes,
    changedBy: actor.id,
    changedByName: actor.name,
    changedByRole: "parent",
    changedAt,
    status: wins ? "applied" : "superseded",
  };
  state.history.push(entry);
  if (wins) {
    a.allocatedMinutes = change.newMinutes;
    a.updatedAt = now.toISOString();
  }
  return wins ? "applied" : "superseded";
}
