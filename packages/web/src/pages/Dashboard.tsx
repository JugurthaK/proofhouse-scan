import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type RepoSummary, type StatsSummary, type TimelinePoint } from "../api";
import {
  BarList,
  portfolioTrend,
  repoTrend,
  severityCounts,
  severityRows,
  SeverityStack,
  Sparkline,
  TrendChart,
} from "../components/Charts";
import { ChevronRightIcon, ShieldCheckIcon } from "../components/Icons";
import {
  Card,
  EmptyState,
  ErrorNote,
  PageHeader,
  RepoAvatar,
  RepoLabel,
  Skeleton,
  StatTile,
  TimeAgo,
  usePageTitle,
} from "../components/ui";
import { byRisk, CATEGORY_LABEL, findingsLink, formatCount, plural } from "../format";

const TRIAGE_ORDER = ["unqualified", "needs_review", "true_positive", "false_positive"] as const;
const TRIAGE_LABEL: Record<(typeof TRIAGE_ORDER)[number], string> = {
  unqualified: "Not triaged",
  needs_review: "Needs review",
  true_positive: "True positive",
  false_positive: "False positive",
};

function count<K extends string>(
  rows: ({ count: number } & Record<K, string>)[] | undefined,
  key: K,
  value: string,
) {
  return rows?.find((r) => r[key] === value)?.count ?? 0;
}

function RepoTable({
  repos,
  statsByRepo,
  timeline,
}: {
  repos: RepoSummary[];
  statsByRepo: Map<number, StatsSummary | undefined>;
  timeline: TimelinePoint[] | undefined;
}) {
  const navigate = useNavigate();
  const sorted = [...repos].sort(byRisk);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-y border-line bg-surface-2/60 text-xs text-ink-3">
            <th className="py-2.5 pr-3 pl-5 font-medium">Repository</th>
            <th className="w-[26%] px-3 py-2.5 font-medium">Severity mix</th>
            <th className="px-3 py-2.5 text-right font-medium">Open</th>
            <th className="px-3 py-2.5 text-right font-medium">Critical + high</th>
            <th className="px-3 py-2.5 font-medium">Trend</th>
            <th className="px-3 py-2.5 font-medium">Last scan</th>
            <th className="w-10 py-2.5 pr-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((repo) => {
            const stats = statsByRepo.get(repo.id);
            const trend = repoTrend((timeline ?? []).filter((p) => p.repoId === repo.id)).map((p) => p.open);
            return (
              <tr
                key={repo.id}
                onClick={() => navigate(`/repos/${repo.id}`)}
                className="group cursor-pointer transition-colors hover:bg-brand-50/40"
              >
                <td className="py-3 pr-3 pl-5">
                  <Link to={`/repos/${repo.id}`} className="flex min-w-0 items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <RepoAvatar name={repo.name} />
                    <RepoLabel owner={repo.owner} name={repo.name} isPrivate={repo.isPrivate} />
                  </Link>
                </td>
                <td className="px-3 py-3">
                  {stats ? <SeverityStack counts={severityCounts(stats.bySeverity)} /> : <Skeleton className="h-2" />}
                </td>
                <td className="px-3 py-3 text-right font-medium text-ink tabular">{formatCount(repo.openFindings)}</td>
                <td className="px-3 py-3 text-right tabular">
                  {repo.criticalOrHigh > 0 ? (
                    <Link
                      to={findingsLink({ repo_id: String(repo.id), severity: "critical,high" })}
                      onClick={(e) => e.stopPropagation()}
                      title="Show these findings"
                      className="font-medium text-sev-critical hover:underline"
                    >
                      {formatCount(repo.criticalOrHigh)}
                    </Link>
                  ) : (
                    <span className="text-ink-4">0</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <Sparkline values={trend} />
                </td>
                <td className="px-3 py-3 text-ink-3">
                  <TimeAgo iso={repo.lastScannedAt} />
                </td>
                <td className="py-3 pr-4 text-ink-4 group-hover:text-brand-600">
                  <ChevronRightIcon />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  usePageTitle("Overview");
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.statsSummary() });
  const timeline = useQuery({ queryKey: ["timeline"], queryFn: () => api.timeline() });
  const repos = useQuery({ queryKey: ["repos"], queryFn: () => api.repos() });

  const perRepo = useQueries({
    queries: (repos.data ?? []).map((r) => ({
      queryKey: ["stats", r.id],
      queryFn: () => api.statsSummary(r.id),
    })),
  });
  const statsByRepo = new Map((repos.data ?? []).map((r, i) => [r.id, perRepo[i]?.data]));

  const s = stats.data;
  const total = s?.bySeverity.reduce((sum, x) => sum + x.count, 0) ?? 0;
  const critical = count(s?.bySeverity, "severity", "critical");
  const high = count(s?.bySeverity, "severity", "high");
  const untriaged = count(s?.byQualification, "qualification", "unqualified");
  const confirmed = count(s?.byQualification, "qualification", "true_positive");
  const repoCount = repos.data?.length ?? 0;
  const lastScan = repos.data
    ?.map((r) => r.lastScannedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  if (repos.data && repos.data.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" />
        <Card>
          <EmptyState icon={<ShieldCheckIcon size={22} />} title="No repositories scanned yet">
            Dispatch your first scan from the CLI with{" "}
            <code className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[13px] text-ink">
              proofhouse-scan scan owner/repo
            </code>
            , or add the GitHub Action to a repository to push results here.
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={
          repos.data ? (
            <>
              Open findings across {plural(repoCount, "repository", "repositories")}
              {lastScan && (
                <>
                  {" "}
                  · last scan <TimeAgo iso={lastScan} />
                </>
              )}
            </>
          ) : (
            <Skeleton className="h-4 w-64" />
          )
        }
        actions={
          <Link to="/findings" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Browse all findings →
          </Link>
        }
      />

      <ErrorNote error={stats.error ?? repos.error} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Open findings"
          value={s ? formatCount(total) : "–"}
          hint={`across ${plural(repoCount, "repo")}`}
          to={findingsLink()}
        />
        <StatTile
          label="Critical"
          value={s ? formatCount(critical) : "–"}
          accent="var(--sev-critical)"
          hint="Fix first"
          to={findingsLink({ severity: "critical" })}
        />
        <StatTile
          label="High"
          value={s ? formatCount(high) : "–"}
          accent="var(--sev-high)"
          hint="Fix next"
          to={findingsLink({ severity: "high" })}
        />
        <StatTile
          label="Not triaged"
          to={findingsLink({ qualification: "unqualified" })}
          value={s ? formatCount(untriaged) : "–"}
          accent="var(--brand-500)"
          hint={s ? `${formatCount(confirmed)} confirmed true positive${confirmed === 1 ? "" : "s"}` : undefined}
        />
      </div>

      <Card
        title="Repositories"
        description="Sorted by critical and high findings — the ones that need attention come first."
        bodyClassName="pt-4"
      >
        {repos.data ? (
          <RepoTable repos={repos.data} statsByRepo={statsByRepo} timeline={timeline.data} />
        ) : (
          <div className="space-y-3 px-5 pb-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Open findings over time"
          description="Total across repositories, after each completed scan"
          className="lg:col-span-2"
        >
          {timeline.data && repos.data ? (
            <TrendChart points={portfolioTrend(timeline.data, repos.data)} />
          ) : (
            <Skeleton className="h-[220px]" />
          )}
        </Card>
        <Card title="By severity" description="Open findings">
          {s ? <BarList rows={severityRows(s.bySeverity)} empty="No open findings." /> : <Skeleton className="h-40" />}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="By scanner">
          {s ? (
            <BarList
              rows={["opengrep", "trivy", "gitleaks"].map((k) => ({
                key: k,
                label: k,
                value: count(s.byScanner, "scanner", k),
                to: findingsLink({ scanner: k }),
              }))}
            />
          ) : (
            <Skeleton className="h-24" />
          )}
        </Card>
        <Card title="By category">
          {s ? (
            <BarList
              rows={(["sast", "sca", "iac", "secret"] as const).map((k) => ({
                key: k,
                label: CATEGORY_LABEL[k],
                value: count(s.byCategory, "category", k),
                to: findingsLink({ category: k }),
              }))}
            />
          ) : (
            <Skeleton className="h-24" />
          )}
        </Card>
        <Card title="Triage">
          {s ? (
            <BarList
              rows={TRIAGE_ORDER.map((k) => ({
                key: k,
                label: TRIAGE_LABEL[k],
                value: count(s.byQualification, "qualification", k),
                to: findingsLink({ qualification: k }),
              }))}
            />
          ) : (
            <Skeleton className="h-24" />
          )}
        </Card>
      </div>
    </div>
  );
}
