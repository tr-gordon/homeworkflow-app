"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertSettingsCard } from "@/components/AlertSettings";
import { AppShell } from "@/components/AppShell";
import { Button, Card, ErrorNote, Field, Loading, inputClass } from "@/components/ui";
import { getRepo } from "@/lib/data";
import { errorMessage, useDevice, useRequireRole } from "@/lib/hooks";
import { pinSchema } from "@/lib/validation";

function PinSettings({ hasPin, parentName }: { hasPin: boolean; parentName: string | null }) {
  const [name, setName] = useState(parentName ?? "");
  const [pin, setPin] = useState("");
  const [current, setCurrent] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!pinSchema.safeParse(pin).success) {
      setMsg({ ok: false, text: "A PIN is 4 to 8 digits." });
      return;
    }
    try {
      await getRepo().setParentPin({ pin, parentName: name, currentPin: hasPin ? current : undefined });
      setMsg({ ok: true, text: "Saved." });
      setPin("");
      setCurrent("");
      window.location.reload();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-bold">Parent view on this device</h2>
      <p className="mt-1 text-sm text-muted">
        With a PIN, a parent can open a parent view here to see everything and adjust planned time. It closes when the tab is closed. This is a light lock to stop casual use, not strong
        security: anyone who can use this browser&apos;s developer tools could get around it.
      </p>
      <form onSubmit={save} className="mt-3 space-y-3">
        <Field label="Parent's name" htmlFor="pname">
          <input id="pname" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        {hasPin ? (
          <Field label="Current PIN" htmlFor="cur">
            <input id="cur" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={current} onChange={(e) => setCurrent(e.target.value.replace(/[^0-9]/g, ""))} className={inputClass} />
          </Field>
        ) : null}
        <Field label={hasPin ? "New PIN (4 to 8 digits)" : "PIN (4 to 8 digits)"} htmlFor="newpin">
          <input id="newpin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} className={inputClass} />
        </Field>
        {msg ? msg.ok ? <p role="status" className="text-sm font-semibold text-ok">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote> : null}
        <Button type="submit">{hasPin ? "Change PIN" : "Set PIN"}</Button>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const viewer = useRequireRole("any");
  const device = useDevice();
  const router = useRouter();
  if (!viewer || !device) return <Loading />;
  const studentDevice = device.role === "student";
  return (
    <AppShell viewer={viewer} active="settings">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-extrabold">Settings</h1>
        <Card>
          <h2 className="text-lg font-bold">This device</h2>
          <p className="mt-1">
            {studentDevice ? "Student's device" : "Parent's device"}: <strong>{device.displayName}</strong>
          </p>
        </Card>

        <AlertSettingsCard timers={studentDevice && viewer.role === "student"} />

        {studentDevice && viewer.role === "student" ? <PinSettings hasPin={device.hasParentPin} parentName={device.parentName} /> : null}
        {studentDevice && viewer.role === "parent" ? (
          <Card>
            <p className="text-sm text-muted">The parent PIN can only be changed from the student view.</p>
          </Card>
        ) : null}

        <Card>
          <h2 className="text-lg font-bold">Your data and privacy</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Everything is stored only in this browser. There are no accounts, no server, no analytics and no ads.</li>
            <li>Files you share with a parent contain your homework data: send them only to people you trust.</li>
            <li>Clearing this site&apos;s data deletes your homework. Save a backup file from Share.</li>
          </ul>
        </Card>

        {viewer.role === "student" || !studentDevice ? (
          <Card>
            <h2 className="text-lg font-bold">Erase everything</h2>
            <p className="mt-1 text-sm text-muted">Deletes all homework, time and history on this device. Save a backup first if you may want it back.</p>
            <Button
              variant="danger"
              className="mt-3"
              onClick={async () => {
                if (window.confirm("Erase ALL data on this device? This cannot be undone.") && window.confirm("Really erase everything?")) {
                  await getRepo().eraseAllData();
                  router.replace("/");
                }
              }}
            >
              Erase all data
            </Button>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
