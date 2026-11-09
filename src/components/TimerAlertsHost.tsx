"use client";

import { useEffect, useState } from "react";
import { AlertsStore } from "@/lib/alerts-store";
import { getRepo } from "@/lib/data";
import {
  EXTRA_MINUTE_CHOICES,
  MAX_REPEATS,
  REPEAT_EVERY_MS,
  alertKey,
  alertsToFire,
  extendedPlan,
  timerAlertMessage,
  timerAlertState,
  wantsWakeLock,
  type TimerAlertKind,
} from "@/lib/domain/alerts";
import { elapsedSeconds } from "@/lib/domain/timer";
import { DATA_CHANGED_EVENT } from "@/lib/hooks";
import { beep, primeAudio, showSystemNotification, vibrate } from "@/lib/notify";
import { WakeLockHolder } from "@/lib/wake-lock";
import { Button } from "./ui";

/** Fired by the Settings "Test alert" button so it exercises the real path. */
export const TEST_ALERT_EVENT = "hwf-test-alert";

interface Toast {
  kind: TimerAlertKind;
  title: string;
  body: string;
  /** For "+5 / +10 min" on the time-is-up alert. */
  assignmentId?: string;
  planned?: number;
}

/**
 * Watches the running timer and alerts at "5 minutes left" and "planned time is up".
 * It works from the saved timer and the device clock, once a second and again whenever the
 * tab becomes visible, so after a phone sleeps it still alerts (as "past your planned time")
 * the moment the app is looked at. It cannot wake a closed app: there is no server. To keep a phone from
 * sleeping through it, the screen is held awake while a timer with a plan is running (a setting, on by
 * default), the "time is up" alert repeats until it is dismissed, and it offers "+5 / +10 min" to carry on.
 */
export function TimerAlertsHost() {
  const [toast, setToast] = useState<Toast | null>(null);
  const [extendError, setExtendError] = useState(false);

  // "Time is up" keeps nudging (beep and vibration) until it is dismissed, up to MAX_REPEATS times.
  const repeating = toast?.kind === "reached";
  useEffect(() => {
    if (!repeating) return;
    const store = new AlertsStore(window.localStorage);
    let count = 0;
    const id = setInterval(() => {
      count += 1;
      const settings = store.getSettings();
      if (settings.vibrate) vibrate("reached");
      if (settings.sound) beep("reached");
      if (count >= MAX_REPEATS) clearInterval(id);
    }, REPEAT_EVERY_MS);
    return () => clearInterval(id);
  }, [repeating]);

  useEffect(() => {
    const store = new AlertsStore(window.localStorage);
    const unlock = () => primeAudio(); // sound needs one tap first
    window.addEventListener("pointerdown", unlock, { once: true });

    const wakeLock = new WakeLockHolder();

    const deliver = (kind: TimerAlertKind, title: string, body: string, tag: string, extra?: { assignmentId: string; planned: number }) => {
      const settings = store.getSettings();
      setExtendError(false);
      setToast({ kind, title, body, ...extra });
      if (settings.vibrate) vibrate(kind);
      if (settings.sound) beep(kind);
      // A system notification is only useful when the app is not on screen.
      if (settings.systemNotifications && document.visibilityState !== "visible") void showSystemNotification(title, body, tag);
    };

    const tick = async () => {
      const active = await getRepo().getActiveTimer().catch(() => null);
      const planned = active?.assignment.allocatedMinutes;
      const hold = wantsWakeLock({ keepAwake: store.getSettings().keepAwake, timerRunning: active?.session.state === "running", hasPlan: Boolean(planned) });
      if (hold) void wakeLock.acquire();
      else if (wakeLock.held) void wakeLock.release();
      if (!active || active.session.state !== "running" || !planned) return;

      const state = timerAlertState(elapsedSeconds(active.session, new Date()), planned);
      const fired = new Set<TimerAlertKind>((["warning", "reached"] as const).filter((k) => store.hasFired(alertKey(active.session.id, planned, k))));
      for (const kind of alertsToFire(state, fired)) {
        // Mark first so a refresh or a second tab does not repeat it.
        store.markFired(alertKey(active.session.id, planned, kind));
        if (kind === "reached") store.markFired(alertKey(active.session.id, planned, "warning"));
        if (kind === "warning" && !store.getSettings().warning) continue;
        const msg = timerAlertMessage(kind, planned, state?.overSeconds ?? 0, active.assignment.title);
        deliver(kind, msg.title, msg.body, `timer-${active.session.id}-${kind}`, { assignmentId: active.assignment.id, planned });
      }
    };

    const onTest = () => deliver("reached", "Test alert", "This is how a timer alert looks and sounds on this device.", "hwf-test");
    window.addEventListener(TEST_ALERT_EVENT, onTest);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => void tick(), 1000);
    void tick();

    return () => {
      clearInterval(id);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener(TEST_ALERT_EVENT, onTest);
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLock.release();
    };
  }, []);

  async function addMinutes(extra: number) {
    if (!toast?.assignmentId || !toast.planned) return;
    try {
      await getRepo().setAllocation(toast.assignmentId, extendedPlan(toast.planned, extra));
      window.dispatchEvent(new Event(DATA_CHANGED_EVENT)); // screens show the new plan at once
      setToast(null);
    } catch {
      setExtendError(true);
    }
  }

  if (!toast) return null;
  return (
    <div role="alert" className="fixed inset-x-3 top-3 z-50 mx-auto max-w-md rounded-2xl border border-warn bg-warn-soft p-4 text-warn shadow-lg">
      <p className="text-lg font-extrabold">{toast.title}</p>
      <p className="mt-0.5">{toast.body}</p>
      {extendError ? <p className="mt-2 text-sm font-semibold">Couldn&apos;t add the time. Try again from the timer screen.</p> : null}
      {toast.kind === "reached" && toast.assignmentId ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {EXTRA_MINUTE_CHOICES.map((m) => (
            <Button key={m} variant="secondary" onClick={() => addMinutes(m)}>
              +{m} min
            </Button>
          ))}
        </div>
      ) : null}
      <Button variant="secondary" className="mt-2 w-full" onClick={() => setToast(null)}>
        OK
      </Button>
    </div>
  );
}
