"use client";

/**
 * Screen Wake Lock: keeps the screen on so a timer alert can ring on time. Optional everywhere:
 * unsupported browsers, denied requests and low-battery refusals all just mean "no lock", never an error.
 * The browser drops the lock whenever the page is hidden, so it must be re-acquired when the page is visible again.
 */
interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: "release", cb: () => void): void;
}
type WakeLockApi = { request(type: "screen"): Promise<Sentinel> };

export class WakeLockHolder {
  private sentinel: Sentinel | null = null;
  private pending = false;

  get held(): boolean {
    return this.sentinel !== null;
  }

  supported(): boolean {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  /** Ask for the lock if we do not have it. Safe to call every second. */
  async acquire(): Promise<void> {
    if (this.sentinel || this.pending || !this.supported() || document.visibilityState !== "visible") return;
    this.pending = true;
    try {
      const api = (navigator as unknown as { wakeLock: WakeLockApi }).wakeLock;
      const s = await api.request("screen");
      s.addEventListener("release", () => {
        if (this.sentinel === s) this.sentinel = null; // the browser took it back (page hidden): ask again later
      });
      this.sentinel = s;
    } catch {
      // not allowed right now (battery saver, permissions): try again on a later tick
    } finally {
      this.pending = false;
    }
  }

  async release(): Promise<void> {
    const s = this.sentinel;
    this.sentinel = null;
    try {
      await s?.release();
    } catch {
      // already released
    }
  }
}
