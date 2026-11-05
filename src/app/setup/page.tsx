"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, Field, inputClass } from "@/components/ui";
import { getRepo } from "@/lib/data";
import { errorMessage } from "@/lib/hooks";
import { pinSchema } from "@/lib/validation";

type Kind = "student" | "parent";

/** First run: say whose device this is. Nothing leaves the device. */
export default function SetupPage() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [name, setName] = useState("");
  const [parentName, setParentName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already set up? Go to the right dashboard instead of showing setup again.
  useEffect(() => {
    getRepo()
      .getViewer()
      .then((v) => v && router.replace(v.role === "student" ? "/student" : "/parent"))
      .catch(() => undefined);
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setError(null);
    if (kind === "student" && pin !== "" && !pinSchema.safeParse(pin).success) {
      setError("A parent PIN is 4 to 8 digits.");
      return;
    }
    if (kind === "student" && pin !== "" && parentName.trim() === "") {
      setError("Add the parent's name for the PIN.");
      return;
    }
    setBusy(true);
    try {
      const repo = getRepo();
      await repo.setup({ role: kind, displayName: name, parentName: parentName.trim() || undefined });
      if (kind === "student" && pin !== "") await repo.setParentPin({ pin, parentName });
      router.replace(kind === "student" ? "/student" : "/parent");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 pb-10 pt-12">
      <p className="mb-6 text-center text-2xl font-extrabold tracking-tight text-brand-strong">HomeworkFlow</p>
      <Card>
        <h1 className="text-2xl font-extrabold">Welcome</h1>
        <p className="mt-1 text-muted">Whose device is this? Everything stays on this device. There are no accounts and nothing is uploaded.</p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div role="radiogroup" aria-label="Whose device is this?" className="grid gap-2">
            {(
              [
                ["student", "A student's device", "Add homework, run the timer, plan the day."],
                ["parent", "A parent's device", "See a student's homework from a file they share, and adjust time."],
              ] as const
            ).map(([k, title, hint]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={`rounded-xl border p-3 text-left ${kind === k ? "border-brand bg-brand-soft" : "border-border bg-surface hover:bg-surface-2"}`}
              >
                <span className="block font-bold">{title}</span>
                <span className="block text-sm text-muted">{hint}</span>
              </button>
            ))}
          </div>

          {kind ? (
            <>
              <Field label={kind === "student" ? "Student's first name or nickname" : "Your first name"} htmlFor="name">
                <input id="name" required maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
              </Field>
              {kind === "student" ? (
                <fieldset className="space-y-3 rounded-xl bg-surface-2 p-3">
                  <legend className="px-1 text-sm font-semibold">Optional: parent view on this device</legend>
                  <p className="text-sm text-muted">A parent can open a PIN-protected parent view here to adjust time. You can also do this later in Settings.</p>
                  <Field label="Parent's name" htmlFor="parentName">
                    <input id="parentName" maxLength={40} value={parentName} onChange={(e) => setParentName(e.target.value)} className={inputClass} />
                  </Field>
                  <Field label="Parent PIN (4 to 8 digits)" htmlFor="pin">
                    <input id="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} className={inputClass} />
                  </Field>
                </fieldset>
              ) : null}
              {error ? <ErrorNote>{error}</ErrorNote> : null}
              <Button type="submit" disabled={busy || name.trim() === ""} className="w-full">
                {busy ? "Setting up…" : "Get started"}
              </Button>
            </>
          ) : null}
        </form>
      </Card>
    </main>
  );
}
