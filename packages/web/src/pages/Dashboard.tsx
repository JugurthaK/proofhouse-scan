import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ScannerChart, ScanTimeline, SeverityChart } from "../components/Charts";

function StatTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4">
      <h2 className="mb-2 text-sm font-medium text-ink-2">{title}</h2>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => api.statsSummary() });
  const { data: timeline } = useQuery({ queryKey: ["timeline"], queryFn: () => api.timeline() });
  const { data: repos } = useQuery({ queryKey: ["repos"], queryFn: () => api.repos() });

  const total = stats?.bySeverity.reduce((sum, s) => sum + s.count, 0) ?? 0;
  const critical = stats?.bySeverity.find((s) => s.severity === "critical")?.count ?? 0;
  const high = stats?.bySeverity.find((s) => s.severity === "high")?.count ?? 0;
  const truePositives =
    stats?.byQualification.find((q) => q.qualification === "true_positive")?.count ?? 0;

  if (repos && repos.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface-1 p-10 text-center">
        <p className="text-lg font-medium">No repositories scanned yet</p>
        <p className="mt-2 text-sm text-ink-3">
          Run <code className="rounded bg-surface-2 px-1.5 py-0.5">proofhouse-scan scan owner/repo</code>{" "}
          to dispatch your first scan.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Open findings" value={total} />
        <StatTile label="Critical" value={critical} tone="text-sev-critical" />
        <StatTile label="High" value={high} tone="text-sev-high" />
        <StatTile label="Confirmed true positives" value={truePositives} tone="text-sev-critical" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Open findings by severity">
          {stats && <SeverityChart data={stats.bySeverity} />}
        </Card>
        <Card title="Open findings by scanner">
          {stats && <ScannerChart data={stats.byScanner} />}
        </Card>
      </div>

      <Card title="Findings over scans">
        {timeline && <ScanTimeline data={timeline} />}
      </Card>

      <Card title="Repositories">
        <div className="divide-y divide-[var(--border)]">
          {repos?.map((repo) => (
            <Link
              key={repo.id}
              to={`/repos/${repo.id}`}
              className="flex items-center justify-between py-2.5 hover:bg-surface-2"
            >
              <div>
                <span className="text-sm font-medium">{repo.fullName}</span>
                {repo.isPrivate && (
                  <span className="ml-2 rounded bg-surface-2 px-1.5 text-xs text-ink-3">
                    private
                  </span>
                )}
                <p className="text-xs text-ink-3">
                  {repo.lastScannedAt
                    ? `last scanned ${new Date(repo.lastScannedAt).toLocaleString()}`
                    : "never scanned"}
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm">
                {repo.criticalOrHigh > 0 && (
                  <span className="text-sev-critical">{repo.criticalOrHigh} crit/high</span>
                )}
                <span className="text-ink-2">{repo.openFindings} open</span>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
