import type { FindingStatus, Qualification, Severity } from "../api";
import { humanize } from "../format";
import { SpinnerIcon } from "./Icons";

export const SEV_COLOR: Record<Severity, string> = {
  critical: "var(--sev-critical)",
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
  info: "var(--sev-info)",
};

const PILL = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={PILL}
      style={{ color: `var(--sev-${severity}-ink)`, background: `var(--sev-${severity}-bg)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: SEV_COLOR[severity] }} />
      {humanize(severity)}
    </span>
  );
}

const STATUS: Record<FindingStatus, string> = {
  new: "bg-brand-50 text-brand-700 ring-brand-100",
  open: "bg-surface-2 text-ink-2 ring-line",
  reopened: "bg-warn-bg text-warn ring-warn/15",
  resolved: "bg-good-bg text-good ring-good/15",
};

export function StatusBadge({ status }: { status: FindingStatus }) {
  return (
    <span className={`${PILL} ring-1 ring-inset ${STATUS[status]}`}>{humanize(status)}</span>
  );
}

const QUAL: Record<Exclude<Qualification, "unqualified" | "qualifying">, string> = {
  true_positive: "bg-bad-bg text-bad",
  false_positive: "bg-good-bg text-good",
  needs_review: "bg-warn-bg text-warn",
};

export function QualificationBadge({
  qualification,
  compact = false,
}: {
  qualification: Qualification;
  /** Tables render "not triaged" as a quiet dash. */
  compact?: boolean;
}) {
  if (qualification === "unqualified") {
    return compact ? (
      <span className="text-xs text-ink-4" title="Not triaged">
        —
      </span>
    ) : (
      <span className={`${PILL} bg-surface-2 text-ink-3`}>Not triaged</span>
    );
  }
  if (qualification === "qualifying") {
    return (
      <span className={`${PILL} bg-brand-50 text-brand-700`}>
        <SpinnerIcon size={12} className="animate-spin" />
        Triaging
      </span>
    );
  }
  return <span className={`${PILL} ${QUAL[qualification]}`}>{humanize(qualification)}</span>;
}
