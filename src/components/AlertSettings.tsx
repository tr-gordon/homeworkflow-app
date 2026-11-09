"use client";

import { useEffect, useState } from "react";
import { AlertsStore, DEFAULT_SETTINGS, type AlertSettings as Settings } from "@/lib/alerts-store";
import { notificationPermission, primeAudio, requestNotificationPermission, type PermissionState } from "@/lib/notify";
import { TEST_ALERT_EVENT } from "./TimerAlertsHost";
import { Button, Card } from "./ui";

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-start justify-between gap-4 py-2">
      <span>
        <span className="block font-semibold">{label}</span>
        {hint ? <span className="block text-sm text-muted">{hint}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-11 shrink-0 accent-[var(--brand)]" />
    </label>
  );
}

/** Alert preferences. `timers` shows the timer options (student's own device only). */
export function AlertSettingsCard({ timers }: { timers: boolean }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [permission, setPermission] = useState<PermissionState>("default");

  useEffect(() => {
    // Read from browser storage after mount (not available during server render).
    const t = setTimeout(() => {
      setSettings(new AlertsStore(window.localStorage).getSettings());
      setPermission(notificationPermission());
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const update = (patch: Partial<Settings>) => setSettings(new AlertsStore(window.localStorage).saveSettings(patch));

  return (
    <Card>
      <h2 className="text-lg font-bold">Alerts</h2>
      <p className="mt-1 text-sm text-muted">
        HomeworkFlow has no server, so it can only alert while it is open (or just after you come back to it). For alerts when the app is closed, add reminders to your phone&apos;s calendar from
        Share.
      </p>
      <div className="mt-2 divide-y divide-border">
        {timers ? (
          <>
            <Toggle label="Sound" hint="A short beep when a timer alerts." checked={settings.sound} onChange={(v) => update({ sound: v })} />
            <Toggle label="Vibration" hint="Phones that support it." checked={settings.vibrate} onChange={(v) => update({ vibrate: v })} />
            <Toggle label="Keep the screen on while timing" hint="Stops the phone sleeping so the alert rings on time. Uses more battery." checked={settings.keepAwake} onChange={(v) => update({ keepAwake: v })} />
            <Toggle label="5 minute heads-up" hint="Before the planned time is used up. Plans under 10 minutes skip it." checked={settings.warning} onChange={(v) => update({ warning: v })} />
          </>
        ) : null}
        <div className="py-2">
          <Toggle
            label="System notifications"
            hint={
              permission === "unsupported"
                ? "This browser can't show notifications."
                : permission === "denied"
                  ? "Blocked in the browser settings for this site."
                  : "Timer alerts when the app is in the background, and a daily note when you open the app with work due."
            }
            checked={settings.systemNotifications && permission === "granted"}
            onChange={async (v) => {
              if (!v) return update({ systemNotifications: false });
              // Blocked or unsupported: asking again cannot succeed, and the hint already says why.
              if (permission === "denied" || permission === "unsupported") return;
              const result = permission === "granted" ? "granted" : await requestNotificationPermission();
              setPermission(result);
              update({ systemNotifications: result === "granted" });
            }}
          />
        </div>
      </div>
      {timers ? (
        <Button
          variant="secondary"
          className="mt-2"
          onClick={() => {
            primeAudio();
            window.dispatchEvent(new Event(TEST_ALERT_EVENT));
          }}
        >
          Test alert
        </Button>
      ) : null}
    </Card>
  );
}
