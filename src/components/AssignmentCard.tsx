import Link from "next/link";
import { describeDue } from "@/lib/domain/dates";
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

export function AssignmentCard({
  assignment,
  today,
  now,
  href,
  footer,
}: {
  assignment: AssignmentWithTime;
  today: string;
  now: Date;
  href: string;
  footer?: React.ReactNode;
}) {
  const overdue = isOverdue(assignment, today);
  return (
    <article className={`rounded-2xl border bg-surface p-4 shadow-sm ${overdue ? "border-danger" : "border-border"}`}>
      <Link href={href} className="block rounded-lg">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="brand">{assignment.subject}</Chip>
          <DueChip dueDate={assignment.dueDate} stage={assignment.stage} today={today} />
          <StageBadge stage={assignment.stage} />
          {assignment.location ? <Chip>At {assignment.location}</Chip> : null}
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
