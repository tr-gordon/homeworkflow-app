import { isOverdue } from "./plan";
import { isDone } from "./stages";
import type { Stage } from "./stages";

/**
 * Archiving hides an assignment from the dashboard, the plan, the alerts, the app-icon badge and the
 * calendar reminders without deleting anything: its tracked time and history stay (finished work still
 * feeds the time estimates) and it can be restored. Delete is for mistakes.
 */

interface Archivable {
  archivedAt: string | null;
}

export const isArchived = (a: Archivable): boolean => a.archivedAt !== null;

/** Assignments to show everywhere except the Archived list. */
export function visibleOnly<T extends Archivable>(items: readonly T[]): T[] {
  return items.filter((a) => a.archivedAt === null);
}

/** Newest archived first. */
export function archivedOnly<T extends Archivable>(items: readonly T[]): T[] {
  return items.filter((a) => a.archivedAt !== null).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
}

/** Unfinished, not archived, and past due: what "Archive all overdue" would hide. */
export function overdueToArchive<T extends Archivable & { dueDate: string; stage: Stage }>(items: readonly T[], today: string): T[] {
  return visibleOnly(items).filter((a) => isOverdue(a, today));
}

/** Finished and not archived: what "Archive all completed" would hide. */
export function completedToArchive<T extends Archivable & { stage: Stage }>(items: readonly T[]): T[] {
  return visibleOnly(items).filter((a) => isDone(a.stage));
}
