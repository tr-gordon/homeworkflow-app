import { addDays, compareDates, diffDays } from "./dates";
import { isDone } from "./stages";
import type { Stage } from "./stages";
import type { Difficulty } from "./types";

/** Minimal shape the plan needs; keeps this module independent of storage. */
export interface PlanItem {
  id: string;
  title: string;
  subject: string;
  dueDate: string;
  plannedDate: string | null;
  stage: Stage;
  difficulty: Difficulty;
  allocatedMinutes: number | null;
  actualSeconds: number;
}

/** Overdue = due date before today and not completed (PRD D2). */
export function isOverdue(item: Pick<PlanItem, "dueDate" | "stage">, today: string): boolean {
  return !isDone(item.stage) && compareDates(item.dueDate, today) < 0;
}

export interface DailyPlan<T extends PlanItem> {
  overdue: T[];
  dueToday: T[];
  /** Planned for today, or planned earlier and not finished (carried over). */
  plannedToday: T[];
  /** Unplanned and due within the next 2 days: suggestions only. */
  comingUp: T[];
  totals: {
    allocatedMinutes: number;
    actualMinutes: number;
    /** Sum over items of max(0, allocated - actual). */
    remainingMinutes: number;
    unallocatedCount: number;
  };
}

const COMING_UP_DAYS = 2;

function byDueThenDifficulty<T extends PlanItem>(a: T, b: T): number {
  return (
    compareDates(a.dueDate, b.dueDate) ||
    b.difficulty - a.difficulty ||
    a.title.localeCompare(b.title)
  );
}

/**
 * Daily plan (PRD D1). Each assignment appears in the first section that
 * applies: overdue, due today, planned for today, coming up.
 * Completed assignments never appear.
 */
export function buildDailyPlan<T extends PlanItem>(items: readonly T[], today: string): DailyPlan<T> {
  const overdue: T[] = [];
  const dueToday: T[] = [];
  const plannedToday: T[] = [];
  const comingUp: T[] = [];

  for (const item of items) {
    if (isDone(item.stage)) continue;
    if (compareDates(item.dueDate, today) < 0) overdue.push(item);
    else if (item.dueDate === today) dueToday.push(item);
    else if (item.plannedDate !== null && compareDates(item.plannedDate, today) <= 0) {
      plannedToday.push(item);
    } else if (item.plannedDate === null) {
      const days = diffDays(item.dueDate, today);
      if (days >= 1 && days <= COMING_UP_DAYS) comingUp.push(item);
    }
  }

  overdue.sort(byDueThenDifficulty);
  dueToday.sort(byDueThenDifficulty);
  plannedToday.sort(byDueThenDifficulty);
  comingUp.sort(byDueThenDifficulty);

  const today_ = [...overdue, ...dueToday, ...plannedToday];
  let allocated = 0;
  let actualSeconds = 0;
  let remaining = 0;
  let unallocated = 0;
  for (const i of today_) {
    actualSeconds += i.actualSeconds;
    if (i.allocatedMinutes === null) {
      unallocated += 1;
      continue;
    }
    allocated += i.allocatedMinutes;
    remaining += Math.max(0, i.allocatedMinutes - i.actualSeconds / 60);
  }

  return {
    overdue,
    dueToday,
    plannedToday,
    comingUp,
    totals: {
      allocatedMinutes: allocated,
      actualMinutes: Math.round(actualSeconds / 60),
      remainingMinutes: Math.round(remaining),
      unallocatedCount: unallocated,
    },
  };
}

export interface WorkloadSummary {
  overdue: number;
  /** Not completed and due today through the next 2 days. */
  dueSoon: number;
  /** Stage is getting_started, halfway or almost_done. */
  inProgress: number;
  notStarted: number;
  completed: number;
  /** Active (not completed) assignments only. */
  allocatedMinutes: number;
  actualMinutes: number;
}

export function summarizeWorkload(items: readonly PlanItem[], today: string): WorkloadSummary {
  const s: WorkloadSummary = {
    overdue: 0,
    dueSoon: 0,
    inProgress: 0,
    notStarted: 0,
    completed: 0,
    allocatedMinutes: 0,
    actualMinutes: 0,
  };
  let actualSeconds = 0;
  for (const i of items) {
    if (isDone(i.stage)) {
      s.completed += 1;
      continue;
    }
    if (isOverdue(i, today)) s.overdue += 1;
    else if (compareDates(i.dueDate, addDays(today, COMING_UP_DAYS)) <= 0) s.dueSoon += 1;
    if (i.stage === "not_started") s.notStarted += 1;
    else s.inProgress += 1;
    s.allocatedMinutes += i.allocatedMinutes ?? 0;
    actualSeconds += i.actualSeconds;
  }
  s.actualMinutes = Math.round(actualSeconds / 60);
  return s;
}
