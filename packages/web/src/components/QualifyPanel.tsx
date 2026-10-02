import type { QualificationRow } from "../api";
import { humanize } from "../format";
import { AlertIcon, SpinnerIcon } from "./Icons";

const VERDICT: Record<NonNullable<QualificationRow["verdict"]>, string> = {
  true_positive: "bg-bad-bg text-bad",
  false_positive: "bg-good-bg text-good",
  needs_review: "bg-warn-bg text-warn",
};

export function QualifyPanel({ qualification }: { qualification: QualificationRow }) {
  if (qualification.status === "running") {
    return (
      <p className="flex items-center gap-2.5 text-sm text-brand-700">
        <SpinnerIcon size={16} className="animate-spin" />
        Triage in progress — reading the code around this finding…
      </p>
    );
  }
  if (qualification.status === "failed") {
    return (
      <div className="flex items-start gap-2.5 text-sm text-bad">
        <AlertIcon size={16} className="mt-0.5" />
        <div>
          <p className="font-medium">Triage failed</p>
          {qualification.error && <p className="mt-0.5 text-xs text-ink-3">{qualification.error}</p>}
        </div>
      </div>
    );
  }

  const confidence = qualification.confidence;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {qualification.verdict && (
          <span className={`rounded-md px-2.5 py-1 text-sm font-semibold ${VERDICT[qualification.verdict]}`}>
            {humanize(qualification.verdict)}
          </span>
        )}
        {confidence !== null && (
          <span className="flex items-center gap-2 text-xs text-ink-3">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-brand-100">
              <span className="block h-full rounded-full bg-brand-600" style={{ width: `${confidence * 100}%` }} />
            </span>
            <span className="tabular">{Math.round(confidence * 100)}% confidence</span>
          </span>
        )}
        {qualification.model && <span className="ml-auto text-xs text-ink-4">{qualification.model}</span>}
      </div>

      {qualification.reasoning && (
        <p className="leading-relaxed whitespace-pre-wrap text-ink-2">{qualification.reasoning}</p>
      )}

      {qualification.exploitScenario && (
        <div className="rounded-lg border border-line bg-surface-2 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-ink uppercase">
            <AlertIcon size={14} className="text-sev-high" />
            Exploit scenario
          </p>
          <p className="mt-2 leading-relaxed whitespace-pre-wrap text-ink-2">{qualification.exploitScenario}</p>
        </div>
      )}
    </div>
  );
}
