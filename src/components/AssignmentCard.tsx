import Link from "next/link";
import { formatClockTime } from "@/lib/domain/changes";
import { describeDue, formatShortDate } from "@/lib/domain/dates";
import { isOverdue } from "@/lib/domain/plan";
import { totalActualSeconds } from "@/lib/domain/timer";
import type { AssignmentWithTime } from "@/lib/domain/types";
import { StageBadge } from "./StageSelector";
import { TimeSummary } from "./TimeSummary";
import { Chip } from "./ui";

export function DueChip({ dueDate, stage, today }: { dueDate: string; stage: AssignmentWithTime["stage"]; today: string }) {
  const overdue = isOverdue({ dueDate, stage }, today);
  const label = describeDue(dueDate, today);
  if (stage === "completed") return <Chip>{`Was due ${dueDate}`}</Chip>;
  // Overdue is conveyed by text and an icon as well as colour (PRD D2).
  if (overdue) return <Chip tone="danger"><span aria-hidden>⚠</span> {label}</Chip>;
  if (dueDate === today) return <Chip tone="warn">{label}</Chip>;
  return <Chip>{label}</Chip>;
}

/** When the work is planned: "Sat 8 Nov, 4:30 pm". Null when no work day is set. */
export function scheduleLabel(a: Pick<AssignmentWithTime, "plannedDate" | "plannedStart">): string | null {
  if (!a.plannedDate) return null;
  return a.plannedStart ? `${formatShortDate(a.plannedDate)}, ${formatClockTime(a.plannedStart)}` : formatShortDate(a.plannedDate);
}

export function TogetherChip({ audience = "student" }: { audience?: "student" | "parent" }) {
  return <Chip tone="warn">{audience === "parent" ? "With you" : "With a parent"}</Chip>;
}

export function AssignmentCard({
  assignment,
  today,
  now,
  href,
  footer,
  audience = "student",
}: {
  assignment: AssignmentWithTime;
  today: string;
  now: Date;
  href: string;
  footer?: React.ReactNode;
  audience?: "student" | "parent";
}) {
  const planned = assignment.stage === "completed" || assignment.archivedAt ? null : scheduleLabel(assignment);
  const overdue = isOverdue(assignment, today);
  return (
    <article className={`rounded-2xl border bg-surface p-4 shadow-sm ${overdue ? "border-danger" : "border-border"}`}>
      <Link href={href} className="block rounded-lg">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="brand">{assignment.subject}</Chip>
          <DueChip dueDate={assignment.dueDate} stage={assignment.stage} today={today} />
          <StageBadge stage={assignment.stage} />
          {assignment.location ? <Chip>At {assignment.location}</Chip> : null}
          {planned ? <Chip tone="brand">Work: {planned}</Chip> : null}
          {assignment.withParent && !assignment.archivedAt ? <TogetherChip audience={audience} /> : null}
        </div>
        <h3 className="mt-2 text-lg font-bold leading-snug">{assignment.title}</h3>
      </Link>
      <div className="mt-3">
        <TimeSummary compact allocatedMinutes={assignment.allocatedMinutes} actualSeconds={totalActualSeconds(assignment.sessions, now)} />
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </article>
  );
}
