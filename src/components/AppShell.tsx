"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getRepo } from "@/lib/data";
import type { Profile } from "@/lib/domain/types";
import { VIEWER_CHANGED_EVENT, useDevice } from "@/lib/hooks";
import { ParentPinDialog } from "./ParentPinDialog";
import { Button } from "./ui";

type Tab = "home" | "new" | "share" | "settings";

function navFor(role: Profile["role"]): { id: Tab; href: string; label: string }[] {
  return role === "student"
    ? [
        { id: "home", href: "/student", label: "Today" },
        { id: "new", href: "/new", label: "Add" },
        { id: "share", href: "/share", label: "Share" },
        { id: "settings", href: "/settings", label: "Settings" },
      ]
    : [
        { id: "home", href: "/parent", label: "Dashboard" },
        { id: "share", href: "/share", label: "Share" },
        { id: "settings", href: "/settings", label: "Settings" },
      ];
}

export function AppShell({ viewer, active, children }: { viewer: Profile; active: Tab; children: React.ReactNode }) {
  const router = useRouter();
  const device = useDevice();
  const [askPin, setAskPin] = useState(false);
  const tabs = navFor(viewer.role);
  const onSharedDevice = device?.role === "student";
  const demo = device?.demo === true;

  function viewerChanged(to: "/student" | "/parent") {
    window.dispatchEvent(new Event(VIEWER_CHANGED_EVENT));
    router.push(to);
  }

  async function openParentView() {
    if (demo) {
      await getRepo().switchToParent("");
      viewerChanged("/parent");
    } else if (!device?.hasParentPin) {
      router.push("/settings");
    } else {
      setAskPin(true);
    }
  }

  async function backToStudent() {
    await getRepo().switchToStudent();
    viewerChanged("/student");
  }

  return (
    <div className="min-h-dvh">
      {demo ? (
        <div className="border-b border-border bg-warn-soft px-4 py-2 text-sm text-warn">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
            <p className="font-semibold">Demo mode: fictional sample data, stored only in this browser.</p>
            <button
              type="button"
              className="min-h-9 rounded-lg border border-border bg-surface px-3 font-medium text-text"
              onClick={async () => {
                if (window.confirm("Reset all demo data to the original samples?")) {
                  await getRepo().eraseAllData();
                  window.location.reload();
                }
              }}
            >
              Reset demo data
            </button>
          </div>
        </div>
      ) : null}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href={viewer.role === "student" ? "/student" : "/parent"} className="text-lg font-extrabold tracking-tight text-brand-strong">
            HomeworkFlow
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {tabs.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                aria-current={active === t.id ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${active === t.id ? "bg-brand-soft text-brand-strong" : "text-muted hover:bg-surface-2"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted sm:inline">
              {viewer.displayName}
              {onSharedDevice && viewer.role === "parent" ? " (parent view)" : ""}
            </span>
            {onSharedDevice ? (
              viewer.role === "student" ? (
                <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={openParentView}>
                  Parent view
                </Button>
              ) : (
                <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={backToStudent}>
                  Student view
                </Button>
              )
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 md:pb-10">{children}</main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="mx-auto flex max-w-md">
          {tabs.map((t) => (
            <li key={t.id} className="flex-1">
              <Link
                href={t.href}
                aria-current={active === t.id ? "page" : undefined}
                className={`flex min-h-14 items-center justify-center text-sm font-semibold ${active === t.id ? "text-brand-strong" : "text-muted"}`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {askPin ? (
        <ParentPinDialog
          onClose={() => setAskPin(false)}
          onUnlocked={() => {
            setAskPin(false);
            viewerChanged("/parent");
          }}
        />
      ) : null}
    </div>
  );
}
