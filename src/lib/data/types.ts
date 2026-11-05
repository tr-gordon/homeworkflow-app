import type { AllocationChange, Assignment, AssignmentWithTime, Profile, TimerSession } from "../domain/types";
import type { AssignmentInput, AssignmentPatch } from "../validation";

export interface DeviceInfo {
  /** What this device is: a student's own, or a parent's. Chosen once at setup. */
  role: "student" | "parent";
  displayName: string;
  /** Student device only. */
  parentName: string | null;
  hasParentPin: boolean;
  demo: boolean;
}

export interface SnapshotImportResult {
  kind: "imported" | "restored" | "older_than_current";
  studentName: string;
  assignments: number;
  /** Parent device: own unsent changes re-applied on top of the new snapshot. */
  reappliedChanges: number;
}

export interface ChangesImportResult {
  parentName: string;
  applied: number;
  superseded: number;
  duplicates: number;
  missingAssignment: number;
}

export interface SnapshotInfo {
  exportedAt: string;
  importedAt: string;
}

/**
 * Everything the UI needs from storage. The only implementation is LocalRepo:
 * all data lives in this browser's localStorage, and nothing is sent anywhere.
 * Sharing between a student's device and a parent's device is by file
 * (see sync.ts). All methods throw RepoError with a stable `code`.
 */
export interface HomeworkRepo {
  readonly mode: "local" | "demo";

  // ---- device and identity
  /** null until first-run setup is finished. */
  getDevice(): Promise<DeviceInfo | null>;
  setup(input: { role: "student" | "parent"; displayName: string; parentName?: string }): Promise<void>;
  /** Who is using the app right now (null before setup). */
  getViewer(): Promise<Profile | null>;
  /** Student device: open the parent view for this browser session. */
  switchToParent(pin: string): Promise<void>;
  switchToStudent(): Promise<void>;
  /** Student device. Changing an existing PIN requires the current one. */
  setParentPin(input: { pin: string; parentName: string; currentPin?: string }): Promise<void>;
  eraseAllData(): Promise<void>;

  // ---- homework
  listStudents(): Promise<Profile[]>;
  listAssignments(studentId: string): Promise<AssignmentWithTime[]>;
  getAssignment(id: string): Promise<AssignmentWithTime | null>;
  createAssignment(input: AssignmentInput): Promise<Assignment>;
  updateAssignment(id: string, patch: AssignmentPatch): Promise<Assignment>;
  /** Student, or parent (parent view / parent device). Recorded in allocation history. */
  setAllocation(id: string, minutes: number | null): Promise<Assignment>;
  deleteAssignment(id: string): Promise<void>;
  /** Newest first. */
  listAllocationHistory(assignmentId: string): Promise<AllocationChange[]>;

  timerStart(assignmentId: string): Promise<TimerSession>;
  timerPause(sessionId: string): Promise<TimerSession>;
  timerResume(sessionId: string): Promise<TimerSession>;
  timerFinish(sessionId: string): Promise<TimerSession>;

  // ---- sharing by file
  /** Student device: the snapshot file content for the parent (also serves as a backup). */
  exportSnapshot(): Promise<unknown>;
  /** Parent device: add/refresh a student. Student device: restore a backup of the same student. */
  importSnapshot(file: unknown): Promise<SnapshotImportResult>;
  /** Parent device: signed file with this parent's allocation changes, or null if there are none. */
  exportChanges(studentId: string): Promise<unknown | null>;
  /** Student device: apply a parent's signed changes file (no approval step). */
  importChanges(file: unknown): Promise<ChangesImportResult>;
  /** Parent device: when a student's data was last exported by them. */
  getSnapshotInfo(studentId: string): Promise<SnapshotInfo | null>;
  /** Number of parent changes not yet sent (parent device). */
  countUnsentChanges(studentId: string): Promise<number>;
}
