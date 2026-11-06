"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertsStore } from "@/lib/alerts-store";
import { getRepo } from "@/lib/data";
import { attentionText, buildAttention, titleList, type AttentionSummary } from "@/lib/domain/alerts";
import { toPlanItem } from "@/lib/domain/history";
import type { Profile } from "@/lib/domain/types";
import { useLoad, useToday } from "@/lib/hooks";
import { notificationPermission, setBadge, showSystemNotification } from "@/lib/notify";

interface Row {
  name: string;
  summary: AttentionSummary;
}

const dismissKey = (today: string) => `homeworkflow.attention.dismissed.${today}`;

/** Dismissed for the rest of today in this browser session (a plain read: safe to call while rendering). */
function wasDismissed(today: string): boolean {
  try {
    return window.sessionStorage.getItem(dismissKey(today)) === "1";
  } catch {
    return false;
  }
}

/**
 * "Heads up: 2 overdue, 1 due today" at the top of a dashboard, plus (on a student's own
 * view) the number on the app icon and, if turned on, one system notification per day when the
 * app is opened. The parent sees the same for each student, as of the last file.
 */
export function AttentionBanner({ viewer }: { viewer: Profile }) {
  const today = useToday();
  const [dismissedDay, setDismissedDay] = useState<string | null>(null);

  const data = useLoad(async () => {
    const repo = getRepo();
    const students = await repo.listStudents();
    const rows: Row[] = [];
    for (const s of students) {
      const items = await repo.listAssignments(s.id);
      rows.push({ name: s.displayName, summary: buildAttention(items.map((a) => toPlanItem(a, new Date())), today || "0000-00-00") });
    }
    return rows;
  }, [viewer.id, today]);

  const rows = useMemo(() => (data.status === "ready" && today !== "" ? data.data.filter((r) => r.summary.badge > 0) : []), [data, today]);
  const studentTotal = viewer.role === "student" && data.status === "ready" ? (data.data[0]?.summary.badge ?? 0) : 0;
  const studentSummary = viewer.role === "student" && data.status === "ready" ? data.data[0]?.summary : undefined;

  // App icon badge: only meaningful on the student's own device and view.
  useEffect(() => {
    if (data.status !== "ready") return;
    setBadge(viewer.role === "student" ? studentTotal : 0);
  }, [data.status, studentTotal, viewer.role]);

  // One notification a day when the app is opened with work due (opt-in).
  useEffect(() => {
    if (today === "" || !studentSummary || studentSummary.badge === 0) return;
    const store = new AlertsStore(window.localStorage);
    if (!store.getSettings().systemNotifications || notificationPermission() !== "granted" || store.notifiedToday(today)) return;
    store.markNotified(today);
    const names = titleList([...studentSummary.overdueTitles, ...studentSummary.dueTodayTitles]);
    void showSystemNotification("Homework needs attention", `${attentionText(studentSummary)}: ${names}`, "attention");
  }, [today, studentSummary]);

  if (rows.length === 0 || dismissedDay === today || wasDismissed(today)) return null;
  return (
    <div role="status" className="flex items-start justify-between gap-3 rounded-2xl border border-danger bg-danger-soft px-4 py-3 text-danger">
      <div className="min-w-0">
        <p className="font-extrabold">
          <span aria-hidden>⚠ </span>Heads up
        </p>
        <ul className="mt-0.5 space-y-0.5 text-sm font-medium">
          {rows.map((r) => (
            <li key={r.name}>
              {viewer.role === "parent" ? <strong>{r.name}: </strong> : null}
              {attentionText(r.summary)}
              <span className="font-normal"> ({titleList([...r.summary.overdueTitles, ...r.summary.dueTodayTitles], 2)})</span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-semibold underline"
        onClick={() => {
          try {
            window.sessionStorage.setItem(dismissKey(today), "1");
          } catch {
            // ignore
          }
          setDismissedDay(today);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
