import { addDays, toLocalDateString } from "../domain/dates";
import type { Stage } from "../domain/stages";
import type { AllocationChange, Assignment, Difficulty, TimerSession } from "../domain/types";
import { emptyState, type AppState } from "./state";
import { newPairingSecret } from "./sync";

/**
 * FICTIONAL sample data for demo mode and local testing (PRD X6).
 * Names are invented, nothing here comes from a real student, and dates are
 * generated relative to "today" so the demo never goes stale.
 */

export const DEMO_IDS = {
  alex: "demo-student-alex",
} as const;

interface Spec {
  student: string;
  title: string;
  subject: string;
  description: string;
  dueOffset: number;
  difficulty: Difficulty;
  stage: Stage;
  allocated: number | null;
  plannedOffset?: number;
  /** Tracked minutes (one finished session unless `running`). */
  trackedMinutes?: number;
}

const SPECS: Spec[] = [
  // Alex: a mix that exercises overdue, due today, planned, unallocated and completed.
  { student: DEMO_IDS.alex, title: "Fractions worksheet", subject: "Math", description: "Problems 1 to 20, show your work.", dueOffset: -2, difficulty: 2, stage: "getting_started", allocated: 25, trackedMinutes: 10 },
  { student: DEMO_IDS.alex, title: "Book report: chapter 5", subject: "English", description: "One page. Main idea plus two quotes.", dueOffset: 0, difficulty: 3, stage: "halfway", allocated: 40, trackedMinutes: 20 },
  { student: DEMO_IDS.alex, title: "Science lab write-up", subject: "Science", description: "Hypothesis, method, results.", dueOffset: 1, difficulty: 4, stage: "not_started", allocated: 60 },
  { student: DEMO_IDS.alex, title: "Spanish vocab (unit 3)", subject: "Spanish", description: "Flashcards for 25 words.", dueOffset: 2, difficulty: 2, stage: "not_started", allocated: 20, plannedOffset: 0 },
  { student: DEMO_IDS.alex, title: "History timeline poster", subject: "History", description: "Ten events with dates and pictures.", dueOffset: 6, difficulty: 3, stage: "not_started", allocated: null },
  { student: DEMO_IDS.alex, title: "Geometry practice", subject: "Math", description: "Angles and triangles, odd numbers.", dueOffset: 9, difficulty: 3, stage: "not_started", allocated: 40, plannedOffset: 5 },
  // Alex: completed work with timer data (three at difficulty 3 so estimates can refine).
  { student: DEMO_IDS.alex, title: "Algebra review", subject: "Math", description: "", dueOffset: -5, difficulty: 3, stage: "completed", allocated: 40, trackedMinutes: 55 },
  { student: DEMO_IDS.alex, title: "Poetry analysis", subject: "English", description: "", dueOffset: -7, difficulty: 3, stage: "completed", allocated: 45, trackedMinutes: 50 },
  { student: DEMO_IDS.alex, title: "Lab safety quiz prep", subject: "Science", description: "", dueOffset: -8, difficulty: 3, stage: "completed", allocated: 30, trackedMinutes: 35 },
  { student: DEMO_IDS.alex, title: "Reading log", subject: "English", description: "", dueOffset: -4, difficulty: 2, stage: "completed", allocated: 20, trackedMinutes: 28 },
];

export function buildDemoState(now: Date, deviceId: string): AppState {
  const today = toLocalDateString(now);
  const iso = (daysAgo: number, hour = 16) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const parentActor = `parent:${deviceId}`;

  const assignments: Assignment[] = [];
  const sessions: TimerSession[] = [];
  const history: AllocationChange[] = [];

  SPECS.forEach((s, i) => {
    const id = `demo-asg-${i + 1}`;
    const created = iso(10);
    assignments.push({
      id,
      studentId: s.student,
      title: s.title,
      subject: s.subject,
      description: s.description,
      dueDate: addDays(today, s.dueOffset),
      difficulty: s.difficulty,
      stage: s.stage,
      allocatedMinutes: s.allocated,
      plannedDate: s.plannedOffset === undefined ? null : addDays(today, s.plannedOffset),
      completedAt: s.stage === "completed" ? iso(Math.max(1, -s.dueOffset - 1)) : null,
      createdAt: created,
      updatedAt: created,
    });
    if (s.allocated !== null) {
      history.push({
        id: `demo-hist-${i + 1}`,
        assignmentId: id,
        oldMinutes: null,
        newMinutes: s.allocated,
        changedBy: s.student,
        changedByName: "Alex Sample",
        changedByRole: "student",
        changedAt: created,
        status: "applied",
      });
    }
    if (s.trackedMinutes) {
      const when = iso(Math.max(0, -s.dueOffset - 1), 17);
      sessions.push({
        id: `demo-session-${i + 1}`,
        assignmentId: id,
        studentId: s.student,
        state: "finished",
        startedAt: when,
        lastResumedAt: null,
        accumulatedSeconds: s.trackedMinutes * 60,
        finishedAt: when,
      });
    }
  });

  // A parent adjustment on the science lab (student planned 90, parent trimmed to 60),
  // so the history view shows two different actors.
  const lab = assignments.find((a) => a.title === "Science lab write-up");
  if (lab) {
    const first = history.find((h) => h.assignmentId === lab.id);
    if (first) first.newMinutes = 90;
    history.push({
      id: "demo-hist-parent-1",
      assignmentId: lab.id,
      oldMinutes: 90,
      newMinutes: 60,
      changedBy: parentActor,
      changedByName: "Jordan Sample",
      changedByRole: "parent",
      changedAt: iso(1, 19),
      status: "applied",
    });
  }

  return {
    ...emptyState(deviceId, true),
    role: "student",
    displayName: "Alex Sample",
    parentName: "Jordan Sample",
    students: [{ id: DEMO_IDS.alex, displayName: "Alex Sample" }],
    pairingSecret: newPairingSecret(),
    assignments,
    sessions,
    history,
  };
}
