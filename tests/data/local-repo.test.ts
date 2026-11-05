import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_STORAGE_KEY, STORAGE_KEY } from "@/lib/data/local-repo";
import { buildDailyPlan } from "@/lib/domain/plan";
import { toPlanItem } from "@/lib/domain/history";
import { elapsedSeconds, totalActualSeconds } from "@/lib/domain/timer";
import { toLocalDateString } from "@/lib/domain/dates";
import { advance, clock, device, newInput, parentDevice, rejectsWith, studentDevice } from "./helpers";

/**
 * Covers the four areas the PRD calls out: assignment CRUD (A1, A2), role
 * permissions (A3, T2), timer persistence (R1-R4) and allocation history (T3),
 * against the real data layer over an in-memory localStorage.
 */
beforeEach(() => {
  clock.now = new Date(2026, 10, 4, 16, 0, 0);
});

describe("assignment CRUD (A1, A2)", () => {
  it("creates, edits, completes and deletes", async () => {
    const { repo } = await studentDevice();
    const created = await repo.createAssignment(newInput);
    expect(created).toMatchObject({ stage: "not_started", title: "Test essay" });

    const edited = await repo.updateAssignment(created.id, { title: "Essay v2", difficulty: 4, stage: "halfway" });
    expect(edited).toMatchObject({ title: "Essay v2", difficulty: 4, stage: "halfway", completedAt: null });

    const done = await repo.updateAssignment(created.id, { stage: "completed" });
    expect(done.completedAt).not.toBeNull();
    expect((await repo.updateAssignment(created.id, { stage: "almost_done" })).completedAt).toBeNull();

    await repo.deleteAssignment(created.id);
    expect(await repo.getAssignment(created.id)).toBeNull();
  });

  it("validates input at the boundary", async () => {
    const { repo } = await studentDevice();
    await rejectsWith(repo.createAssignment({ ...newInput, title: "  " }), "validation");
    await rejectsWith(repo.createAssignment({ ...newInput, difficulty: 9 as never }), "validation");
    await rejectsWith(repo.createAssignment({ ...newInput, allocatedMinutes: 0 }), "validation");
    await rejectsWith(repo.createAssignment({ ...newInput, dueDate: "2026-02-30" }), "validation");
    const a = await repo.createAssignment(newInput);
    await rejectsWith(repo.updateAssignment(a.id, { stage: "nope" as never }), "validation");
  });

  it("persists across a page refresh (new repo over the same storage)", async () => {
    const d = await studentDevice();
    const a = await d.repo.createAssignment(newInput);
    expect((await d.open().getAssignment(a.id))?.title).toBe("Test essay");
  });
});

describe("role permissions (A3, T2)", () => {
  it("the student's own view only sees their own data", async () => {
    const { repo, studentId } = await studentDevice();
    await repo.createAssignment(newInput);
    expect((await repo.listAssignments(studentId)).length).toBe(1);
    expect(await repo.listAssignments("someone-else")).toEqual([]);
  });

  it("the parent view (PIN) can read everything and change allocation, but nothing else", async () => {
    const { repo, studentId } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    await repo.switchToParent("1234");

    expect((await repo.getViewer())?.role).toBe("parent");
    expect((await repo.listAssignments(studentId)).length).toBe(1);
    expect((await repo.setAllocation(a.id, 45)).allocatedMinutes).toBe(45);

    await rejectsWith(repo.createAssignment(newInput), "forbidden");
    await rejectsWith(repo.updateAssignment(a.id, { title: "Nope" }), "forbidden");
    await rejectsWith(repo.updateAssignment(a.id, { stage: "completed" }), "forbidden");
    await rejectsWith(repo.deleteAssignment(a.id), "forbidden");
    await rejectsWith(repo.timerStart(a.id), "forbidden");

    await repo.switchToStudent();
    expect((await repo.getViewer())?.role).toBe("student");
    expect((await repo.getAssignment(a.id))?.allocatedMinutes).toBe(45); // student sees the change at once
  });

  it("the parent view closes when the browser session ends (sessionStorage)", async () => {
    const d = await studentDevice();
    await d.repo.switchToParent("1234");
    expect((await d.open().getViewer())?.role).toBe("parent"); // a refresh keeps it
    d.session.removeItem("homeworkflow.view"); // closing the tab clears session storage
    expect((await d.open().getViewer())?.role).toBe("student");
  });

  it("a parent's own device cannot create assignments or run timers", async () => {
    const { repo } = await parentDevice();
    await rejectsWith(repo.createAssignment(newInput), "forbidden");
    await rejectsWith(repo.timerStart("x"), "forbidden");
    await rejectsWith(repo.exportSnapshot(), "unsupported_here");
    await rejectsWith(repo.switchToParent("1234"), "unsupported_here");
  });

  it("nothing works before setup, and setup runs only once", async () => {
    const d = device();
    const repo = d.open();
    expect(await repo.getDevice()).toBeNull();
    await rejectsWith(repo.listStudents(), "not_set_up");
    await repo.setup({ role: "student", displayName: "Sam" });
    await rejectsWith(repo.setup({ role: "parent", displayName: "X" }), "forbidden");
    await rejectsWith(repo.setup({ role: "student", displayName: "  " }), "forbidden"); // already set up wins
  });

  it("rejects an empty or oversized name at setup", async () => {
    const repo = device().open();
    await rejectsWith(repo.setup({ role: "student", displayName: "   " }), "validation");
    await rejectsWith(repo.setup({ role: "student", displayName: "x".repeat(41) }), "validation");
  });
});

describe("parent PIN (soft guard on a shared device)", () => {
  it("needs a PIN to be set, and the right PIN", async () => {
    const d = device();
    const repo = d.open();
    await repo.setup({ role: "student", displayName: "Sam" });
    await rejectsWith(repo.switchToParent("1234"), "pin_not_set");
    await repo.setParentPin({ pin: "4321", parentName: "Pat" });
    await rejectsWith(repo.switchToParent("0000"), "wrong_pin");
    await repo.switchToParent("4321");
    expect((await repo.getViewer())?.displayName).toBe("Pat");
  });

  it("stores only a salted hash, never the PIN", async () => {
    const d = await studentDevice();
    const raw = d.store.getItem(STORAGE_KEY)!;
    expect(raw).not.toContain("1234");
    expect(JSON.parse(raw).pin).toMatchObject({ iterations: 1000 });
  });

  it("locks for a minute after 5 wrong tries, even for the right PIN", async () => {
    const { repo } = await studentDevice();
    for (let i = 0; i < 4; i++) await rejectsWith(repo.switchToParent("0000"), "wrong_pin");
    await rejectsWith(repo.switchToParent("0000"), "pin_locked");
    await rejectsWith(repo.switchToParent("1234"), "pin_locked");
    advance(61);
    await repo.switchToParent("1234");
    expect((await repo.getViewer())?.role).toBe("parent");
  });

  it("changing an existing PIN needs the current PIN", async () => {
    const { repo } = await studentDevice();
    await rejectsWith(repo.setParentPin({ pin: "9999", parentName: "Pat" }), "wrong_pin");
    await rejectsWith(repo.setParentPin({ pin: "9999", parentName: "Pat", currentPin: "0000" }), "wrong_pin");
    await repo.setParentPin({ pin: "9999", parentName: "Pat", currentPin: "1234" });
    await repo.switchToParent("9999");
  });

  it("only accepts 4 to 8 digits", async () => {
    const repo = device().open();
    await repo.setup({ role: "student", displayName: "Sam" });
    for (const bad of ["12", "abcd", "123456789", "12 34"]) {
      await rejectsWith(repo.setParentPin({ pin: bad, parentName: "Pat" }), "validation");
    }
  });
});

describe("timer persistence (R1-R4)", () => {
  async function withAssignment() {
    const d = await studentDevice();
    const a = await d.repo.createAssignment(newInput);
    return { ...d, a };
  }

  it("keeps running time across a page refresh", async () => {
    const { repo, open, a } = await withAssignment();
    const s = await repo.timerStart(a.id);
    advance(600);
    const reloaded = (await open().getAssignment(a.id))!.sessions.find((x) => x.id === s.id)!;
    expect(reloaded.state).toBe("running");
    expect(elapsedSeconds(reloaded, clock.now)).toBe(600);
    advance(60);
    expect(elapsedSeconds((await open().getAssignment(a.id))!.sessions[0], clock.now)).toBe(660);
  });

  it("start, pause, resume and finish, with paused time excluded, across refreshes", async () => {
    const { repo, open, a } = await withAssignment();
    const s = await repo.timerStart(a.id);
    advance(300);
    await repo.timerPause(s.id);
    advance(3600); // an hour paused does not count
    await open().timerResume(s.id);
    advance(120);
    const done = await open().timerFinish(s.id);
    expect(done).toMatchObject({ state: "finished", accumulatedSeconds: 420 });
    expect(totalActualSeconds((await open().getAssignment(a.id))!.sessions, clock.now)).toBe(420);
  });

  it("allows one active timer at a time and rejects invalid transitions", async () => {
    const { repo, a } = await withAssignment();
    const b = await repo.createAssignment({ ...newInput, title: "Second" });
    const s = await repo.timerStart(a.id);
    await rejectsWith(repo.timerStart(b.id), "timer_active_exists");
    await rejectsWith(repo.timerResume(s.id), "timer_not_paused");
    await repo.timerPause(s.id);
    await rejectsWith(repo.timerStart(b.id), "timer_active_exists");
    await repo.timerFinish(s.id);
    await rejectsWith(repo.timerPause(s.id), "timer_already_finished");
    await expect(repo.timerStart(b.id)).resolves.toMatchObject({ state: "running" });
  });

  it("caps a forgotten timer at 4 hours", async () => {
    const { repo, a } = await withAssignment();
    const s = await repo.timerStart(a.id);
    advance(12 * 3600);
    expect((await repo.timerFinish(s.id)).accumulatedSeconds).toBe(4 * 3600);
  });

  it("an unknown session id is not found", async () => {
    const { repo } = await withAssignment();
    await rejectsWith(repo.timerPause("nope"), "timer_not_found");
  });

  it("the parent view cannot control timers", async () => {
    const { repo, a } = await withAssignment();
    const s = await repo.timerStart(a.id);
    await repo.switchToParent("1234");
    await rejectsWith(repo.timerPause(s.id), "forbidden");
  });
});

describe("allocation history (T3)", () => {
  it("records who changed the time and when, newest first", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput); // 30 by the student
    advance(60);
    await repo.switchToParent("1234");
    await repo.setAllocation(a.id, 45);
    advance(60);
    await repo.switchToStudent();
    await repo.updateAssignment(a.id, { allocatedMinutes: 40 });
    advance(60);
    await repo.updateAssignment(a.id, { title: "No allocation change here" });

    const h = await repo.listAllocationHistory(a.id);
    expect(h.map((x) => [x.changedByRole, x.oldMinutes, x.newMinutes])).toEqual([
      ["student", 45, 40],
      ["parent", 30, 45],
      ["student", null, 30],
    ]);
    expect(h[1]).toMatchObject({ changedByName: "Pat Parent", status: "applied" });
    expect(h[1].changedAt < h[0].changedAt).toBe(true);
  });

  it("does not record a no-op allocation", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    await repo.setAllocation(a.id, 30);
    expect(await repo.listAllocationHistory(a.id)).toHaveLength(1);
  });

  it("records clearing the allocation", async () => {
    const { repo } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    await repo.setAllocation(a.id, null);
    expect((await repo.listAllocationHistory(a.id))[0]).toMatchObject({ oldMinutes: 30, newMinutes: null });
  });
});

describe("storage safety", () => {
  it("never overwrites unreadable real data: it keeps a copy and refuses to continue", async () => {
    const d = await studentDevice();
    await d.repo.createAssignment(newInput);
    d.store.setItem(STORAGE_KEY, '{"version":2,"truncated');
    await rejectsWith(d.open().getDevice(), "corrupt_data");
    expect(d.store.getItem(`${STORAGE_KEY}.corrupt`)).toContain("truncated");
    expect(d.store.getItem(STORAGE_KEY)).toContain("truncated"); // not replaced
    await d.open().eraseAllData(); // the explicit way out
    expect(await d.open().getDevice()).toBeNull();
  });

  it("rejects data of the wrong shape (hand-edited or from another version)", async () => {
    const d = await studentDevice();
    const state = JSON.parse(d.store.getItem(STORAGE_KEY)!);
    state.version = 99;
    d.store.setItem(STORAGE_KEY, JSON.stringify(state));
    await rejectsWith(d.open().getViewer(), "corrupt_data");
  });

  it("never needs the network", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("must not call fetch");
    }) as typeof fetch;
    try {
      const { repo } = await studentDevice();
      const a = await repo.createAssignment(newInput);
      await repo.setAllocation(a.id, 10);
      await repo.timerStart(a.id);
      await repo.exportSnapshot();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("demo mode", () => {
  it("seeds fictional data under its own key and never touches real data", async () => {
    const d = device(true);
    const repo = d.open();
    expect((await repo.getViewer())?.displayName).toBe("Alex Sample");
    expect(d.store.getItem(DEMO_STORAGE_KEY)).not.toBeNull();
    expect(d.store.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is internally consistent and exercises overdue, today, planned and completed", async () => {
    const repo = device(true).open();
    const me = (await repo.getViewer())!;
    const items = (await repo.listAssignments(me.id)).map((a) => toPlanItem(a, clock.now));
    const plan = buildDailyPlan(items, toLocalDateString(clock.now));
    expect(plan.overdue.length).toBeGreaterThan(0);
    expect(plan.dueToday.length).toBeGreaterThan(0);
    expect(plan.plannedToday.length).toBeGreaterThan(0);
    expect(items.some((i) => i.stage === "completed")).toBe(true);
  });

  it("opens the parent view without a PIN and can be reset", async () => {
    const d = device(true);
    const repo = d.open();
    await repo.switchToParent("");
    expect((await repo.getViewer())?.displayName).toBe("Jordan Sample");
    await repo.eraseAllData();
    await repo.switchToStudent();
    expect((await d.open().getViewer())?.displayName).toBe("Alex Sample"); // re-seeded
  });

  it("recovers from corrupted demo storage by re-seeding", async () => {
    const d = device(true);
    d.store.setItem(DEMO_STORAGE_KEY, "{not json");
    expect((await d.open().getViewer())?.displayName).toBe("Alex Sample");
  });
});
