import { beforeEach, describe, expect, it } from "vitest";
import { canonicalChanges, signChanges, type ChangesFileV1 } from "@/lib/data/sync";
import { elapsedSeconds } from "@/lib/domain/timer";
import { advance, clock, newInput, parentDevice, rejectsWith, studentDevice } from "./helpers";

/** What actually happens to a file: it is serialised, sent, and parsed on the other device. */
const viaFile = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeEach(() => {
  clock.now = new Date(2026, 10, 4, 16, 0, 0);
});

async function pair() {
  const student = await studentDevice();
  const parent = await parentDevice("Pat Parent");
  const a = await student.repo.createAssignment({ ...newInput, allocatedMinutes: 30 });
  const snapshot = viaFile(await student.repo.exportSnapshot());
  const imported = await parent.repo.importSnapshot(snapshot);
  return { student, parent, a, snapshot, imported };
}

describe("snapshot: student to parent", () => {
  it("gives the parent a read-only view of the student's assignments", async () => {
    const { parent, a, imported, student } = await pair();
    expect(imported).toMatchObject({ kind: "imported", studentName: "Sam Student", assignments: 1 });
    const students = await parent.repo.listStudents();
    expect(students.map((s) => s.displayName)).toEqual(["Sam Student"]);
    const seen = await parent.repo.listAssignments(student.studentId);
    expect(seen.map((x) => x.id)).toEqual([a.id]);
    await rejectsWith(parent.repo.updateAssignment(a.id, { title: "x" }), "forbidden");
    await rejectsWith(parent.repo.deleteAssignment(a.id), "forbidden");
    expect((await parent.repo.getSnapshotInfo(student.studentId))?.exportedAt).toBeTruthy();
  });

  it("freezes a timer that was running when the snapshot was taken", async () => {
    const student = await studentDevice();
    const parent = await parentDevice();
    const a = await student.repo.createAssignment(newInput);
    await student.repo.timerStart(a.id);
    advance(600);
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    advance(7200); // two hours pass on the parent's device
    const seen = (await parent.repo.getAssignment(a.id))!.sessions[0];
    expect(seen.state).toBe("paused");
    expect(elapsedSeconds(seen, clock.now)).toBe(600);
  });

  it("ignores an older snapshot than the one already imported", async () => {
    const { student, parent } = await pair();
    const older = viaFile(await student.repo.exportSnapshot());
    advance(3600);
    await student.repo.createAssignment({ ...newInput, title: "Newer" });
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    expect(await parent.repo.importSnapshot(older)).toMatchObject({ kind: "older_than_current" });
    expect((await parent.repo.listAssignments(student.studentId)).length).toBe(2);
  });

  it("rejects files that are not valid snapshots", async () => {
    const { parent, snapshot } = await pair();
    await rejectsWith(parent.repo.importSnapshot({ hello: "world" }), "invalid_file");
    await rejectsWith(parent.repo.importSnapshot(null), "invalid_file");
    await rejectsWith(parent.repo.importSnapshot({ ...(snapshot as object), version: 0 }), "invalid_file");
    await rejectsWith(parent.repo.importSnapshot({ ...(snapshot as object), kind: "changes" }), "invalid_file");
    // A file from a newer version of the app gets its own, helpful answer instead of "not a HomeworkFlow file".
    await rejectsWith(parent.repo.importSnapshot({ ...(snapshot as object), version: 7 }), "newer_version");
  });

  it("rejects a snapshot whose records belong to a different student", async () => {
    const { parent, snapshot } = await pair();
    const bad = viaFile(snapshot) as { assignments: { studentId: string }[] };
    bad.assignments[0].studentId = "someone-else";
    await rejectsWith(parent.repo.importSnapshot(bad), "invalid_file");
  });

  it("supports two students on one parent device", async () => {
    const { parent } = await pair();
    const sib = await studentDevice();
    await sib.repo.createAssignment({ ...newInput, title: "Sibling work" });
    await parent.repo.importSnapshot(viaFile(await sib.repo.exportSnapshot()));
    expect((await parent.repo.listStudents()).length).toBe(2);
  });
});

describe("changes: parent to student (T2, T3)", () => {
  it("applies a parent's allocation change on import, with no approval step, and attributes it", async () => {
    const { student, parent, a } = await pair();
    advance(120);
    await parent.repo.setAllocation(a.id, 45);
    expect(await parent.repo.countUnsentChanges(student.studentId)).toBe(1);

    const file = viaFile(await parent.repo.exportChanges(student.studentId));
    const result = await student.repo.importChanges(file);
    expect(result).toMatchObject({ parentName: "Pat Parent", applied: 1, superseded: 0, duplicates: 0 });

    expect((await student.repo.getAssignment(a.id))?.allocatedMinutes).toBe(45);
    const h = (await student.repo.listAllocationHistory(a.id))[0];
    expect(h).toMatchObject({ changedByRole: "parent", changedByName: "Pat Parent", oldMinutes: 30, newMinutes: 45, status: "applied" });
    expect(h.changedAt).toBe(new Date(2026, 10, 4, 16, 2, 0).toISOString()); // the parent's time, not import time
  });

  it("is idempotent: importing the same file twice changes nothing the second time", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId));
    await student.repo.importChanges(file);
    expect(await student.repo.importChanges(file)).toMatchObject({ applied: 0, duplicates: 1 });
    expect(await student.repo.listAllocationHistory(a.id)).toHaveLength(2); // creation + one parent change
  });

  it("replays several edits in order", async () => {
    const { student, parent, a } = await pair();
    advance(60);
    await parent.repo.setAllocation(a.id, 40);
    advance(60);
    await parent.repo.setAllocation(a.id, 50);
    const result = await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    expect(result.applied).toBe(2);
    expect((await student.repo.getAssignment(a.id))?.allocatedMinutes).toBe(50);
  });

  it("returns null when there is nothing to send", async () => {
    const { parent, student } = await pair();
    expect(await parent.repo.exportChanges(student.studentId)).toBeNull();
    await rejectsWith(parent.repo.exportChanges("unknown-student"), "not_found");
  });

  it("resolves conflicts newest-first: an older parent change is recorded but not applied", async () => {
    const { student, parent, a } = await pair();
    advance(60);
    await parent.repo.setAllocation(a.id, 45); // parent, 16:01
    advance(60);
    await student.repo.updateAssignment(a.id, { allocatedMinutes: 20 }); // student, 16:02, before importing
    const result = await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    expect(result).toMatchObject({ applied: 0, superseded: 1 });
    expect((await student.repo.getAssignment(a.id))?.allocatedMinutes).toBe(20);
    const h = await student.repo.listAllocationHistory(a.id);
    expect(h.find((x) => x.changedByRole === "parent")).toMatchObject({ status: "superseded", newMinutes: 45 });
  });

  it("a newer parent change wins over an older student change", async () => {
    const { student, parent, a } = await pair();
    advance(60);
    await student.repo.updateAssignment(a.id, { allocatedMinutes: 20 }); // student 16:01
    advance(60);
    await parent.repo.setAllocation(a.id, 45); // parent 16:02
    const result = await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    expect(result.applied).toBe(1);
    expect((await student.repo.getAssignment(a.id))?.allocatedMinutes).toBe(45);
  });

  it("counts changes for assignments the student has since deleted", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    await student.repo.deleteAssignment(a.id);
    expect(await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)))).toMatchObject({ applied: 0, missingAssignment: 1 });
  });

  it("clamps a change dated far in the future to the current time", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV1;
    const forged = { ...file, changes: file.changes.map((c) => ({ ...c, changedAt: "2099-01-01T00:00:00.000Z" })) };
    forged.mac = await signChanges(forged, (await student.repo.exportSnapshot() as { pairingSecret: string }).pairingSecret);
    await student.repo.importChanges(forged);
    expect((await student.repo.listAllocationHistory(a.id))[0].changedAt).toBe(clock.now.toISOString());
  });

  it("two parents can both send changes", async () => {
    const { student, parent, a, snapshot } = await pair();
    const other = await parentDevice("Alex Guardian");
    await other.repo.importSnapshot(snapshot);
    advance(60);
    await parent.repo.setAllocation(a.id, 40);
    advance(60);
    await other.repo.setAllocation(a.id, 55);
    await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    await student.repo.importChanges(viaFile(await other.repo.exportChanges(student.studentId)));
    expect((await student.repo.getAssignment(a.id))?.allocatedMinutes).toBe(55);
    const names = (await student.repo.listAllocationHistory(a.id)).map((h) => h.changedByName);
    expect(names).toContain("Pat Parent");
    expect(names).toContain("Alex Guardian");
  });
});

describe("authenticity of changes files (bad_signature, wrong_student)", () => {
  it("rejects a file edited after it was signed", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV1;
    file.changes[0].newMinutes = 600; // tamper
    await rejectsWith(student.repo.importChanges(file), "bad_signature");
    expect((await student.repo.getAssignment(a.id))?.allocatedMinutes).toBe(30);
  });

  it("rejects a file signed with a different secret (someone who never had the snapshot)", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV1;
    const { mac: _mac, ...rest } = file;
    void _mac;
    const forged: ChangesFileV1 = { ...rest, mac: await signChanges(rest, "a-totally-different-secret-value-123") };
    await rejectsWith(student.repo.importChanges(forged), "bad_signature");
  });

  it("rejects a file made for another student, even if validly signed", async () => {
    const { parent, a, student } = await pair();
    const other = await studentDevice(); // a different student with their own secret
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId));
    await rejectsWith(other.repo.importChanges(file), "wrong_student");
  });

  it("rejects malformed files and files with no signature", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId)) as Record<string, unknown>;
    delete file.mac;
    await rejectsWith(student.repo.importChanges(file), "invalid_file");
    await rejectsWith(student.repo.importChanges("not an object"), "invalid_file");
    await rejectsWith(student.repo.importChanges({ ...file, kind: "snapshot", mac: "x".repeat(30) }), "invalid_file");
  });

  it("signatures cover every field (changing the parent's name invalidates the file)", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV1;
    await rejectsWith(student.repo.importChanges({ ...file, parentName: "Someone Else" }), "bad_signature");
    expect(canonicalChanges(file)).toContain("Pat Parent");
  });

  it("only a student device can import changes, only a parent device can export them", async () => {
    const { parent, student, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId));
    await rejectsWith(parent.repo.importChanges(file), "unsupported_here");
    await rejectsWith(student.repo.exportChanges(student.studentId), "unsupported_here");
  });
});

describe("a full cycle keeps both devices consistent", () => {
  it("the outbox clears once the student's next snapshot confirms the change", async () => {
    const { student, parent, a } = await pair();
    advance(60);
    await parent.repo.setAllocation(a.id, 45);
    await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    advance(60);
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    expect(await parent.repo.countUnsentChanges(student.studentId)).toBe(0);
    expect((await parent.repo.getAssignment(a.id))?.allocatedMinutes).toBe(45);
    expect((await parent.repo.listAllocationHistory(a.id)).filter((h) => h.changedByRole === "parent")).toHaveLength(1);
  });

  it("a newer snapshot never loses the parent's unsent change", async () => {
    const { student, parent, a } = await pair();
    advance(60);
    await student.repo.createAssignment({ ...newInput, title: "Another" });
    advance(60);
    await parent.repo.setAllocation(a.id, 45); // not sent yet
    advance(60);
    const result = await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot())); // student's newer data
    expect(result.reappliedChanges).toBe(1);
    expect((await parent.repo.getAssignment(a.id))?.allocatedMinutes).toBe(45);
    expect(await parent.repo.countUnsentChanges(student.studentId)).toBe(1);
    expect((await parent.repo.listAssignments(student.studentId)).length).toBe(2);
  });
});

describe("backup and restore (student device)", () => {
  it("restores the same student's data onto a fresh device", async () => {
    const { student, a } = await pair();
    const backup = viaFile(await student.repo.exportSnapshot());
    const fresh = await studentDevice();
    // A fresh device with no data adopts the backed-up student.
    expect(await fresh.repo.importSnapshot(backup)).toMatchObject({ kind: "restored", studentName: "Sam Student" });
    expect((await fresh.repo.listAssignments((await fresh.repo.getViewer())!.id)).map((x) => x.id)).toEqual([a.id]);
  });

  it("refuses to overwrite a device that already has a different student's data", async () => {
    const { snapshot } = await pair();
    const other = await studentDevice();
    await other.repo.createAssignment(newInput);
    await rejectsWith(other.repo.importSnapshot(snapshot), "wrong_student");
  });

  it("a restored device can still verify its parent's signed changes", async () => {
    const { student, parent, a } = await pair();
    const backup = viaFile(await student.repo.exportSnapshot());
    const fresh = await studentDevice();
    await fresh.repo.importSnapshot(backup);
    await parent.repo.setAllocation(a.id, 45);
    const result = await fresh.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    expect(result.applied).toBe(1);
  });
});
