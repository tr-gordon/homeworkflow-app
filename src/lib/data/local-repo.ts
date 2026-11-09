import {
  TimerError,
  finishSession,
  isActive,
  newSession,
  pauseSession,
  resumeSession,
} from "../domain/timer";
import { isDone } from "../domain/stages";
import type { AllocationChange, Assignment, AssignmentWithTime, Profile, TimerSession } from "../domain/types";
import { CHANGE_FIELDS, SCHEDULE_FIELDS, normalizeFieldValue, type ChangeField, type ChangeValue } from "../domain/changes";
import {
  assignmentInputSchema,
  assignmentPatchSchema,
  displayNameSchema,
  minutesSchema,
  pinSchema,
  schedulePatchSchema,
  type AssignmentInput,
  type AssignmentPatch,
  type SchedulePatch,
} from "../validation";
import { newId as randomId } from "../ids";
import { buildDemoState } from "./demo-seed";
import { RepoError } from "./errors";
import { LOCK_MS, MAX_FAILURES, PIN_ITERATIONS, hashPin, verifyPin } from "./pin";
import { emptyState, stateSchema, type AppState, type FieldChange } from "./state";
import {
  applyFieldChange,
  buildSnapshot,
  freezeSessions,
  historyEntry,
  newPairingSecret,
  newerVersionThanSupported,
  parseChangesFile,
  readField,
  signChanges,
  snapshotSchema,
  toUnsignedChangesFile,
  verifyChanges,
  writeField,
} from "./sync";
import type { ChangesImportResult, DeviceInfo, HomeworkRepo, SnapshotImportResult, SnapshotInfo } from "./types";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

export const STORAGE_KEY = "homeworkflow.v2";
export const DEMO_STORAGE_KEY = "homeworkflow.demo.v2";
const MODE_KEY = "homeworkflow.view";

export interface LocalRepoOptions {
  demo?: boolean;
  clock?: () => Date;
  newId?: () => string;
  pinIterations?: number;
}

/**
 * The data layer: ONE JSON blob in localStorage, validated on every load.
 * There is no server. A second store (sessionStorage) remembers only that the
 * parent view is open, so closing the tab returns a shared device to the student.
 *
 * State is re-read on every call, so a new LocalRepo over the same store behaves
 * like a page refresh (and two tabs stay consistent).
 */
export class LocalRepo implements HomeworkRepo {
  readonly mode: "local" | "demo";
  private readonly key: string;
  private readonly clock: () => Date;
  private readonly newId: () => string;
  private readonly pinIterations: number;

  constructor(
    private readonly store: KeyValueStore,
    private readonly session: KeyValueStore,
    opts: LocalRepoOptions = {},
  ) {
    this.mode = opts.demo ? "demo" : "local";
    this.key = opts.demo ? DEMO_STORAGE_KEY : STORAGE_KEY;
    this.clock = opts.clock ?? (() => new Date());
    this.newId = opts.newId ?? (() => randomId());
    this.pinIterations = opts.pinIterations ?? PIN_ITERATIONS;
  }

  // ---- state ---------------------------------------------------------------

  private load(): AppState {
    const raw = this.store.getItem(this.key);
    if (raw === null) {
      const fresh = this.mode === "demo" ? buildDemoState(this.clock(), this.newId()) : emptyState(this.newId());
      this.save(fresh);
      return fresh;
    }
    try {
      const parsed = stateSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through
    }
    if (this.mode === "demo") {
      const fresh = buildDemoState(this.clock(), this.newId());
      this.save(fresh);
      return fresh;
    }
    // Real data: never overwrite. Keep a copy and stop, so the person can decide.
    this.store.setItem(`${this.key}.corrupt`, raw);
    throw new RepoError("corrupt_data");
  }

  private save(state: AppState): void {
    this.store.setItem(this.key, JSON.stringify(state));
  }

  private requireSetUp(s: AppState): "student" | "parent" {
    if (s.role === null) throw new RepoError("not_set_up");
    return s.role;
  }

  private parentViewOpen(): boolean {
    return this.session.getItem(MODE_KEY) === "parent";
  }

  private viewerOf(s: AppState): Profile {
    const role = this.requireSetUp(s);
    if (role === "parent") return { id: s.deviceId, role: "parent", displayName: s.displayName };
    if (this.parentViewOpen()) return { id: `parent:${s.deviceId}`, role: "parent", displayName: s.parentName ?? "Parent" };
    const st = s.students[0];
    if (!st) throw new RepoError("not_set_up");
    return { id: st.id, role: "student", displayName: st.displayName };
  }

  private requireStudentView(s: AppState): Profile {
    const v = this.viewerOf(s);
    if (v.role !== "student") throw new RepoError("forbidden");
    return v;
  }

  private canRead(s: AppState, v: Profile, studentId: string): boolean {
    return v.role === "student" ? v.id === studentId : s.students.some((x) => x.id === studentId);
  }

  private find(s: AppState, id: string): Assignment {
    const a = s.assignments.find((x) => x.id === id);
    const v = this.viewerOf(s);
    // Rows you may not read behave as if they do not exist.
    if (!a || !this.canRead(s, v, a.studentId)) throw new RepoError("not_found");
    return a;
  }

  private withTime(s: AppState, a: Assignment): AssignmentWithTime {
    return { ...a, sessions: s.sessions.filter((x) => x.assignmentId === a.id) };
  }

  private parse<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof RepoError) throw e;
      throw new RepoError("validation");
    }
  }

  /** Every change the student (or a parent in the parent view) makes is recorded, so history and "newest wins" see it. */
  private logChange(s: AppState, a: Assignment, field: ChangeField, from: ChangeValue, to: ChangeValue, actor: Profile): void {
    if (from === to) return;
    s.history.push(
      historyEntry({ id: this.newId(), assignmentId: a.id, field, from, to, changedAt: this.clock().toISOString() }, { id: actor.id, name: actor.displayName, role: actor.role }, "applied"),
    );
  }

  /** The fields whose changes are tracked, as they are now. */
  private snapshotOf(a: Assignment): Record<ChangeField, ChangeValue> {
    return Object.fromEntries(CHANGE_FIELDS.map((f) => [f, readField(a, f)])) as Record<ChangeField, ChangeValue>;
  }

  // ---- device and identity ---------------------------------------------------

  async getDevice(): Promise<DeviceInfo | null> {
    const s = this.load();
    if (s.role === null) return null;
    return { role: s.role, displayName: s.displayName, parentName: s.parentName, hasParentPin: s.pin !== null, demo: s.demo };
  }

  async setup(input: { role: "student" | "parent"; displayName: string; parentName?: string }): Promise<void> {
    const s = this.load();
    if (s.role !== null) throw new RepoError("forbidden");
    const name = this.parse(() => displayNameSchema.parse(input.displayName));
    s.role = input.role;
    s.displayName = name;
    if (input.role === "student") {
      s.students = [{ id: this.newId(), displayName: name }];
      s.pairingSecret = newPairingSecret();
      if (input.parentName) s.parentName = this.parse(() => displayNameSchema.parse(input.parentName));
    }
    this.save(s);
  }

  async getViewer(): Promise<Profile | null> {
    const s = this.load();
    return s.role === null ? null : this.viewerOf(s);
  }

  async switchToParent(pin: string): Promise<void> {
    const s = this.load();
    if (this.requireSetUp(s) !== "student") throw new RepoError("unsupported_here");
    if (s.demo) {
      this.session.setItem(MODE_KEY, "parent");
      return;
    }
    if (!s.pin) throw new RepoError("pin_not_set");
    const now = this.clock();
    if (s.pinLockedUntil && new Date(s.pinLockedUntil) > now) throw new RepoError("pin_locked");
    if (!(await verifyPin(pin, s.pin))) {
      s.pinFailures += 1;
      if (s.pinFailures >= MAX_FAILURES) {
        s.pinFailures = 0;
        s.pinLockedUntil = new Date(now.getTime() + LOCK_MS).toISOString();
      }
      this.save(s);
      throw new RepoError(s.pinLockedUntil && new Date(s.pinLockedUntil) > now ? "pin_locked" : "wrong_pin");
    }
    s.pinFailures = 0;
    s.pinLockedUntil = null;
    this.save(s);
    this.session.setItem(MODE_KEY, "parent");
  }

  async switchToStudent(): Promise<void> {
    this.session.removeItem(MODE_KEY);
  }

  async setParentPin(input: { pin: string; parentName: string; currentPin?: string }): Promise<void> {
    const s = this.load();
    if (this.requireSetUp(s) !== "student") throw new RepoError("unsupported_here");
    const pin = this.parse(() => pinSchema.parse(input.pin));
    const name = this.parse(() => displayNameSchema.parse(input.parentName));
    if (s.pin && !(await verifyPin(input.currentPin ?? "", s.pin))) throw new RepoError("wrong_pin");
    s.pin = await hashPin(pin, this.pinIterations);
    s.parentName = name;
    s.pinFailures = 0;
    s.pinLockedUntil = null;
    this.save(s);
  }

  async eraseAllData(): Promise<void> {
    this.store.removeItem(this.key);
    this.store.removeItem(`${this.key}.corrupt`);
    this.session.removeItem(MODE_KEY);
  }

  // ---- homework ---------------------------------------------------------------

  async listStudents(): Promise<Profile[]> {
    const s = this.load();
    const v = this.viewerOf(s);
    if (v.role === "student") return [v];
    return s.students.map((x) => ({ id: x.id, role: "student" as const, displayName: x.displayName }));
  }

  async listAssignments(studentId: string): Promise<AssignmentWithTime[]> {
    const s = this.load();
    const v = this.viewerOf(s);
    if (!this.canRead(s, v, studentId)) return [];
    return s.assignments
      .filter((a) => a.studentId === studentId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((a) => this.withTime(s, a));
  }

  async getAssignment(id: string): Promise<AssignmentWithTime | null> {
    const s = this.load();
    const v = this.viewerOf(s);
    const a = s.assignments.find((x) => x.id === id);
    if (!a || !this.canRead(s, v, a.studentId)) return null;
    return this.withTime(s, a);
  }

  async createAssignment(input: AssignmentInput): Promise<Assignment> {
    const s = this.load();
    const v = this.requireStudentView(s);
    const data = this.parse(() => assignmentInputSchema.parse(input));
    const now = this.clock().toISOString();
    const a: Assignment = {
      id: this.newId(),
      studentId: v.id,
      title: data.title,
      subject: data.subject,
      description: data.description,
      dueDate: data.dueDate,
      difficulty: data.difficulty,
      stage: "not_started",
      allocatedMinutes: data.allocatedMinutes,
      plannedDate: data.plannedDate,
      plannedStart: data.plannedStart ?? null,
      withParent: data.withParent ?? false,
      location: data.location || null,
      archivedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    if (a.plannedStart !== null && a.plannedDate === null) throw new RepoError("validation"); // a start time needs a work day
    s.assignments.push(a);
    this.logChange(s, a, "allocatedMinutes", null, a.allocatedMinutes, v);
    this.save(s);
    return a;
  }

  async updateAssignment(id: string, patch: AssignmentPatch): Promise<Assignment> {
    const s = this.load();
    const v = this.viewerOf(s);
    const a = this.find(s, id);
    // A parent may only change allocation (use setAllocation).
    if (v.role !== "student") throw new RepoError("forbidden");
    const p = this.parse(() => assignmentPatchSchema.parse(patch));
    const before = this.snapshotOf(a);
    if (p.title !== undefined) a.title = p.title;
    if (p.subject !== undefined) a.subject = p.subject;
    if (p.description !== undefined) a.description = p.description;
    if (p.dueDate !== undefined) a.dueDate = p.dueDate;
    if (p.difficulty !== undefined) a.difficulty = p.difficulty;
    if (p.plannedDate !== undefined) writeField(a, "plannedDate", p.plannedDate); // no work day means no start time
    if (p.plannedStart !== undefined) a.plannedStart = p.plannedStart;
    if (p.withParent !== undefined) a.withParent = p.withParent;
    if (p.location !== undefined) a.location = p.location || null;
    if (p.allocatedMinutes !== undefined) a.allocatedMinutes = p.allocatedMinutes;
    if (a.plannedStart !== null && a.plannedDate === null) throw new RepoError("validation"); // nothing is saved on error
    if (p.stage !== undefined) {
      if (isDone(p.stage) && !isDone(a.stage)) a.completedAt = this.clock().toISOString();
      if (!isDone(p.stage)) a.completedAt = null;
      a.stage = p.stage;
    }
    a.updatedAt = this.clock().toISOString();
    for (const f of CHANGE_FIELDS) this.logChange(s, a, f, before[f], readField(a, f), v);
    this.save(s);
    return a;
  }

  /**
   * The schedule: work day, start time, "work together" flag and place. The student's change applies and is logged; a
   * parent's change in the parent view applies directly; from a parent's own device it also goes to the outbox.
   */
  async setSchedule(id: string, patch: SchedulePatch): Promise<Assignment> {
    const s = this.load();
    const v = this.viewerOf(s);
    const a = this.find(s, id);
    const p = this.parse(() => schedulePatchSchema.parse(patch));

    // What each field should become; a start time needs a work day, and no work day clears the start time.
    const want: Record<(typeof SCHEDULE_FIELDS)[number], ChangeValue> = {
      plannedDate: p.plannedDate !== undefined ? p.plannedDate : a.plannedDate,
      plannedStart: p.plannedStart !== undefined ? p.plannedStart : a.plannedStart,
      withParent: p.withParent !== undefined ? p.withParent : a.withParent,
      location: p.location !== undefined ? (p.location ? p.location : null) : a.location,
    };
    if (want.plannedDate === null) {
      if (p.plannedStart) throw new RepoError("validation"); // asked for a start time but no work day
      want.plannedStart = null;
    }
    const now = this.clock();
    const changes: FieldChange[] = [];
    for (const f of SCHEDULE_FIELDS) {
      const to = normalizeFieldValue(f, want[f]);
      if (!to.ok) throw new RepoError("validation");
      if (to.value !== readField(a, f)) changes.push({ id: this.newId(), assignmentId: a.id, field: f, from: readField(a, f), to: to.value, changedAt: now.toISOString() });
    }
    if (changes.length === 0) return a;

    if (v.role === "student") {
      for (const c of changes) {
        writeField(a, c.field, c.to);
        this.logChange(s, a, c.field, c.from, c.to, v);
      }
      a.updatedAt = now.toISOString();
    } else {
      // The parent view and a parent's device: same rules as a changes file, newest change wins per field.
      for (const c of changes) {
        const outcome = applyFieldChange(s, c, { id: v.id, name: v.displayName }, now);
        if (outcome === "invalid") throw new RepoError("validation");
        // On a parent's own device the change must travel to the student as a file.
        if (s.role === "parent" && (outcome === "applied" || outcome === "superseded")) s.outbox.push({ ...c, studentId: a.studentId });
      }
    }
    this.save(s);
    return a;
  }

  async setAllocation(id: string, minutes: number | null): Promise<Assignment> {
    const s = this.load();
    const v = this.viewerOf(s);
    const a = this.find(s, id);
    const value = this.parse(() => (minutes === null ? null : minutesSchema.parse(minutes)));
    if (v.role === "student") {
      const old = a.allocatedMinutes;
      a.allocatedMinutes = value;
      a.updatedAt = this.clock().toISOString();
      this.logChange(s, a, "allocatedMinutes", old, value, v);
    } else {
      if (value === a.allocatedMinutes) return a;
      const now = this.clock();
      const change: FieldChange = { id: this.newId(), assignmentId: a.id, field: "allocatedMinutes", from: a.allocatedMinutes, to: value, changedAt: now.toISOString() };
      applyFieldChange(s, change, { id: v.id, name: v.displayName }, now);
      // On a parent's own device the change must travel to the student as a file.
      if (s.role === "parent") s.outbox.push({ ...change, studentId: a.studentId });
    }
    this.save(s);
    return a;
  }

  async archiveAssignments(ids: string[]): Promise<number> {
    const s = this.load();
    this.requireStudentView(s);
    const targets = [...new Set(ids)].map((id) => this.find(s, id)); // not_found if any is not theirs
    // All or nothing: never archive half of a selection and then fail.
    if (targets.some((a) => s.sessions.some((t) => t.assignmentId === a.id && isActive(t.state)))) {
      throw new RepoError("assignment_busy");
    }
    const now = this.clock().toISOString();
    let changed = 0;
    for (const a of targets) {
      if (a.archivedAt) continue;
      a.archivedAt = now;
      a.updatedAt = now;
      changed += 1;
    }
    if (changed > 0) this.save(s);
    return changed;
  }

  async restoreAssignment(id: string): Promise<Assignment> {
    const s = this.load();
    this.requireStudentView(s);
    const a = this.find(s, id);
    if (a.archivedAt) {
      a.archivedAt = null;
      a.updatedAt = this.clock().toISOString();
      this.save(s);
    }
    return a;
  }

  async deleteAssignment(id: string): Promise<void> {
    const s = this.load();
    this.requireStudentView(s);
    this.find(s, id);
    s.assignments = s.assignments.filter((x) => x.id !== id);
    s.sessions = s.sessions.filter((x) => x.assignmentId !== id);
    s.history = s.history.filter((h) => h.assignmentId !== id);
    this.save(s);
  }

  async listAllocationHistory(assignmentId: string): Promise<AllocationChange[]> {
    const s = this.load();
    this.find(s, assignmentId);
    // Newest first; entries with the same timestamp keep a deterministic order (latest appended first).
    return s.history
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.assignmentId === assignmentId)
      .sort((a, b) => b.h.changedAt.localeCompare(a.h.changedAt) || b.i - a.i)
      .map(({ h }) => h);
  }

  // ---- timer ------------------------------------------------------------------

  private timerOp(sessionId: string, fn: (t: TimerSession, now: Date) => TimerSession): TimerSession {
    const s = this.load();
    const v = this.requireStudentView(s);
    const idx = s.sessions.findIndex((x) => x.id === sessionId && x.studentId === v.id);
    if (idx < 0) throw new RepoError("timer_not_found");
    try {
      const next = fn(s.sessions[idx], this.clock());
      s.sessions[idx] = next;
      this.save(s);
      return next;
    } catch (e) {
      if (e instanceof TimerError) throw new RepoError(e.code);
      throw e;
    }
  }

  async getActiveTimer(): Promise<{ session: TimerSession; assignment: Assignment } | null> {
    const s = this.load();
    const v = this.viewerOf(s);
    if (v.role !== "student") return null;
    const session = s.sessions.find((x) => x.studentId === v.id && isActive(x.state));
    const assignment = session && s.assignments.find((a) => a.id === session.assignmentId);
    return session && assignment ? { session, assignment } : null;
  }

  async timerStart(assignmentId: string): Promise<TimerSession> {
    const s = this.load();
    const v = this.requireStudentView(s);
    const target = s.assignments.find((x) => x.id === assignmentId && x.studentId === v.id);
    if (!target) throw new RepoError("not_found");
    if (target.archivedAt) throw new RepoError("assignment_archived");
    if (s.sessions.some((x) => x.studentId === v.id && isActive(x.state))) throw new RepoError("timer_active_exists");
    const t = newSession(this.newId(), assignmentId, v.id, this.clock());
    s.sessions.push(t);
    this.save(s);
    return t;
  }
  async timerPause(sessionId: string) {
    return this.timerOp(sessionId, pauseSession);
  }
  async timerResume(sessionId: string) {
    return this.timerOp(sessionId, resumeSession);
  }
  async timerFinish(sessionId: string) {
    return this.timerOp(sessionId, finishSession);
  }

  // ---- sharing by file ----------------------------------------------------------

  async exportSnapshot(): Promise<unknown> {
    const s = this.load();
    if (this.requireSetUp(s) !== "student") throw new RepoError("unsupported_here");
    return buildSnapshot(s, this.clock());
  }

  async importSnapshot(raw: unknown): Promise<SnapshotImportResult> {
    const s = this.load();
    const role = this.requireSetUp(s);
    if (newerVersionThanSupported(raw) !== null) throw new RepoError("newer_version");
    const parsed = snapshotSchema.safeParse(raw);
    if (!parsed.success) throw new RepoError("invalid_file");
    const snap = parsed.data;
    const exportedAt = new Date(snap.exportedAt);
    if (Number.isNaN(exportedAt.getTime())) throw new RepoError("invalid_file");
    // Every record must belong to the student named in the file.
    const assignmentIds = new Set(snap.assignments.map((a) => a.id));
    if (
      snap.assignments.some((a) => a.studentId !== snap.student.id) ||
      snap.sessions.some((t) => t.studentId !== snap.student.id || !assignmentIds.has(t.assignmentId)) ||
      snap.history.some((h) => !assignmentIds.has(h.assignmentId))
    ) {
      throw new RepoError("invalid_file");
    }
    const sessions = freezeSessions(snap.sessions, exportedAt);

    if (role === "student") {
      // Restore a backup of THIS student, or onto a fresh device with no data yet.
      const mine = s.students[0];
      const empty = s.assignments.length === 0 && s.sessions.length === 0;
      if (!mine || (mine.id !== snap.student.id && !empty)) throw new RepoError("wrong_student");
      s.students = [{ id: snap.student.id, displayName: snap.student.displayName }];
      s.displayName = snap.student.displayName;
      s.pairingSecret = snap.pairingSecret;
      s.assignments = snap.assignments;
      s.sessions = sessions;
      s.history = snap.history;
      this.save(s);
      return { kind: "restored", studentName: snap.student.displayName, assignments: snap.assignments.length, reappliedChanges: 0 };
    }

    const known = s.snapshots[snap.student.id];
    if (known && known.exportedAt > snap.exportedAt) {
      return { kind: "older_than_current", studentName: snap.student.displayName, assignments: 0, reappliedChanges: 0 };
    }
    const oldIds = new Set(s.assignments.filter((a) => a.studentId === snap.student.id).map((a) => a.id));
    s.assignments = [...s.assignments.filter((a) => a.studentId !== snap.student.id), ...snap.assignments];
    s.sessions = [...s.sessions.filter((t) => t.studentId !== snap.student.id), ...sessions];
    s.history = [...s.history.filter((h) => !oldIds.has(h.assignmentId)), ...snap.history];
    const existing = s.students.find((x) => x.id === snap.student.id);
    if (existing) existing.displayName = snap.student.displayName;
    else s.students.push({ id: snap.student.id, displayName: snap.student.displayName });
    s.snapshots[snap.student.id] = { exportedAt: snap.exportedAt, importedAt: this.clock().toISOString(), pairingSecret: snap.pairingSecret };

    // Changes the student has already received are in the new snapshot's history: drop them.
    // The rest are re-applied on top (newest change wins), so nothing the parent did is lost.
    const seen = new Set(snap.history.map((h) => h.id));
    const pending = s.outbox.filter((c) => c.studentId === snap.student.id && !seen.has(c.id));
    s.outbox = s.outbox.filter((c) => c.studentId !== snap.student.id);
    let reapplied = 0;
    for (const c of pending) {
      const outcome = applyFieldChange(s, c, { id: s.deviceId, name: s.displayName }, this.clock());
      if (outcome === "applied") {
        reapplied += 1;
        s.outbox.push(c);
      }
    }
    this.save(s);
    return { kind: "imported", studentName: snap.student.displayName, assignments: snap.assignments.length, reappliedChanges: reapplied };
  }

  async exportChanges(studentId: string): Promise<unknown | null> {
    const s = this.load();
    if (this.requireSetUp(s) !== "parent") throw new RepoError("unsupported_here");
    const known = s.snapshots[studentId];
    if (!known) throw new RepoError("not_found");
    const changes: FieldChange[] = s.outbox
      .filter((c) => c.studentId === studentId)
      .map((c) => ({ id: c.id, assignmentId: c.assignmentId, field: c.field, from: c.from, to: c.to, changedAt: c.changedAt }));
    if (changes.length === 0) return null;
    // Version 1 (allocation only) when that is all there is, so a student app that has not updated yet still reads it.
    const unsigned = toUnsignedChangesFile({ exportedAt: this.clock().toISOString(), studentId, parentName: s.displayName, changes });
    return { ...unsigned, mac: await signChanges(unsigned, known.pairingSecret) };
  }

  async importChanges(raw: unknown): Promise<ChangesImportResult> {
    const s = this.load();
    if (this.requireSetUp(s) !== "student") throw new RepoError("unsupported_here");
    if (newerVersionThanSupported(raw) !== null) throw new RepoError("newer_version");
    const file = parseChangesFile(raw);
    if (!file) throw new RepoError("invalid_file");
    const mine = s.students[0];
    if (!mine || file.studentId !== mine.id) throw new RepoError("wrong_student");
    if (!s.pairingSecret || !(await verifyChanges(file.raw, s.pairingSecret))) throw new RepoError("bad_signature");

    const result: ChangesImportResult = { parentName: file.parentName, applied: 0, superseded: 0, duplicates: 0, missingAssignment: 0, invalid: 0 };
    const now = this.clock();
    // Oldest first so a sequence of edits is replayed in order.
    for (const c of [...file.changes].sort((a, b) => a.changedAt.localeCompare(b.changedAt))) {
      const outcome = applyFieldChange(s, c, { id: `parent-file:${file.parentName}`, name: file.parentName }, now);
      if (outcome === "applied") result.applied += 1;
      else if (outcome === "superseded") result.superseded += 1;
      else if (outcome === "duplicate") result.duplicates += 1;
      else if (outcome === "invalid") result.invalid += 1;
      else result.missingAssignment += 1;
    }
    this.save(s);
    return result;
  }

  async getSnapshotInfo(studentId: string): Promise<SnapshotInfo | null> {
    const k = this.load().snapshots[studentId];
    return k ? { exportedAt: k.exportedAt, importedAt: k.importedAt } : null;
  }

  async countUnsentChanges(studentId: string): Promise<number> {
    return this.load().outbox.filter((c) => c.studentId === studentId).length;
  }
}
