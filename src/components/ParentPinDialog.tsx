"use client";

import { useEffect, useRef, useState } from "react";
import { getRepo } from "@/lib/data";
import { errorMessage } from "@/lib/hooks";
import { Button, ErrorNote, Field, inputClass } from "./ui";

/** Asks for the parent PIN before opening the parent view on a shared student device. */
export function ParentPinDialog({ onClose, onUnlocked }: { onClose: () => void; onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    // showModal() is missing before iOS 15.4; the plain open attribute still shows the dialog.
    if (typeof d.showModal === "function") d.showModal();
    else d.setAttribute("open", "");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getRepo().switchToParent(pin);
      onUnlocked();
    } catch (err) {
      setError(errorMessage(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose} className="m-auto w-[min(92vw,24rem)] rounded-2xl border border-border bg-surface p-5 text-text shadow-xl backdrop:bg-black/50">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-xl font-extrabold">Parent view</h2>
        <Field label="Parent PIN" htmlFor="parent-pin">
          <input
            id="parent-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
            maxLength={8}
            className={`${inputClass} text-center text-2xl tracking-widest`}
          />
        </Field>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={busy || pin.length < 4} className="flex-1">
            {busy ? "Checking…" : "Open"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </dialog>
  );
}
