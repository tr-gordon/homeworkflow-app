import { describeChange, fieldName } from "@/lib/domain/changes";
import type { AllocationChange } from "@/lib/domain/types";

function who(c: AllocationChange, viewerId: string): string {
  if (c.changedBy === viewerId) return "You";
  if (c.changedByName) return `${c.changedByName} (${c.changedByRole})`;
  if (c.changedByRole === "system") return "System";
  return `A ${c.changedByRole}`;
}

/** Newest first. Who changed the time or schedule, to what, and when (PRD T3). */
export function HistoryList({ items, viewerId }: { items: AllocationChange[]; viewerId: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">No changes yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((c) => (
        <li key={c.id} className="flex gap-3 text-sm">
          <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${c.changedByRole === "parent" ? "bg-warn" : "bg-brand"}`} />
          <div className={c.status === "superseded" ? "opacity-70" : ""}>
            <p>
              <strong>{who(c, viewerId)}</strong> {describeChange(c)}
            </p>
            {c.status === "superseded" ? (
              <p className="text-muted">Not applied: a newer change to the {fieldName(c.field)} had already been made.</p>
            ) : null}
            <p className="text-muted">
              <time dateTime={c.changedAt}>{new Date(c.changedAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
