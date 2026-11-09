import { z } from "zod";
import type { KeyValueStore } from "./data/local-repo";

/**
 * Alert preferences and "already alerted" bookkeeping. Kept in its own
 * localStorage key, separate from the homework data: a problem here must never be able
 * to damage or block that data, so every method is total (never throws) and falls back
 * to defaults.
 */

export const ALERTS_KEY = "homeworkflow.alerts.v1";
export const MAX_FIRED = 60;

export const settingsSchema = z.object({
  sound: z.boolean().catch(true),
  vibrate: z.boolean().catch(true),
  /** The "5 minutes left" heads-up. The "planned time is up" alert is always on. */
  warning: z.boolean().catch(true),
  /** System notifications. Off until the person turns them on AND the browser allows them. */
  systemNotifications: z.boolean().catch(false),
  /** Keep the screen on while a timer with a plan is running, so the alert rings on time. */
  keepAwake: z.boolean().catch(true),
});
export type AlertSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AlertSettings = { sound: true, vibrate: true, warning: true, systemNotifications: false, keepAwake: true };

const dataSchema = z.object({
  settings: settingsSchema.catch(DEFAULT_SETTINGS),
  fired: z.array(z.string()).catch([]),
  notifiedOn: z.string().nullable().catch(null),
});
type Data = z.infer<typeof dataSchema>;

export class AlertsStore {
  constructor(private readonly kv: KeyValueStore) {}

  private load(): Data {
    try {
      const raw = this.kv.getItem(ALERTS_KEY);
      return dataSchema.parse(raw ? JSON.parse(raw) : {});
    } catch {
      return dataSchema.parse({});
    }
  }

  private save(d: Data): void {
    try {
      this.kv.setItem(ALERTS_KEY, JSON.stringify(d));
    } catch {
      // Storage full or blocked: alerts still work this session, they just may repeat.
    }
  }

  getSettings(): AlertSettings {
    return this.load().settings;
  }

  saveSettings(patch: Partial<AlertSettings>): AlertSettings {
    const d = this.load();
    d.settings = settingsSchema.parse({ ...d.settings, ...patch });
    this.save(d);
    return d.settings;
  }

  hasFired(key: string): boolean {
    return this.load().fired.includes(key);
  }

  /** Remember an alert so a refresh does not repeat it. Only the most recent keys are kept. */
  markFired(key: string): void {
    const d = this.load();
    if (d.fired.includes(key)) return;
    d.fired = [...d.fired, key].slice(-MAX_FIRED);
    this.save(d);
  }

  /** The once-a-day "you have work due" notification when the app opens. */
  notifiedToday(today: string): boolean {
    return this.load().notifiedOn === today;
  }
  markNotified(today: string): void {
    const d = this.load();
    d.notifiedOn = today;
    this.save(d);
  }
}
