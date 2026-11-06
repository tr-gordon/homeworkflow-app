"use client";

import { useEffect, useState } from "react";
import { AlertsStore } from "@/lib/alerts-store";
import { getRepo } from "@/lib/data";
import { alertKey, alertsToFire, timerAlertMessage, timerAlertState, type TimerAlertKind } from "@/lib/domain/alerts";
import { elapsedSeconds } from "@/lib/domain/timer";
import { beep, primeAudio, showSystemNotification, vibrate } from "@/lib/notify";
import { Button } from "./ui";

/** Fired by the Settings "Test alert" button so it exercises the real path. */
export const TEST_ALERT_EVENT = "hwf-test-alert";

interface Toast {
  kind: TimerAlertKind;
  title: string;
  body: string;
}

/**
 * Watches the running timer and alerts at "5 minutes left" and "planned time is up".
 * It works from the saved timer and the device clock, once a second and again whenever the
 * tab becomes visible, so after a phone sleeps it still alerts (as "past your planned time")
 * the moment the app is looked at. It cannot wake a closed app: there is no server.
 */
export function TimerAlertsHost() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    const store = new AlertsStore(window.localStorage);
    const unlock = () => primeAudio(); // sound needs one tap first
    window.addEventListener("pointerdown", unlock, { once: true });

    const deliver = (kind: TimerAlertKind, title: string, body: string, tag: string) => {
      const settings = store.getSettings();
      setToast({ kind, title, body });
      if (settings.vibrate) vibrate(kind);
      if (settings.sound) beep(kind);
      // A system notification is only useful when the app is not on screen.
      if (settings.systemNotifications && document.visibilityState !== "visible") void showSystemNotification(title, body, tag);
    };

    const tick = async () => {
      const active = await getRepo().getActiveTimer().catch(() => null);
      const planned = active?.assignment.allocatedMinutes;
      if (!active || active.session.state !== "running" || !planned) return;

      const state = timerAlertState(elapsedSeconds(active.session, new Date()), planned);
      const fired = new Set<TimerAlertKind>((["warning", "reached"] as const).filter((k) => store.hasFired(alertKey(active.session.id, planned, k))));
      for (const kind of alertsToFire(state, fired)) {
        // Mark first so a refresh or a second tab does not repeat it.
        store.markFired(alertKey(active.session.id, planned, kind));
        if (kind === "reached") store.markFired(alertKey(active.session.id, planned, "warning"));
        if (kind === "warning" && !store.getSettings().warning) continue;
        const msg = timerAlertMessage(kind, planned, state?.overSeconds ?? 0, active.assignment.title);
        deliver(kind, msg.title, msg.body, `timer-${active.session.id}-${kind}`);
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
    };
  }, []);

  if (!toast) return null;
  return (
    <div role="alert" className="fixed inset-x-3 top-3 z-50 mx-auto max-w-md rounded-2xl border border-warn bg-warn-soft p-4 text-warn shadow-lg">
      <p className="text-lg font-extrabold">{toast.title}</p>
      <p className="mt-0.5">{toast.body}</p>
      <Button variant="secondary" className="mt-3 w-full" onClick={() => setToast(null)}>
        OK
      </Button>
    </div>
  );
}
