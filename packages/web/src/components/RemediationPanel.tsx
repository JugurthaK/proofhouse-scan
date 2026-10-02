import type { ReactNode } from "react";
import type { RemediationRow } from "../api";
import { AlertIcon, CheckIcon, ExternalLinkIcon, PullRequestIcon, SpinnerIcon } from "./Icons";
import { PatchViewer } from "./PatchViewer";

const spinner = <SpinnerIcon size={16} className="animate-spin" />;

const STATUS: Record<RemediationRow["status"], { text: string; cls: string; icon: ReactNode }> = {
  generating: { text: "Generating a fix…", cls: "text-brand-700", icon: spinner },
  patch_ready: { text: "Patch ready — opening pull request…", cls: "text-brand-700", icon: spinner },
  branch_pushed: { text: "Branch pushed — opening pull request…", cls: "text-brand-700", icon: spinner },
  pr_opened: { text: "Pull request opened", cls: "text-good", icon: <CheckIcon size={16} /> },
  failed: { text: "Remediation failed", cls: "text-bad", icon: <AlertIcon size={16} /> },
};

export function RemediationPanel({ remediation }: { remediation: RemediationRow }) {
  const status = STATUS[remediation.status];
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`flex items-center gap-2 font-medium ${status.cls}`}>
          {status.icon}
          {status.text}
        </span>
        {remediation.model && <span className="ml-auto text-xs text-ink-4">{remediation.model}</span>}
      </div>

      {remediation.prUrl && (
        <a
          href={remediation.prUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-lg border border-line px-4 py-3 transition-colors hover:border-brand-300 hover:bg-brand-50/50"
        >
          <PullRequestIcon size={18} className="text-good" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink">
              Pull request{remediation.prNumber ? ` #${remediation.prNumber}` : ""}
            </span>
            <span className="block truncate text-xs text-ink-3">
              {remediation.branchName}
              {remediation.usedFork && ` · via fork ${remediation.forkFullName}`}
            </span>
          </span>
          <ExternalLinkIcon size={14} className="text-ink-3" />
        </a>
      )}

      {remediation.explanation && (
        <p className="leading-relaxed whitespace-pre-wrap text-ink-2">{remediation.explanation}</p>
      )}
      {remediation.error && <p className="text-xs text-bad">{remediation.error}</p>}
      {remediation.patchDiff && <PatchViewer diff={remediation.patchDiff} />}
    </div>
  );
}
