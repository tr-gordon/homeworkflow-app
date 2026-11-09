import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "@/lib/data/local-repo";
import { canonicalChanges, signChanges, type ChangesFileV1, type ChangesFileV2, type UnsignedChangesFile } from "@/lib/data/sync";
import type { FieldChange } from "@/lib/data/state";
import { advance, clock, newInput, parentDevice, rejectsWith, studentDevice } from "./helpers";

const viaFile = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeEach(() => {
  clock.now = new Date(2026, 10, 4, 16, 0, 0);
});

async function pair() {
  const student = await studentDevice();
  const parent = await parentDevice("Pat Parent");
  const a = await student.repo.createAssignment({ ...newInput, allocatedMinutes: 30 });
  const snapshot = viaFile(await student.repo.exportSnapshot()) as { pairingSecret: string };
  await parent.repo.importSnapshot(snapshot);
  return { student, parent, a, secret: snapshot.pairingSecret };
}

const history = async (repo: { listAllocationHistory(id: string): Promise<{ field: string; changedByRole: string; status: string; oldValue: unknown; newValue: unknown; oldMinutes: number | null; newMinutes: number | null }[]> }, id: string) => repo.listAllocationHistory(id);

/** A validly signed version 2 changes file, as a parent's app (or anyone holding the student's file) could make. */
async function signedV2(studentId: string, secret: string, changes: FieldChange[], parentName = "Pat Parent"): Promise<ChangesFileV2> {
  const unsigned: UnsignedChangesFile = { app: "homeworkflow", kind: "changes", version: 2, exportedAt: clock.now.toISOString(), studentId, parentName, changes };
  return { ...(unsigned as Omit<ChangesFileV2, "mac">), mac: await signChanges(unsigned, secret) };
}
const fc = (assignmentId: string, field: FieldChange["field"], from: FieldChange["from"], to: FieldChange["to"], id = `c-${field}-${String(to)}`): FieldChange => ({
  id, assignmentId, field, from, to, changedAt: clock.now.toISOString(),
});

describe("student: work day, start time, together, place", () => {
  it("creates with a schedule, and refuses a start time without a work day", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment({ ...newInput, plannedDate: "2026-11-08", plannedStart: "16:30", withParent: true, location: "Library" });
    expect(a).toMatchObject({ plannedDate: "2026-11-08", plannedStart: "16:30", withParent: true, location: "Library" });
    await rejectsWith(repo.createAssignment({ ...newInput, plannedDate: null, plannedStart: "16:30" }), "validation");
    await rejectsWith(repo.createAssignment({ ...newInput, plannedDate: "2026-11-08", plannedStart: "25:00" }), "validation");
    expect((await repo.createAssignment(newInput)).withParent).toBe(false); // together is off by default
  });

  it("clearing the work day clears the start time; setting a start with no work day changes nothing", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment({ ...newInput, plannedDate: "2026-11-08", plannedStart: "16:30" });
    expect((await repo.updateAssignment(a.id, { plannedDate: null })).plannedStart).toBeNull();
    await rejectsWith(repo.updateAssignment(a.id, { plannedStart: "17:00" }), "validation");
    expect((await repo.getAssignment(a.id))?.plannedStart).toBeNull(); // nothing was half-saved
  });

  it("records each schedule change with old and new value, and nothing for unchanged fields", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment({ ...newInput, allocatedMinutes: 30 });
    expect((await history(repo, a.id)).map((h) => h.field)).toEqual(["allocatedMinutes"]); // creation: allocation only
    advance(60);
    await repo.updateAssignment(a.id, { title: "Renamed", plannedDate: "2026-11-08", plannedStart: "16:30", withParent: true, location: "Library", allocatedMinutes: 30 });
    const h = await history(repo, a.id);
    expect(h.filter((x) => x.field !== "allocatedMinutes").map((x) => [x.field, x.oldValue, x.newValue, x.changedByRole]).sort()).toEqual(
      [
        ["location", null, "Library", "student"],
        ["plannedDate", null, "2026-11-08", "student"],
        ["plannedStart", null, "16:30", "student"],
        ["withParent", false, true, "student"],
      ].sort(),
    );
    advance(60);
    await repo.updateAssignment(a.id, { title: "Renamed again" });
    expect(await history(repo, a.id)).toHaveLength(h.length); // a title edit adds no history
  });

  it("setSchedule changes just what it is given", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment({ ...newInput, plannedDate: "2026-11-08", location: "Home" });
    const after = await repo.setSchedule(a.id, { plannedStart: "09:15", withParent: true });
    expect(after).toMatchObject({ plannedDate: "2026-11-08", plannedStart: "09:15", withParent: true, location: "Home" });
    await rejectsWith(repo.setSchedule(a.id, { plannedStart: "9:15" }), "validation");
    await rejectsWith(repo.setSchedule(a.id, { plannedDate: null, plannedStart: "10:00" }), "validation");
    expect((await repo.setSchedule(a.id, { plannedDate: null })).plannedStart).toBeNull();
    const n = (await history(repo, a.id)).length;
    await repo.setSchedule(a.id, { location: "Home" }); // no change
    expect((await history(repo, a.id)).length).toBe(n);
  });

  it("saved data from before the schedule fields still loads (not together, no start)", async () => {
    const d = await studentDevice();
    const a = await d.repo.createAssignment(newInput);
    const raw = JSON.parse(d.store.getItem(STORAGE_KEY)!);
    for (const x of raw.assignments) {
      delete x.plannedStart;
      delete x.withParent;
    }
    for (const h of raw.history) {
      delete h.field;
      delete h.oldValue;
      delete h.newValue;
    }
    d.store.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(await d.open().getAssignment(a.id)).toMatchObject({ plannedStart: null, withParent: false });
    expect((await history(d.open(), a.id))[0]).toMatchObject({ field: "allocatedMinutes", newMinutes: 30 });
  });
});

describe("parent view on the shared device", () => {
  it("can set the schedule directly, recorded as the parent, and still cannot edit anything else", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    await repo.switchToParent("1234");
    await repo.setSchedule(a.id, { plannedDate: "2026-11-08", plannedStart: "16:30", withParent: true, location: "Library" });
    await rejectsWith(repo.updateAssignment(a.id, { title: "Nope" }), "forbidden");
    await rejectsWith(repo.updateAssignment(a.id, { plannedStart: "10:00" }), "forbidden");
    await repo.switchToStudent();
    expect(await repo.getAssignment(a.id)).toMatchObject({ plannedDate: "2026-11-08", plannedStart: "16:30", withParent: true, location: "Library" });
    const h = (await history(repo, a.id)).filter((x) => x.field !== "allocatedMinutes");
    expect(h).toHaveLength(4);
    expect(h.every((x) => x.changedByRole === "parent" && x.status === "applied")).toBe(true);
  });
});

describe("parent's own device: schedule changes travel as a signed file", () => {
  it("sends the whole schedule, applies it on the student's device with the parent's name, and is idempotent", async () => {
    const { student, parent, a } = await pair();
    advance(60);
    await parent.repo.setSchedule(a.id, { plannedDate: "2026-11-08", plannedStart: "16:30", withParent: true, location: "Library" });
    expect(await parent.repo.countUnsentChanges(student.studentId)).toBe(4);
    const file = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV2;
    expect(file.version).toBe(2);

    const result = await student.repo.importChanges(file);
    expect(result).toMatchObject({ parentName: "Pat Parent", applied: 4, superseded: 0, duplicates: 0, invalid: 0 });
    expect(await student.repo.getAssignment(a.id)).toMatchObject({ plannedDate: "2026-11-08", plannedStart: "16:30", withParent: true, location: "Library" });
    const h = (await history(student.repo, a.id)).filter((x) => x.field !== "allocatedMinutes");
    expect(h.every((x) => x.changedByRole === "parent")).toBe(true);
    expect(await student.repo.importChanges(file)).toMatchObject({ applied: 0, duplicates: 4 });
  });

  it("a mixed edit (time and schedule) goes in one file", async () => {
    const { student, parent, a } = await pair();
    advance(60);
    await parent.repo.setAllocation(a.id, 45);
    await parent.repo.setSchedule(a.id, { plannedDate: "2026-11-08", plannedStart: "16:30" });
    const result = await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    expect(result.applied).toBe(3);
    expect(await student.repo.getAssignment(a.id)).toMatchObject({ allocatedMinutes: 45, plannedStart: "16:30" });
  });

  it("the parent sees the schedule from the student's snapshot, and a pending change survives a newer snapshot", async () => {
    const { student, parent, a } = await pair();
    await student.repo.setSchedule(a.id, { plannedDate: "2026-11-09", withParent: true });
    advance(60);
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    expect(await parent.repo.getAssignment(a.id)).toMatchObject({ plannedDate: "2026-11-09", withParent: true, plannedStart: null });

    advance(60);
    await parent.repo.setSchedule(a.id, { plannedStart: "16:30" }); // not sent yet
    advance(60);
    await student.repo.createAssignment({ ...newInput, title: "Another" });
    const r = await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    expect(r.reappliedChanges).toBe(1);
    expect((await parent.repo.getAssignment(a.id))?.plannedStart).toBe("16:30");
    expect(await parent.repo.countUnsentChanges(student.studentId)).toBe(1);
  });

  it("only allocation changes: the file is still version 1, which a student app that has not updated reads", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const file = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV1;
    expect(file.version).toBe(1);
    expect(file.changes[0]).toEqual(expect.objectContaining({ oldMinutes: 30, newMinutes: 45 }));
    expect(file.changes[0]).not.toHaveProperty("field");
    expect((await student.repo.importChanges(file)).applied).toBe(1);
  });

  it("a version 1 file made by the first release imports", async () => {
    const { student, a, secret } = await pair();
    const unsigned: UnsignedChangesFile = { app: "homeworkflow", kind: "changes", version: 1, exportedAt: clock.now.toISOString(), studentId: student.studentId, parentName: "Old App Parent", changes: [{ id: "legacy-1", assignmentId: a.id, oldMinutes: 30, newMinutes: 20, changedAt: clock.now.toISOString() }] };
    const file = { ...unsigned, mac: await signChanges(unsigned, secret) };
    expect((await student.repo.importChanges(viaFile(file))).applied).toBe(1);
    expect((await student.repo.getAssignment(a.id))?.allocatedMinutes).toBe(20);
  });

  it("saved unsent changes from the first release are converted, not lost", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setAllocation(a.id, 45);
    const raw = JSON.parse(parent.store.getItem(STORAGE_KEY)!);
    raw.outbox = raw.outbox.map((c: { id: string; assignmentId: string; studentId: string; changedAt: string; from: number; to: number }) => ({ id: c.id, assignmentId: c.assignmentId, studentId: c.studentId, changedAt: c.changedAt, oldMinutes: c.from, newMinutes: c.to })); // the old shape
    parent.store.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(await parent.open().countUnsentChanges(student.studentId)).toBe(1);
    const file = viaFile(await parent.open().exportChanges(student.studentId));
    expect((await student.repo.importChanges(file)).applied).toBe(1);
  });
});

describe("integrity of version 2 files", () => {
  it("rejects a file changed after signing (value, field or which assignment)", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setSchedule(a.id, { plannedDate: "2026-11-08", plannedStart: "16:30" });
    const good = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV2;
    const tamper = (fn: (f: ChangesFileV2) => void) => {
      const f = viaFile(good);
      fn(f);
      return f;
    };
    await rejectsWith(student.repo.importChanges(tamper((f) => (f.changes[1].to = "03:00"))), "bad_signature");
    await rejectsWith(student.repo.importChanges(tamper((f) => (f.changes[0].field = "location"))), "bad_signature");
    await rejectsWith(student.repo.importChanges(tamper((f) => (f.changes[0].assignmentId = "other"))), "bad_signature");
    await rejectsWith(student.repo.importChanges(tamper((f) => (f.parentName = "Someone Else"))), "bad_signature");
    expect((await student.repo.getAssignment(a.id))?.plannedStart).toBeNull();
  });

  it("a signature cannot be moved between versions", async () => {
    const { student, parent, a } = await pair();
    await parent.repo.setSchedule(a.id, { location: "Library" });
    const v2 = viaFile(await parent.repo.exportChanges(student.studentId)) as ChangesFileV2;
    // relabelled as version 1: the shape no longer fits, so it is not even a valid file
    await rejectsWith(student.repo.importChanges({ ...v2, version: 1 }), "invalid_file");
    // a version 1 file relabelled as version 2 fails the signature (the entries are signed in a different shape)
    const v1unsigned: UnsignedChangesFile = { app: "homeworkflow", kind: "changes", version: 1, exportedAt: clock.now.toISOString(), studentId: student.studentId, parentName: "P", changes: [{ id: "x1", assignmentId: a.id, oldMinutes: 30, newMinutes: 10, changedAt: clock.now.toISOString() }] };
    const secret = (await student.repo.exportSnapshot() as { pairingSecret: string }).pairingSecret;
    const v1 = { ...v1unsigned, mac: await signChanges(v1unsigned, secret) };
    const asV2 = { ...v1, version: 2, changes: [{ id: "x1", assignmentId: a.id, field: "allocatedMinutes", from: 30, to: 10, changedAt: v1unsigned.changes[0].changedAt }] };
    await rejectsWith(student.repo.importChanges(asV2), "bad_signature");
  });

  it("the version number is part of the signed bytes (defence in depth beside the different entry shapes)", () => {
    const common = { app: "homeworkflow", kind: "changes", exportedAt: "2026-11-04T16:00:00.000Z", studentId: "s", parentName: "P" } as const;
    const v1: UnsignedChangesFile = { ...common, version: 1, changes: [] };
    const v2: UnsignedChangesFile = { ...common, version: 2, changes: [] };
    expect(JSON.parse(canonicalChanges(v1))[2]).toBe(1);
    expect(JSON.parse(canonicalChanges(v2))[2]).toBe(2);
    expect(canonicalChanges(v1)).not.toBe(canonicalChanges(v2));
  });

  it("a signed file can only touch the allowed fields: a parent can never change the title, stage or due date", async () => {
    const { student, a, secret } = await pair();
    for (const field of ["title", "stage", "dueDate", "difficulty", "archivedAt", "studentId"]) {
      const file = await signedV2(student.studentId, secret, [fc(a.id, field as FieldChange["field"], "x", "y", `evil-${field}`)]);
      await rejectsWith(student.repo.importChanges(viaFile(file)), "invalid_file");
    }
    expect(await student.repo.getAssignment(a.id)).toMatchObject({ title: "Test essay", stage: "not_started" });
  });

  it("nonsense inside a validly signed file is counted and not applied, without blocking the good changes", async () => {
    const { student, a, secret } = await pair();
    const file = await signedV2(student.studentId, secret, [
      fc(a.id, "plannedStart", null, "25:99", "bad-time"),
      fc(a.id, "plannedStart", null, "16:30", "start-no-date"), // no work day yet
      fc(a.id, "plannedDate", null, "2026-02-30", "bad-date"),
      fc(a.id, "withParent", false, "yes", "bad-flag"),
      fc(a.id, "allocatedMinutes", 30, 100000, "bad-minutes"),
      fc(a.id, "location", null, "x".repeat(41), "bad-place"),
      fc(a.id, "location", null, "Library", "good-place"),
    ]);
    const r = await student.repo.importChanges(viaFile(file));
    expect(r).toMatchObject({ applied: 1, invalid: 6 });
    expect(await student.repo.getAssignment(a.id)).toMatchObject({ location: "Library", plannedDate: null, plannedStart: null, withParent: false, allocatedMinutes: 30 });
  });

  it("a start time arriving after its work day in the same file is applied; before it, refused", async () => {
    const { student, a, secret } = await pair();
    const file = await signedV2(student.studentId, secret, [fc(a.id, "plannedDate", null, "2026-11-08", "d"), fc(a.id, "plannedStart", null, "16:30", "s")]);
    expect((await student.repo.importChanges(viaFile(file))).applied).toBe(2);
    const reversed = await signedV2(student.studentId, secret, [fc(a.id, "plannedStart", "16:30", "17:00", "s2"), fc(a.id, "plannedDate", "2026-11-08", null, "d2")]);
    // both apply in file order here: the start (date still set) then clearing the date, which clears the start
    expect((await student.repo.importChanges(viaFile(reversed))).applied).toBe(2);
    expect((await student.repo.getAssignment(a.id))?.plannedStart).toBeNull();
  });

  it("clamps a schedule change dated in the future to now", async () => {
    const { student, a, secret } = await pair();
    const file = await signedV2(student.studentId, secret, [{ ...fc(a.id, "location", null, "Library", "f"), changedAt: "2099-01-01T00:00:00.000Z" }]);
    await student.repo.importChanges(viaFile(file));
    expect((await history(student.repo, a.id)).find((h) => h.field === "location")).toBeTruthy();
  });

  it("a file from a newer version of the app gets a helpful message", async () => {
    const { student, a, secret } = await pair();
    const file = await signedV2(student.studentId, secret, [fc(a.id, "location", null, "Library")]);
    await rejectsWith(student.repo.importChanges({ ...viaFile(file), version: 3 }), "newer_version");
  });
});

describe("conflicts are resolved per field", () => {
  it("the student's newer start time beats the parent's older one, but the parent's place still applies", async () => {
    const { student, parent, a } = await pair();
    await student.repo.setSchedule(a.id, { plannedDate: "2026-11-08" });
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    advance(60);
    await parent.repo.setSchedule(a.id, { plannedStart: "16:00", location: "Library" }); // parent, 16:01
    advance(60);
    await student.repo.setSchedule(a.id, { plannedStart: "17:00" }); // student, 16:02, before importing
    const r = await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)));
    expect(r).toMatchObject({ applied: 1, superseded: 1 });
    expect(await student.repo.getAssignment(a.id)).toMatchObject({ plannedStart: "17:00", location: "Library" });
    const h = await history(student.repo, a.id);
    expect(h.find((x) => x.field === "plannedStart" && x.changedByRole === "parent")).toMatchObject({ status: "superseded", newValue: "16:00" });
  });

  it("a newer parent change wins over an older student change", async () => {
    const { student, parent, a } = await pair();
    await student.repo.setSchedule(a.id, { plannedDate: "2026-11-08", plannedStart: "15:00" });
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    advance(120);
    await parent.repo.setSchedule(a.id, { plannedStart: "16:30" });
    expect((await student.repo.importChanges(viaFile(await parent.repo.exportChanges(student.studentId)))).applied).toBe(1);
    expect((await student.repo.getAssignment(a.id))?.plannedStart).toBe("16:30");
  });
});

describe("permissions", () => {
  it("a parent's device cannot change an unknown assignment, and the student's own device keeps schedule edits to the student view", async () => {
    const { parent } = await pair();
    await rejectsWith(parent.repo.setSchedule("nope", { location: "x" }), "not_found");
    const d = await studentDevice();
    const a = await d.repo.createAssignment(newInput);
    await rejectsWith(d.repo.setSchedule("nope", { location: "x" }), "not_found");
    await d.repo.switchToParent("1234");
    await expect(d.repo.setSchedule(a.id, { location: "x" })).resolves.toMatchObject({ location: "x" });
  });
});
