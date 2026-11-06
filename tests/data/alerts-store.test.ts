import { describe, expect, it } from "vitest";
import { ALERTS_KEY, AlertsStore, DEFAULT_SETTINGS, MAX_FIRED } from "@/lib/alerts-store";
import { MemoryStore } from "@/lib/data/local-repo";
import { newInput, studentDevice, parentDevice } from "./helpers";

describe("AlertsStore", () => {
  it("starts with sensible defaults: sound, vibration and heads-up on; system notifications off", () => {
    const s = new AlertsStore(new MemoryStore());
    expect(s.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.systemNotifications).toBe(false);
  });

  it("saves preferences and keeps the others", () => {
    const kv = new MemoryStore();
    new AlertsStore(kv).saveSettings({ sound: false });
    const again = new AlertsStore(kv).getSettings();
    expect(again).toMatchObject({ sound: false, vibrate: true, warning: true, systemNotifications: false });
  });

  it("remembers fired alerts across a refresh, and trims the list", () => {
    const kv = new MemoryStore();
    const s = new AlertsStore(kv);
    s.markFired("a");
    expect(new AlertsStore(kv).hasFired("a")).toBe(true);
    expect(new AlertsStore(kv).hasFired("b")).toBe(false);
    for (let i = 0; i < MAX_FIRED + 10; i++) s.markFired(`k${i}`);
    expect(s.hasFired("a")).toBe(false); // oldest dropped
    expect(s.hasFired(`k${MAX_FIRED + 9}`)).toBe(true);
    expect(JSON.parse(kv.getItem(ALERTS_KEY)!).fired.length).toBeLessThanOrEqual(MAX_FIRED);
  });

  it("notifies at most once a day", () => {
    const s = new AlertsStore(new MemoryStore());
    expect(s.notifiedToday("2026-11-04")).toBe(false);
    s.markNotified("2026-11-04");
    expect(s.notifiedToday("2026-11-04")).toBe(true);
    expect(s.notifiedToday("2026-11-05")).toBe(false);
  });

  it("never throws on damaged or hand-edited data: it falls back to defaults", () => {
    for (const raw of ["{not json", "null", "[]", '{"settings":"x","fired":7}', '{"settings":{"sound":"yes"}}']) {
      const kv = new MemoryStore();
      kv.setItem(ALERTS_KEY, raw);
      const s = new AlertsStore(kv);
      expect(() => s.getSettings()).not.toThrow();
      expect(s.getSettings().vibrate).toBe(true);
      expect(s.hasFired("x")).toBe(false);
    }
  });

  it("survives a storage that refuses writes", () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const s = new AlertsStore(broken);
    expect(() => s.markFired("x")).not.toThrow();
    expect(() => s.saveSettings({ sound: false })).not.toThrow();
  });

  it("is a separate key from the homework data, so it cannot damage it", async () => {
    const d = await studentDevice();
    new AlertsStore(d.store).saveSettings({ sound: false });
    expect(ALERTS_KEY).not.toBe("homeworkflow.v2");
    d.store.setItem(ALERTS_KEY, "garbage");
    expect((await d.open().getViewer())?.role).toBe("student"); // homework unaffected
  });
});

describe("LocalRepo.getActiveTimer", () => {
  it("returns the running or paused timer with its assignment, and null otherwise", async () => {
    const { repo, open } = await studentDevice();
    const a = await repo.createAssignment(newInput);
    expect(await repo.getActiveTimer()).toBeNull();
    const t = await repo.timerStart(a.id);
    expect(await open().getActiveTimer()).toMatchObject({ session: { id: t.id, state: "running" }, assignment: { id: a.id } });
    await repo.timerPause(t.id);
    expect((await repo.getActiveTimer())?.session.state).toBe("paused");
    await repo.timerFinish(t.id);
    expect(await repo.getActiveTimer()).toBeNull();
  });

  it("is null in the parent view and on a parent's device", async () => {
    const d = await studentDevice();
    const a = await d.repo.createAssignment(newInput);
    await d.repo.timerStart(a.id);
    await d.repo.switchToParent("1234");
    expect(await d.repo.getActiveTimer()).toBeNull();
    const p = await parentDevice();
    expect(await p.repo.getActiveTimer()).toBeNull();
  });
});
