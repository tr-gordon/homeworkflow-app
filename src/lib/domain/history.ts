import type { HistorySample } from "./estimates";
import { isDone } from "./stages";
import { totalActualSeconds } from "./timer";
import type { PlanItem } from "./plan";
import type { AssignmentWithTime } from "./types";

/** Finished assignments with timer data become samples for estimates (T4). */
export function samplesFromAssignments(items: readonly AssignmentWithTime[], now: Date): HistorySample[] {
  return items
    .filter((a) => isDone(a.stage))
    .map((a) => ({ subject: a.subject, difficulty: a.difficulty, actualSeconds: totalActualSeconds(a.sessions, now) }))
    .filter((s) => s.actualSeconds > 0);
}

export function toPlanItem(a: AssignmentWithTime, now: Date): PlanItem {
  return {
    id: a.id,
    title: a.title,
    subject: a.subject,
    dueDate: a.dueDate,
    plannedDate: a.plannedDate,
    stage: a.stage,
    difficulty: a.difficulty,
    allocatedMinutes: a.allocatedMinutes,
    actualSeconds: totalActualSeconds(a.sessions, now),
    plannedStart: a.plannedStart,
    withParent: a.withParent,
  };
}
