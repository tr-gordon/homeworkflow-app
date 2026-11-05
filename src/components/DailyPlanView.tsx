"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getRepo } from "@/lib/data";
import { describeDue } from "@/lib/domain/dates";
import type { DailyPlan } from "@/lib/domain/plan";
import { formatMinutes, totalActualSeconds } from "@/lib/domain/timer";
import type { AssignmentWithTime } from "@/lib/domain/types";
import { assignmentHref } from "@/lib/links";
import { errorMessage } from "@/lib/hooks";
import { StageBadge } from "./StageSelector";
import { TimeSummary } from "./TimeSummary";
import { Button, Card, Chip, ErrorNote } from "./ui";

type Item = AssignmentWithTime & { actualSeconds: number };

function Row({ a, today, now, tone, canStart, onStart, extra }: { a: Item; today: string; now: Date; tone: "danger" | "warn" | "neutral"; canStart: boolean; onStart: (id: string) => void; extra?: React.ReactNode }) {
  return (
    <li className={`rounded-xl border p-3 ${tone === "danger" ? "border-danger" : "border-border"} bg-surface`}>
      <div className="flex items-start justify-between gap-3">
        <Link href={assignmentHref(a.id)} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="brand">{a.subject}</Chip>
            <StageBadge stage={a.stage} />
            {tone === "danger" ? (
              <Chip tone="danger">
                <span aria-hidden>⚠</span> {describeDue(a.dueDate, today)}
              </Chip>
            ) : tone === "warn" ? (
              <Chip tone="warn">{describeDue(a.dueDate, today)}</Chip>
            ) : null}
          </div>
          <p className="mt-1.5 font-bold leading-snug">{a.title}</p>
        </Link>
        <div className="flex shrink-0 flex-col gap-2">
          {canStart ? (
            <Button className="min-h-10 px-3 text-sm" onClick={() => onStart(a.id)}>
              Start
            </Button>
          ) : null}
          {extra}
        </div>
      </div>
      <div className="mt-2">
        <TimeSummary compact allocatedMinutes={a.allocatedMinutes} actualSeconds={totalActualSeconds(a.sessions, now)} />
      </div>
    </li>
  );
}

function Group({ title, hint, children, count }: { title: string; hint?: string; children: React.ReactNode; count: number }) {
  if (count === 0) return null;
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-base font-bold">{title}</h3>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

/** Student's daily plan (PRD D1): overdue, due today, planned for today, and suggestions. */
export function DailyPlanView({
  plan,
  today,
  now,
  timerBusy,
  onChanged,
}: {
  plan: DailyPlan<Item>;
  today: string;
  now: Date;
  /** True when a timer is already active (starting another is not possible). */
  timerBusy: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const total = plan.overdue.length + plan.dueToday.length + plan.plannedToday.length;

  async function start(id: string) {
    setError(null);
    try {
      await getRepo().timerStart(id);
      router.push(assignmentHref(id));
    } catch (e) {
      setError(errorMessage(e));
      onChanged();
    }
  }

  async function addToToday(id: string) {
    setError(null);
    try {
      await getRepo().updateAssignment(id, { plannedDate: today });
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const t = plan.totals;
  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold">Today&apos;s plan</h2>
        {total === 0 ? (
          <p className="mt-1 text-muted">Nothing is due or planned for today. Nice! Check &quot;Coming up&quot; below.</p>
        ) : (
          <p className="mt-1 text-muted">
            {total} {total === 1 ? "thing" : "things"} on your list
            {t.allocatedMinutes > 0 ? ` · ${formatMinutes(t.allocatedMinutes)} planned` : ""}
            {t.actualMinutes > 0 ? ` · ${formatMinutes(t.actualMinutes)} tracked` : ""}
            {t.allocatedMinutes > 0 ? ` · about ${formatMinutes(t.remainingMinutes)} to go` : ""}
            {t.unallocatedCount > 0 ? ` · ${t.unallocatedCount} without a time` : ""}
          </p>
        )}
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <Group title="Overdue" hint="Past the due date and not finished." count={plan.overdue.length}>
        {plan.overdue.map((a) => (
          <Row key={a.id} a={a} today={today} now={now} tone="danger" canStart={!timerBusy} onStart={start} />
        ))}
      </Group>
      <Group title="Due today" count={plan.dueToday.length}>
        {plan.dueToday.map((a) => (
          <Row key={a.id} a={a} today={today} now={now} tone="warn" canStart={!timerBusy} onStart={start} />
        ))}
      </Group>
      <Group title="Planned for today" count={plan.plannedToday.length}>
        {plan.plannedToday.map((a) => (
          <Row key={a.id} a={a} today={today} now={now} tone="neutral" canStart={!timerBusy} onStart={start} />
        ))}
      </Group>
      <Group title="Coming up" hint="Due in the next two days and not planned yet. Add what you want to start on today." count={plan.comingUp.length}>
        {plan.comingUp.map((a) => (
          <Row
            key={a.id}
            a={a}
            today={today}
            now={now}
            tone="neutral"
            canStart={false}
            onStart={start}
            extra={
              <Button variant="secondary" className="min-h-10 px-3 text-sm" onClick={() => addToToday(a.id)}>
                Add to today
              </Button>
            }
          />
        ))}
      </Group>
    </Card>
  );
}
