import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { SEV_COLOR } from "../components/Badges";
import { FindingsTable } from "../components/FindingsTable";
import { ChevronLeftIcon, ChevronRightIcon, ListIcon, XIcon } from "../components/Icons";
import { btn, Card, EmptyState, ErrorNote, PageHeader, RepoAvatar, Skeleton, usePageTitle } from "../components/ui";
import { byName, CATEGORY_LABEL, formatCount, humanize, plural, SEVERITIES } from "../format";

const PAGE_SIZE = 50;

const SELECTS: { key: string; any: string; options: { value: string; label: string }[] }[] = [
  {
    key: "status",
    any: "Any status",
    options: ["new", "open", "reopened", "resolved"].map((v) => ({ value: v, label: humanize(v) })),
  },
  {
    key: "qualification",
    any: "Any triage",
    options: [
      { value: "unqualified", label: "Not triaged" },
      { value: "needs_review", label: "Needs review" },
      { value: "true_positive", label: "True positive" },
      { value: "false_positive", label: "False positive" },
    ],
  },
  {
    key: "scanner",
    any: "Any scanner",
    options: ["opengrep", "trivy", "gitleaks"].map((v) => ({ value: v, label: v })),
  },
  {
    key: "category",
    any: "Any category",
    options: (["sast", "sca", "iac", "secret"] as const).map((v) => ({ value: v, label: CATEGORY_LABEL[v] })),
  },
];

const FILTER_KEYS = ["severity", ...SELECTS.map((s) => s.key)];

function RepoTabs({
  current,
  onSelect,
}: {
  current: string | null;
  onSelect: (repoId: string | null) => void;
}) {
  const { data: repos } = useQuery({ queryKey: ["repos"], queryFn: () => api.repos() });
  const tab = (active: boolean) =>
    `relative flex h-10 shrink-0 items-center gap-2 px-1 text-sm transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full ${
      active ? "font-medium text-ink after:bg-brand-600" : "text-ink-3 hover:text-ink after:bg-transparent"
    }`;
  const sorted = [...(repos ?? [])].sort(byName);
  const total = sorted.reduce((s, r) => s + r.openFindings, 0);

  return (
    <div className="scrollbar-none -mx-1 flex gap-6 overflow-x-auto border-b border-line px-1" role="tablist">
      <button type="button" role="tab" aria-selected={!current} onClick={() => onSelect(null)} className={tab(!current)}>
        All repositories
        {repos && <span className="text-xs text-ink-4 tabular">{formatCount(total)}</span>}
      </button>
      {sorted.map((r) => {
        const active = current === String(r.id);
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${r.fullName} — ${r.openFindings} open`}
            onClick={() => onSelect(String(r.id))}
            className={tab(active)}
          >
            <RepoAvatar name={r.name} size="sm" />
            {r.name}
            <span className="flex items-center gap-1 text-xs text-ink-4 tabular">
              {r.criticalOrHigh > 0 && <span className="h-1.5 w-1.5 rounded-full bg-sev-critical" />}
              {formatCount(r.openFindings)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function Findings() {
  usePageTitle("Findings");
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const repoId = params.get("repo_id");
  const scanId = params.get("scan_id");

  const queryParams: Record<string, string> = { page: String(page), page_size: String(PAGE_SIZE) };
  for (const key of [...FILTER_KEYS, "repo_id", "scan_id"]) {
    const v = params.get(key);
    if (v) queryParams[key] = v;
  }

  const { data, isLoading, isFetching, isPlaceholderData, error } = useQuery({
    queryKey: ["findings", queryParams],
    queryFn: () => api.findings(queryParams),
    placeholderData: keepPreviousData,
  });

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next);
  };

  const activeFilters = FILTER_KEYS.filter((k) => params.get(k));
  const severity = params.get("severity");
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = data ? Math.min(page * PAGE_SIZE, data.total) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Findings"
        subtitle={data ? plural(data.total, "finding") + (activeFilters.length ? " match your filters" : "") : <Skeleton className="h-4 w-40" />}
      />

      {/* A scan belongs to one repo — switching repo clears the scan filter. */}
      <RepoTabs current={repoId} onSelect={(id) => update({ repo_id: id, scan_id: null })} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Severity">
          {SEVERITIES.map((s) => {
            const active = severity === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => update({ severity: active ? null : s })}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors ${
                  active
                    ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                    : "border-line bg-surface-1 text-ink-2 hover:border-line-strong hover:text-ink"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR[s] }} />
                {humanize(s)}
              </button>
            );
          })}
        </div>

        <span className="mx-1 hidden h-5 w-px bg-line sm:block" />

        {SELECTS.map((f) => {
          const value = params.get(f.key) ?? "";
          return (
            <select
              key={f.key}
              aria-label={f.any.replace("Any ", "")}
              value={value}
              onChange={(e) => update({ [f.key]: e.target.value || null })}
              className={`select h-8 rounded-lg border pl-2.5 text-sm transition-colors ${
                value
                  ? "border-brand-300 bg-brand-50 font-medium text-brand-700"
                  : "border-line bg-surface-1 text-ink-2 hover:border-line-strong"
              }`}
            >
              <option value="">{f.any}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        })}

        {scanId && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 pr-1.5 pl-2.5 text-sm font-medium text-brand-700">
            Scan #{scanId}
            <button
              type="button"
              onClick={() => update({ scan_id: null })}
              className="rounded p-0.5 hover:bg-brand-100"
              aria-label="Clear scan filter"
            >
              <XIcon size={14} />
            </button>
          </span>
        )}

        {activeFilters.length > 0 && (
          <button
            type="button"
            onClick={() => update(Object.fromEntries(activeFilters.map((k) => [k, null])))}
            className="ml-1 text-sm text-ink-3 hover:text-ink"
          >
            Clear filters
          </button>
        )}
      </div>

      <ErrorNote error={error} />

      <Card bodyClassName="">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : data && data.findings.length === 0 ? (
          <EmptyState
            icon={<ListIcon size={20} />}
            title={activeFilters.length || scanId ? "No findings match these filters" : "No findings yet"}
            action={
              activeFilters.length > 0 ? (
                <button
                  type="button"
                  className={btn.secondary}
                  onClick={() => update(Object.fromEntries(activeFilters.map((k) => [k, null])))}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          >
            {activeFilters.length || scanId
              ? "Try widening the severity, status or triage filters."
              : "Findings show up here once a scan completes."}
          </EmptyState>
        ) : (
          data && (
            <div className={`transition-opacity ${isFetching && isPlaceholderData ? "opacity-60" : ""}`}>
              <FindingsTable findings={data.findings} showRepo={!repoId} />
            </div>
          )
        )}

        {data && data.total > 0 && (
          <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm text-ink-3">
            <span className="tabular">
              {formatCount(from)}–{formatCount(to)} of {formatCount(data.total)}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <span className="mr-1 tabular">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => update({ page: String(page - 1) })}
                  className={`${btn.secondary} h-8 w-8 px-0`}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => update({ page: String(page + 1) })}
                  className={`${btn.secondary} h-8 w-8 px-0`}
                  aria-label="Next page"
                >
                  <ChevronRightIcon />
                </button>
              </div>
            )}
          </footer>
        )}
      </Card>
    </div>
  );
}
