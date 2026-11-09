import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "@/lib/data/local-repo";
import { samplesFromAssignments } from "@/lib/domain/history";
import { advance, clock, newInput, parentDevice, rejectsWith, studentDevice } from "./helpers";

const viaFile = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

beforeEach(() => {
  clock.now = new Date(2026, 10, 4, 16, 0, 0);
});

describe("location (where the work will be done)", () => {
  it("is optional, trimmed, and stored as null when empty", async () => {
    const { repo } = await studentDevice();
    expect((await repo.createAssignment(newInput)).location).toBeNull();
    expect((await repo.createAssignment({ ...newInput, location: "  Library  " })).location).toBe("Library");
    expect((await repo.createAssignment({ ...newInput, location: "   " })).location).toBeNull();
    expect((await repo.createAssignment({ ...newInput, location: null })).location).toBeNull();
  });

  it("is limited to 40 characters", async () => {
    const { repo } = await studentDevice();
    await rejectsWith(repo.createAssignment({ ...newInput, location: "x".repeat(41) }), "validation");
    expect((await repo.createAssignment({ ...newInput, location: "x".repeat(40) })).location).toHaveLength(40);
  });

  it("can be changed and cleared, and an edit that does not mention it leaves it alone", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment({ ...newInput, location: "Home" });
    expect((await repo.updateAssignment(a.id, { location: "Library" })).location).toBe("Library");
    expect((await repo.updateAssignment(a.id, { title: "Renamed" })).location).toBe("Library");
    expect((await repo.updateAssignment(a.id, { location: "" })).location).toBeNull();
  });

  it("travels to the parent in the snapshot", async () => {
    const student = await studentDevice();
    const parent = await parentDevice();
    const a = await student.repo.createAssignment({ ...newInput, location: "Library" });
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    expect((await parent.repo.getAssignment(a.id))?.location).toBe("Library");
  });
});

describe("archive and restore", () => {
  it("archives and restores, keeping everything else", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment({ ...newInput, allocatedMinutes: 30 });
    advance(60);
    expect(await repo.archiveAssignments([a.id])).toBe(1);
    const archived = (await repo.getAssignment(a.id))!;
    expect(archived.archivedAt).toBe(clock.now.toISOString());
    expect(archived).toMatchObject({ title: "Test essay", allocatedMinutes: 30, stage: "not_started" });
    expect(await repo.listAllocationHistory(a.id)).toHaveLength(1); // history kept

    advance(60);
    const restored = await repo.restoreAssignment(a.id);
    expect(restored.archivedAt).toBeNull();
  });

  it("is idempotent and counts only what changed", async () => {
    const { repo } = await studentDevice();
    const [a, b] = [await repo.createAssignment(newInput), await repo.createAssignment({ ...newInput, title: "B" })];
    expect(await repo.archiveAssignments([a.id])).toBe(1);
    expect(await repo.archiveAssignments([a.id, b.id, b.id])).toBe(1); // a already archived, b once
    expect(await repo.archiveAssignments([])).toBe(0);
    await repo.restoreAssignment(a.id);
    await repo.restoreAssignment(a.id); // restoring twice is fine
  });

  it("is all or nothing: one unknown id archives none", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    await rejectsWith(repo.archiveAssignments([a.id, "nope"]), "not_found");
    expect((await repo.getAssignment(a.id))?.archivedAt).toBeNull();
  });

  it("will not archive an assignment with a running or paused timer, and archives none of the batch", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    const b = await repo.createAssignment({ ...newInput, title: "B" });
    const t = await repo.timerStart(a.id);
    await rejectsWith(repo.archiveAssignments([b.id, a.id]), "assignment_busy");
    expect((await repo.getAssignment(b.id))?.archivedAt).toBeNull();
    await repo.timerPause(t.id);
    await rejectsWith(repo.archiveAssignments([a.id]), "assignment_busy");
    await repo.timerFinish(t.id);
    expect(await repo.archiveAssignments([a.id])).toBe(1);
  });

  it("cannot start a timer on an archived assignment until it is restored", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    await repo.archiveAssignments([a.id]);
    await rejectsWith(repo.timerStart(a.id), "assignment_archived");
    await repo.restoreAssignment(a.id);
    await expect(repo.timerStart(a.id)).resolves.toMatchObject({ state: "running" });
  });

  it("is the student's alone: the parent view and a parent's device cannot archive or restore", async () => {
    const d = await studentDevice();
    const a = await d.repo.createAssignment(newInput);
    await d.repo.archiveAssignments([a.id]);
    await d.repo.switchToParent("1234");
    await rejectsWith(d.repo.archiveAssignments([a.id]), "forbidden");
    await rejectsWith(d.repo.restoreAssignment(a.id), "forbidden");

    const p = await parentDevice();
    await p.repo.importSnapshot(viaFile(await (await studentDevice()).repo.exportSnapshot()));
    await rejectsWith(p.repo.archiveAssignments(["x"]), "forbidden");
  });

  it("the parent still sees archived work (read-only) with its archive date", async () => {
    const student = await studentDevice();
    const parent = await parentDevice();
    const a = await student.repo.createAssignment(newInput);
    await student.repo.archiveAssignments([a.id]);
    await parent.repo.importSnapshot(viaFile(await student.repo.exportSnapshot()));
    expect((await parent.repo.getAssignment(a.id))?.archivedAt).not.toBeNull();
    await rejectsWith(parent.repo.restoreAssignment(a.id), "forbidden");
  });

  it("delete still works for an archived assignment and removes its history", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    await repo.archiveAssignments([a.id]);
    await repo.deleteAssignment(a.id);
    expect(await repo.getAssignment(a.id)).toBeNull();
  });

  it("archived finished work still feeds the time estimates", async () => {
    const { repo } = await studentDevice();
    for (let i = 0; i < 3; i++) {
      const a = await repo.createAssignment({ ...newInput, title: `Done ${i}`, difficulty: 3 });
      const t = await repo.timerStart(a.id);
      advance(1800);
      await repo.timerFinish(t.id);
      await repo.updateAssignment(a.id, { stage: "completed" });
      await repo.archiveAssignments([a.id]);
    }
    const all = await repo.listAssignments((await repo.getViewer())!.id);
    expect(all.every((a) => a.archivedAt)).toBe(true);
    expect(samplesFromAssignments(all, clock.now)).toHaveLength(3);
  });
});

describe("older saved data and older files still load", () => {
  it("saved data from before location/archive loads with safe defaults", async () => {
    const d = await studentDevice();
    const a = await d.repo.createAssignment(newInput);
    const raw = JSON.parse(d.store.getItem(STORAGE_KEY)!);
    for (const x of raw.assignments) {
      delete x.location;
      delete x.archivedAt;
    }
    d.store.setItem(STORAGE_KEY, JSON.stringify(raw));
    const loaded = (await d.open().getAssignment(a.id))!;
    expect(loaded.location).toBeNull();
    expect(loaded.archivedAt).toBeNull();
  });

  it("a snapshot file from the older app imports with the new fields defaulted", async () => {
    const student = await studentDevice();
    const parent = await parentDevice();
    const a = await student.repo.createAssignment(newInput);
    const old = viaFile(await student.repo.exportSnapshot()) as { assignments: Record<string, unknown>[] };
    for (const x of old.assignments) {
      delete x.location;
      delete x.archivedAt;
    }
    await parent.repo.importSnapshot(old);
    expect(await parent.repo.getAssignment(a.id)).toMatchObject({ location: null, archivedAt: null });
  });
});
