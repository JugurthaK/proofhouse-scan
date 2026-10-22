import type { ReactNode } from "react";
import type { RemediationRow, RepoSummary } from "../api";
import { AlertIcon, CheckIcon, ExternalLinkIcon, PullRequestIcon, SpinnerIcon } from "./Icons";
import { PatchViewer } from "./PatchViewer";

const spinner = <SpinnerIcon size={16} className="animate-spin" />;

// GitLab calls them merge requests and references them as !42, not #42.
const CHANGE_REQUEST = {
  github: { noun: "pull request", title: "Pull request", ref: "#" },
  gitlab: { noun: "merge request", title: "Merge request", ref: "!" },
} as const;
type ChangeRequest = (typeof CHANGE_REQUEST)[keyof typeof CHANGE_REQUEST];

function statusFor(
  status: RemediationRow["status"],
  cr: ChangeRequest,
): { text: string; cls: string; icon: ReactNode } {
  switch (status) {
    case "generating":
      return { text: "Generating a fix…", cls: "text-brand-700", icon: spinner };
    case "patch_ready":
      return { text: `Patch ready — opening ${cr.noun}…`, cls: "text-brand-700", icon: spinner };
    case "branch_pushed":
      return { text: `Branch pushed — opening ${cr.noun}…`, cls: "text-brand-700", icon: spinner };
    case "pr_opened":
      return { text: `${cr.title} opened`, cls: "text-good", icon: <CheckIcon size={16} /> };
    case "failed":
      return { text: "Remediation failed", cls: "text-bad", icon: <AlertIcon size={16} /> };
  }
}

export function RemediationPanel({
  remediation,
  provider,
}: {
  remediation: RemediationRow;
  provider: RepoSummary["provider"];
}) {
  const changeRequest = CHANGE_REQUEST[provider];
  const status = statusFor(remediation.status, changeRequest);
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
              {changeRequest.title}
              {remediation.prNumber ? ` ${changeRequest.ref}${remediation.prNumber}` : ""}
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
