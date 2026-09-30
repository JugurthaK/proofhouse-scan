import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { ScanTimeline } from "../components/Charts";

const SCAN_STATUS_CLS: Record<string, string> = {
  completed: "text-good",
  failed: "text-sev-critical",
  running: "text-accent",
  dispatched: "text-ink-3",
};

export default function RepoDetail() {
  const { id } = useParams();
  const repoId = Number(id);
  const queryClient = useQueryClient();

  const { data: repo } = useQuery({
    queryKey: ["repo", repoId],
    queryFn: () => api.repo(repoId),
    refetchInterval: (query) =>
      query.state.data?.scans.some((s) => s.status === "running" || s.status === "dispatched")
        ? 5000
        : false,
  });
  const { data: timeline } = useQuery({
    queryKey: ["timeline", repoId],
    queryFn: () => api.timeline(repoId),
  });

  const rescan = useMutation({
    mutationFn: () => api.rescan(repo!.fullName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repo", repoId] }),
  });

  if (!repo) return <p className="py-10 text-center text-ink-3">Loading…</p>;

  const scanning = repo.scans.some(
    (s) => s.status === "running" || s.status === "dispatched",
  );

  return (
    <div className="space-y-4">
      <div>
        <Link to="/" className="text-sm text-ink-3 hover:text-ink">
          ← dashboard
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{repo.fullName}</h1>
          <p className="text-sm text-ink-3">
            {repo.openFindings} open finding(s)
            {repo.lastScannedAt &&
              ` · last scanned ${new Date(repo.lastScannedAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            to={`/findings?repo_id=${repo.id}`}
            className="rounded-md border border-line px-4 py-2 text-sm font-medium"
          >
            View findings
          </Link>
          <button
            onClick={() => rescan.mutate()}
            disabled={scanning || rescan.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {scanning ? "Scan in progress…" : "Rescan"}
          </button>
        </div>
      </div>
      {rescan.error && (
        <p className="text-sm text-sev-critical">{String(rescan.error)}</p>
      )}

      <div className="rounded-lg border border-line bg-surface-1 p-4">
        <h2 className="mb-2 text-sm font-medium text-ink-2">Findings over scans</h2>
        {timeline && <ScanTimeline data={timeline} />}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface-1">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-ink-3">
              <th className="px-4 py-2.5 font-medium">Scan</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Commit</th>
              <th className="px-4 py-2.5 font-medium">Started</th>
              <th className="px-4 py-2.5 font-medium">New</th>
              <th className="px-4 py-2.5 font-medium">Resolved</th>
              <th className="px-4 py-2.5 font-medium">Open</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {repo.scans.map((scan) => (
              <tr key={scan.id} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2.5">
                  #{scan.id}
                  <span
                    className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-3"
                    title={
                      scan.source === "action"
                        ? "Pushed by the proofhouse-scan GitHub Action"
                        : "Central workflow dispatch"
                    }
                  >
                    {scan.source}
                  </span>
                </td>
                <td className={`px-4 py-2.5 ${SCAN_STATUS_CLS[scan.status] ?? ""}`}>
                  {scan.status}
                  {scan.error && (
                    <span className="block max-w-md truncate text-xs text-ink-3" title={scan.error}>
                      {scan.error}
                    </span>
                  )}
                </td>
                <td className="mono px-4 py-2.5 text-xs text-ink-2">
                  {scan.commitSha?.slice(0, 8) ?? "—"}
                </td>
                <td className="px-4 py-2.5 text-xs text-ink-2">
                  {new Date(scan.startedAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">{scan.countsNew ?? "—"}</td>
                <td className="px-4 py-2.5">{scan.countsResolved ?? "—"}</td>
                <td className="px-4 py-2.5">{scan.countsOpen ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {scan.status === "completed" && (
                    <Link
                      to={`/findings?repo_id=${repo.id}&scan_id=${scan.id}`}
                      className="text-xs text-accent hover:underline"
                    >
                      view findings →
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
