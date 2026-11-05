import { formatMinutes } from "@/lib/domain/timer";

/**
 * Planned vs actual time (PRD V1). The bar compares MINUTES (tracked / planned)
 * and is labelled as such; it is not a progress indicator for the assignment.
 */
export function TimeSummary({ allocatedMinutes, actualSeconds, compact = false }: { allocatedMinutes: number | null; actualSeconds: number; compact?: boolean }) {
  const actualMin = actualSeconds / 60;
  const planned = allocatedMinutes;
  const over = planned !== null && actualMin > planned ? Math.round(actualMin - planned) : 0;
  const ratio = planned && planned > 0 ? Math.min(1, actualMin / planned) : 0;

  return (
    <div className="space-y-1.5">
      <p className={`flex flex-wrap items-baseline gap-x-3 ${compact ? "text-sm" : "text-base"}`}>
        <span>
          <span className="text-muted">Planned </span>
          <strong>{planned === null ? "not set" : formatMinutes(planned)}</strong>
        </span>
        <span>
          <span className="text-muted">Tracked </span>
          <strong>{formatMinutes(actualMin)}</strong>
        </span>
        {over > 0 ? <span className="font-semibold text-warn">{formatMinutes(over)} over</span> : null}
      </p>
      {planned !== null ? (
        <div
          role="img"
          aria-label={`Time tracked compared with planned time: ${formatMinutes(actualMin)} of ${formatMinutes(planned)}`}
          className="h-2 overflow-hidden rounded-full bg-surface-2"
        >
          <div className={`h-full rounded-full ${over > 0 ? "bg-warn" : "bg-brand"}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}
