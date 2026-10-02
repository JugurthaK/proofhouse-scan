import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Scan } from "../api";
import { BarList, repoTrend, severityRows, TrendChart } from "../components/Charts";
import {
  AlertIcon,
  BranchIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  ListIcon,
  LockIcon,
  RefreshIcon,
  SpinnerIcon,
} from "../components/Icons";
import {
  btn,
  Card,
  Crumbs,
  EmptyState,
  ErrorNote,
  PageHeader,
  RepoAvatar,
  Skeleton,
  StatTile,
  TimeAgo,
  usePageTitle,
} from "../components/ui";
import { duration, findingsLink, formatCount, github } from "../format";

const SCAN_STATUS: Record<Scan["status"], { label: string; cls: string; icon: ReactNode }> = {
  completed: { label: "Completed", cls: "bg-good-bg text-good", icon: <CheckIcon size={12} /> },
  failed: { label: "Failed", cls: "bg-bad-bg text-bad", icon: <AlertIcon size={12} /> },
  running: { label: "Running", cls: "bg-brand-50 text-brand-700", icon: <SpinnerIcon size={12} className="animate-spin" /> },
  dispatched: { label: "Dispatched", cls: "bg-surface-2 text-ink-2", icon: <ClockIcon size={12} /> },
};

const INITIAL_SCANS = 10;

function ScanStatus({ scan }: { scan: Scan }) {
  const s = SCAN_STATUS[scan.status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.icon}
      {s.label}
    </span>
  );
}

function ScanTable({ scans, repoId, fullName }: { scans: Scan[]; repoId: number; fullName: string }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? scans : scans.slice(0, INITIAL_SCANS);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-y border-line bg-surface-2/60 text-xs text-ink-3">
              <th className="py-2.5 pr-3 pl-5 font-medium">Scan</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Commit</th>
              <th className="px-3 py-2.5 font-medium">Started</th>
              <th className="px-3 py-2.5 font-medium">Duration</th>
              <th className="px-3 py-2.5 text-right font-medium">New</th>
              <th className="px-3 py-2.5 text-right font-medium">Resolved</th>
              <th className="px-3 py-2.5 text-right font-medium">Open</th>
              <th className="py-2.5 pr-5 pl-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((scan) => (
              <tr key={scan.id} className="hover:bg-surface-2/50">
                <td className="py-3 pr-3 pl-5 align-top">
                  <span className="font-medium text-ink tabular">#{scan.id}</span>
                  <span
                    className="ml-2 text-xs text-ink-3"
                    title={
                      scan.source === "action"
                        ? "Pushed by the proofhouse-scan GitHub Action"
                        : "Central workflow dispatch"
                    }
                  >
                    {scan.source === "action" ? "GitHub Action" : "Dispatch"}
                  </span>
                </td>
                <td className="px-3 py-3 align-top">
                  <ScanStatus scan={scan} />
                  {scan.error && (
                    <span className="mt-1 block max-w-xs truncate text-xs text-bad" title={scan.error}>
                      {scan.error}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 align-top">
                  {scan.commitSha ? (
                    <a
                      href={github.commit(fullName, scan.commitSha)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono text-xs text-ink-2 hover:text-brand-700 hover:underline"
                      title={scan.ref ? `${scan.ref} @ ${scan.commitSha}` : scan.commitSha}
                    >
                      {scan.commitSha.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top text-ink-2">
                  <TimeAgo iso={scan.startedAt} />
                </td>
                <td className="px-3 py-3 align-top text-ink-3 tabular">{duration(scan.startedAt, scan.finishedAt) ?? "—"}</td>
                <td className="px-3 py-3 text-right align-top tabular">
                  {scan.countsNew ? <span className="font-medium text-ink">+{scan.countsNew}</span> : <span className="text-ink-4">{scan.countsNew ?? "—"}</span>}
                </td>
                <td className="px-3 py-3 text-right align-top tabular">
                  {scan.countsResolved ? <span className="font-medium text-good">−{scan.countsResolved}</span> : <span className="text-ink-4">{scan.countsResolved ?? "—"}</span>}
                </td>
                <td className="px-3 py-3 text-right align-top text-ink-2 tabular">{scan.countsOpen ?? "—"}</td>
                <td className="py-3 pr-5 pl-3 text-right align-top">
                  {/* Everything that scan saw, including findings resolved since. */}
                  {scan.status === "completed" && (
                    <Link
                      to={findingsLink({ repo_id: String(repoId), scan_id: String(scan.id), status: "all" })}
                      className="text-xs font-medium whitespace-nowrap text-brand-600 hover:text-brand-700"
                    >
                      Findings →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scans.length > INITIAL_SCANS && (
        <div className="border-t border-line px-5 py-2.5">
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm text-brand-600 hover:text-brand-700">
            {showAll ? "Show fewer" : `Show all ${scans.length} scans`}
          </button>
        </div>
      )}
    </>
  );
}

export default function RepoDetail() {
  const { id } = useParams();
  const repoId = Number(id);
  const queryClient = useQueryClient();

  const { data: repo, error } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => api.repo(repoId),
    refetchInterval: (query) =>
      query.state.data?.scans.some((s) => s.status === "running" || s.status === "dispatched")
        ? 5000
        : false,
  });
  const { data: stats } = useQuery({
    queryKey: ["stats", repoId],
    queryFn: () => api.statsSummary(repoId),
  });
  const { data: timeline } = useQuery({
    queryKey: ["timeline", repoId],
    queryFn: () => api.timeline(repoId),
  });
  usePageTitle(repo?.fullName);

  const rescan = useMutation({
    mutationFn: () => api.rescan(repo!.fullName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repo", repoId] }),
  });

  const scanning = !!repo?.scans.some((s) => s.status === "running" || s.status === "dispatched");
  // When a scan finishes, counts everywhere (sidebar, charts, lists) are stale.
  const wasScanning = useRef(false);
  useEffect(() => {
    if (wasScanning.current && !scanning) {
      for (const key of ["repos", "stats", "timeline", "findings"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    }
    wasScanning.current = scanning;
  }, [scanning, queryClient]);

  if (error) return <ErrorNote error={error} />;
  if (!repo) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-12 w-80" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  const sev = (k: string) => stats?.bySeverity.find((s) => s.severity === k)?.count ?? 0;
  const open = stats?.bySeverity.reduce((sum, s) => sum + s.count, 0) ?? 0;
  const untriaged = stats?.byQualification.find((q) => q.qualification === "unqualified")?.count ?? 0;
  const v = (n: number) => (stats ? formatCount(n) : "–");
  const scope = { repo_id: String(repo.id) };

  return (
    <div className="space-y-6">
      <Crumbs items={[{ label: "Overview", to: "/" }, { label: repo.fullName }]} />

      <PageHeader
        leading={<RepoAvatar name={repo.name} size="lg" />}
        title={
          <span className="flex items-center gap-2">
            {repo.name}
            {repo.isPrivate && (
              <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-3">
                <LockIcon size={11} />
                Private
              </span>
            )}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{repo.owner}</span>
            {repo.defaultBranch && (
              <span className="inline-flex items-center gap-1">
                <BranchIcon size={13} />
                <span className="mono text-xs">{repo.defaultBranch}</span>
              </span>
            )}
            <span>
              Last scanned <TimeAgo iso={repo.lastScannedAt} />
            </span>
          </span>
        }
        actions={
          <>
            <a href={github.repo(repo.fullName)} target="_blank" rel="noreferrer" className={btn.ghost}>
              GitHub
              <ExternalLinkIcon size={14} />
            </a>
            <Link to={findingsLink(scope)} className={btn.secondary}>
              <ListIcon size={15} />
              View findings
            </Link>
            <button
              type="button"
              onClick={() => rescan.mutate()}
              disabled={scanning || rescan.isPending}
              className={btn.primary}
            >
              {scanning || rescan.isPending ? (
                <SpinnerIcon size={15} className="animate-spin" />
              ) : (
                <RefreshIcon size={15} />
              )}
              {scanning ? "Scanning…" : "Rescan"}
            </button>
          </>
        }
      />

      {scanning && (
        <div className="flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <SpinnerIcon size={16} className="animate-spin" />
          A scan is in progress. This page refreshes automatically when it finishes.
        </div>
      )}
      <ErrorNote error={rescan.error} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Open findings" value={v(open)} to={findingsLink(scope)} />
        <StatTile
          label="Critical"
          value={v(sev("critical"))}
          accent="var(--sev-critical)"
          to={findingsLink({ ...scope, severity: "critical" })}
        />
        <StatTile
          label="High"
          value={v(sev("high"))}
          accent="var(--sev-high)"
          to={findingsLink({ ...scope, severity: "high" })}
        />
        <StatTile
          label="Not triaged"
          value={v(untriaged)}
          accent="var(--brand-500)"
          to={findingsLink({ ...scope, qualification: "unqualified" })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Open findings over time" description="After each completed scan" className="lg:col-span-2">
          {timeline ? <TrendChart points={repoTrend(timeline)} /> : <Skeleton className="h-[220px]" />}
        </Card>
        <Card title="By severity" description="Open findings">
          {stats ? (
            <BarList rows={severityRows(stats.bySeverity, scope)} empty="No open findings." />
          ) : (
            <Skeleton className="h-40" />
          )}
        </Card>
      </div>

      <Card title="Scan history" description={`${repo.scans.length} scan${repo.scans.length === 1 ? "" : "s"}`} bodyClassName="pt-4">
        {repo.scans.length === 0 ? (
          <EmptyState icon={<RefreshIcon size={20} />} title="No scans yet">
            Run a scan to see results for this repository.
          </EmptyState>
        ) : (
          <ScanTable scans={repo.scans} repoId={repo.id} fullName={repo.fullName} />
        )}
      </Card>
    </div>
  );
}
