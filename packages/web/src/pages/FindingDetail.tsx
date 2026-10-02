import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, type FindingDetail } from "../api";
import { QualificationBadge, SeverityBadge, StatusBadge } from "../components/Badges";
import { FilePath } from "../components/FindingsTable";
import { ExternalLinkIcon, PullRequestIcon, SparklesIcon, SpinnerIcon } from "../components/Icons";
import { QualifyPanel } from "../components/QualifyPanel";
import { RemediationPanel } from "../components/RemediationPanel";
import { btn, Card, Crumbs, ErrorNote, RepoAvatar, Skeleton, TimeAgo, usePageTitle } from "../components/ui";
import { CATEGORY_LABEL, github } from "../format";

const REMEDIATION_BUSY = ["generating", "patch_ready", "branch_pushed"];

function isBusy(f: FindingDetail): boolean {
  return (
    f.qualification === "qualifying" ||
    f.qualifications.some((q) => q.status === "running") ||
    f.remediations.some((r) => REMEDIATION_BUSY.includes(r.status))
  );
}

function CodeBlock({ code, startLine, endLine }: { code: string; startLine: number | null; endLine: number | null }) {
  const lines = code.replace(/\n$/, "").split("\n");
  // Number lines only when the snippet clearly maps onto the reported range.
  const numbered =
    startLine != null && lines.length === (endLine ?? startLine) - startLine + 1;
  return (
    <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 py-3 text-[12.5px] leading-6">
      <code className="block min-w-max">
        {lines.map((line, i) => (
          <span key={i} className="flex">
            {numbered && (
              <span className="w-12 shrink-0 pr-4 text-right text-ink-4 select-none">{startLine! + i}</span>
            )}
            <span className={`text-ink ${numbered ? "pr-4" : "px-4"}`}>{line || " "}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

function RawSarif({ raw }: { raw: string }) {
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Show it as stored.
  }
  return (
    <details className="group rounded-xl border border-line bg-surface-1 shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-ink select-none">
        Raw SARIF result
        <span className="text-xs font-normal text-ink-3 group-open:hidden">Show</span>
        <span className="hidden text-xs font-normal text-ink-3 group-open:inline">Hide</span>
      </summary>
      <pre className="mx-5 mb-5 max-h-[28rem] overflow-auto rounded-lg bg-surface-2 p-4 text-xs leading-5 text-ink-2">
        {pretty}
      </pre>
    </details>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-ink">{children}</dd>
    </div>
  );
}

export default function FindingDetailPage() {
  const { id } = useParams();
  const findingId = Number(id);
  const queryClient = useQueryClient();
  const location = useLocation();
  const backTo = (location.state as { from?: string } | null)?.from ?? "/findings";

  const { data: finding, error } = useQuery({
    queryKey: ["finding", findingId],
    queryFn: () => api.finding(findingId),
    // Poll while an LLM action is running so verdicts/PRs appear live.
    refetchInterval: (query) => (query.state.data && isBusy(query.state.data) ? 2000 : false),
  });
  usePageTitle(finding ? `#${finding.id} ${finding.ruleId}` : "Finding");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["finding", findingId] });
  const qualify = useMutation({ mutationFn: () => api.qualify(findingId), onSuccess: invalidate });
  const remediate = useMutation({ mutationFn: () => api.remediate(findingId), onSuccess: invalidate });

  const busy = !!finding && isBusy(finding);
  // Triage verdicts feed the lists and stats — refresh them once work settles.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      void queryClient.invalidateQueries({ queryKey: ["findings"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
    }
    wasBusy.current = busy;
  }, [busy, queryClient]);

  if (error) return <ErrorNote error={error} />;
  if (!finding) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-16 w-full max-w-2xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const latestQual = finding.qualifications[0];
  const latestRemed = finding.remediations[0];
  const isTruePositive = finding.qualification === "true_positive";
  const canRemediate = isTruePositive && !busy;
  const repo = finding.repo;
  const fileUrl = repo
    ? github.file(repo.fullName, repo.defaultBranch ?? "HEAD", finding.filePath, finding.startLine, finding.endLine)
    : null;

  return (
    <div className="space-y-6">
      <Crumbs
        items={[
          { label: "Findings", to: backTo },
          ...(repo ? [{ label: repo.fullName, to: `/repos/${repo.id}` }] : []),
          { label: `#${finding.id}` },
        ]}
      />

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          <StatusBadge status={finding.status} />
          <QualificationBadge qualification={finding.qualification} />
        </div>
        <h1 className="mono mt-3 text-lg font-semibold break-all text-ink">{finding.ruleId}</h1>
        <p className="mt-1 text-sm text-ink-3">
          {finding.scanner} · {CATEGORY_LABEL[finding.category]} · updated <TimeAgo iso={finding.updatedAt} />
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="Description">
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-2">{finding.message}</p>

            <div className="mt-5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <FilePath path={finding.filePath} line={finding.startLine} />
              </div>
              {fileUrl && (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  View on GitHub
                  <ExternalLinkIcon size={12} />
                </a>
              )}
            </div>
            {finding.snippet && (
              <div className="mt-2">
                <CodeBlock code={finding.snippet} startLine={finding.startLine} endLine={finding.endLine} />
              </div>
            )}
          </Card>

          <Card
            title="LLM triage"
            description="Reads the surrounding code and decides whether this is a real, exploitable issue."
          >
            {latestQual ? (
              <QualifyPanel qualification={latestQual} />
            ) : (
              <p className="text-sm text-ink-3">
                Not triaged yet. Run triage to get a verdict, confidence score and exploit scenario.
              </p>
            )}
          </Card>

          {latestRemed && (
            <Card title="Remediation">
              <RemediationPanel remediation={latestRemed} />
            </Card>
          )}

          {finding.rawSarif && <RawSarif raw={finding.rawSarif} />}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-8">
          <Card title="Actions">
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => qualify.mutate()}
                disabled={busy || qualify.isPending}
                className={`${btn.primary} w-full`}
              >
                {finding.qualification === "qualifying" || latestQual?.status === "running" ? (
                  <SpinnerIcon size={15} className="animate-spin" />
                ) : (
                  <SparklesIcon size={15} />
                )}
                {finding.qualifications.length > 0 ? "Re-run triage" : "Run LLM triage"}
              </button>
              <button
                type="button"
                onClick={() => remediate.mutate()}
                disabled={!canRemediate || remediate.isPending}
                className={`${btn.secondary} w-full`}
              >
                {latestRemed && REMEDIATION_BUSY.includes(latestRemed.status) ? (
                  <SpinnerIcon size={15} className="animate-spin" />
                ) : (
                  <PullRequestIcon size={15} />
                )}
                Create fix PR
              </button>
              {!isTruePositive && (
                <p className="text-xs text-ink-3">Fix PRs are available once triage confirms a true positive.</p>
              )}
            </div>
            {(qualify.error || remediate.error) && (
              <div className="mt-3">
                <ErrorNote error={qualify.error ?? remediate.error} />
              </div>
            )}
          </Card>

          <Card title="Details" bodyClassName="px-5 pt-1 pb-3">
            <dl className="divide-y divide-line">
              {repo && (
                <Property label="Repository">
                  <Link to={`/repos/${repo.id}`} className="inline-flex items-center gap-2 hover:text-brand-700">
                    <RepoAvatar name={repo.name} size="sm" />
                    <span className="truncate">{repo.fullName}</span>
                  </Link>
                </Property>
              )}
              <Property label="Scanner">{finding.scanner}</Property>
              <Property label="Category">{CATEGORY_LABEL[finding.category]}</Property>
              <Property label="Lines">
                <span className="tabular">
                  {finding.startLine
                    ? finding.endLine && finding.endLine !== finding.startLine
                      ? `${finding.startLine}–${finding.endLine}`
                      : finding.startLine
                    : "—"}
                </span>
              </Property>
              <Property label="Finding ID">
                <span className="tabular">#{finding.id}</span>
              </Property>
              <Property label="Fingerprint">
                <span className="mono block truncate text-xs text-ink-2" title={finding.fingerprint}>
                  {finding.fingerprint.slice(0, 12)}
                </span>
              </Property>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}
