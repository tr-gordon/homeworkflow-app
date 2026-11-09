import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WakeLockHolder } from "@/lib/wake-lock";
import { AlertsStore, DEFAULT_SETTINGS } from "@/lib/alerts-store";
import { MemoryStore } from "@/lib/data/local-repo";

/** A fake Screen Wake Lock API: records requests and lets the test "release" a lock like a browser does. */
function fakeWakeLock(opts: { reject?: boolean } = {}) {
  const sentinels: { released: boolean; fire: () => void }[] = [];
  const api = {
    request: vi.fn(async () => {
      if (opts.reject) throw new DOMException("not allowed", "NotAllowedError");
      let cb: () => void = () => undefined;
      const s = {
        released: false,
        fire: () => cb(),
        addEventListener: (_t: string, f: () => void) => {
          cb = f;
        },
        release: vi.fn(async () => {
          s.released = true;
        }),
      };
      sentinels.push(s);
      return s;
    }),
  };
  return { api, sentinels };
}

describe("WakeLockHolder", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { visibilityState: "visible" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing, quietly, where the API does not exist", async () => {
    vi.stubGlobal("navigator", {});
    const h = new WakeLockHolder();
    expect(h.supported()).toBe(false);
    await h.acquire();
    expect(h.held).toBe(false);
    await expect(h.release()).resolves.toBeUndefined();
  });

  it("acquires once however often it is asked (it is called every second)", async () => {
    const { api } = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: api });
    const h = new WakeLockHolder();
    await Promise.all([h.acquire(), h.acquire(), h.acquire()]);
    await h.acquire();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(h.held).toBe(true);
  });

  it("releases, and can acquire again afterwards", async () => {
    const { api, sentinels } = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: api });
    const h = new WakeLockHolder();
    await h.acquire();
    await h.release();
    expect(sentinels[0].released).toBe(true);
    expect(h.held).toBe(false);
    await h.acquire();
    expect(api.request).toHaveBeenCalledTimes(2);
  });

  it("notices when the browser takes the lock back (page hidden) and asks again later", async () => {
    const { api, sentinels } = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: api });
    const h = new WakeLockHolder();
    await h.acquire();
    sentinels[0].fire(); // the browser released it
    expect(h.held).toBe(false);
    await h.acquire();
    expect(api.request).toHaveBeenCalledTimes(2);
  });

  it("does not ask while the page is hidden", async () => {
    const { api } = fakeWakeLock();
    vi.stubGlobal("navigator", { wakeLock: api });
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await new WakeLockHolder().acquire();
    expect(api.request).not.toHaveBeenCalled();
  });

  it("a refused request is not an error, and a later tick may try again", async () => {
    const { api } = fakeWakeLock({ reject: true });
    vi.stubGlobal("navigator", { wakeLock: api });
    const h = new WakeLockHolder();
    await expect(h.acquire()).resolves.toBeUndefined();
    expect(h.held).toBe(false);
    await h.acquire();
    expect(api.request).toHaveBeenCalledTimes(2);
  });
});

describe("keep-awake setting", () => {
  it("is on by default and can be turned off and back on", () => {
    const kv = new MemoryStore();
    expect(DEFAULT_SETTINGS.keepAwake).toBe(true);
    expect(new AlertsStore(kv).getSettings().keepAwake).toBe(true);
    new AlertsStore(kv).saveSettings({ keepAwake: false });
    expect(new AlertsStore(kv).getSettings().keepAwake).toBe(false);
    new AlertsStore(kv).saveSettings({ keepAwake: true });
    expect(new AlertsStore(kv).getSettings().keepAwake).toBe(true);
  });

  it("settings saved before this setting existed still load, with it on", () => {
    const kv = new MemoryStore();
    kv.setItem("homeworkflow.alerts.v1", JSON.stringify({ settings: { sound: false, vibrate: true, warning: true, systemNotifications: false }, fired: [], notifiedOn: null }));
    expect(new AlertsStore(kv).getSettings()).toMatchObject({ sound: false, keepAwake: true });
  });
});
