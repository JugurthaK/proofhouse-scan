import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import type { RepoSummary, Severity, StatsSummary, TimelinePoint } from "../api";
import { absoluteTime, formatCount, humanize, SEVERITIES, shortDate } from "../format";
import { SEV_COLOR } from "./Badges";

const AXIS = { fill: "var(--text-muted)", fontSize: 11 };

export interface TrendPoint {
  t: number;
  open: number;
  new?: number | null;
  resolved?: number | null;
  /** Which scan produced this point, e.g. "acme/api · scan #12". */
  label?: string;
}

function chronological(timeline: TimelinePoint[]) {
  return timeline
    .filter((p) => p.finishedAt)
    .map((p) => ({ ...p, t: new Date(p.finishedAt!).getTime() }))
    .sort((a, b) => a.t - b.t);
}

/** One repo's completed scans as an open-findings series. */
export function repoTrend(timeline: TimelinePoint[]): TrendPoint[] {
  return chronological(timeline).map((p) => ({
    t: p.t,
    open: p.countsOpen ?? 0,
    new: p.countsNew,
    resolved: p.countsResolved,
    label: `Scan #${p.scanId}`,
  }));
}

/**
 * Total open findings across repos over time. Each scan reports its repo's
 * open count, so the total at any moment is the sum of every repo's most
 * recent count — carried forward until that repo scans again.
 */
export function portfolioTrend(timeline: TimelinePoint[], repos: RepoSummary[]): TrendPoint[] {
  const names = new Map(repos.map((r) => [r.id, r.fullName]));
  const latest = new Map<number, number>();
  return chronological(timeline).map((p) => {
    latest.set(p.repoId, p.countsOpen ?? 0);
    let total = 0;
    for (const v of latest.values()) total += v;
    return { t: p.t, open: total, label: `${names.get(p.repoId) ?? "repo"} · scan #${p.scanId}` };
  });
}

function TrendTooltip({ active, payload }: TooltipProps<number, string>) {
  const p = payload?.[0]?.payload as TrendPoint | undefined;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs shadow-pop">
      <p className="text-ink-3">{absoluteTime(new Date(p.t).toISOString())}</p>
      <p className="mt-1 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-brand-600" />
        <span className="text-ink-2">Open</span>
        <span className="ml-auto pl-4 font-semibold text-ink tabular">{formatCount(p.open)}</span>
      </p>
      {(p.new != null || p.resolved != null) && (
        <p className="mt-0.5 text-ink-3 tabular">
          +{p.new ?? 0} new · −{p.resolved ?? 0} resolved
        </p>
      )}
      {p.label && <p className="mt-1 text-ink-4">{p.label}</p>}
    </div>
  );
}

export function TrendChart({ points, height = 220 }: { points: TrendPoint[]; height?: number }) {
  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-ink-3" style={{ height }}>
        No completed scans yet.
      </div>
    );
  }
  const single = points.length === 1;
  const DAY = 86_400_000;
  const domain: [number, number] | [string, string] = single
    ? [points[0]!.t - DAY, points[0]!.t + DAY]
    : ["dataMin", "dataMax"];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--gridline)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={domain}
          tickFormatter={shortDate}
          tick={AXIS}
          axisLine={{ stroke: "var(--baseline)" }}
          tickLine={false}
          minTickGap={40}
          tickMargin={8}
        />
        <YAxis
          tick={AXIS}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={40}
          tickFormatter={formatCount}
        />
        <Tooltip
          content={<TrendTooltip />}
          cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
          isAnimationActive={false}
        />
        <Area
          type="linear"
          dataKey="open"
          stroke="var(--brand-600)"
          strokeWidth={2}
          fill="var(--brand-500)"
          fillOpacity={0.1}
          dot={
            single ? { r: 4, fill: "var(--brand-600)", stroke: "var(--surface-1)", strokeWidth: 2 } : false
          }
          activeDot={{ r: 4.5, fill: "var(--brand-600)", stroke: "var(--surface-1)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  color?: string;
}

/** Direct-labeled horizontal bars — every value is visible, no hover needed. */
export function BarList({ rows, empty = "Nothing to show." }: { rows: BarRow[]; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) return <p className="py-6 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const pct = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <li
            key={r.key}
            className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm"
            title={`${r.label}: ${formatCount(r.value)} (${pct}%)`}
          >
            <span className="flex min-w-0 items-center gap-2 text-ink-2">
              {r.color && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
              )}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${max ? (r.value / max) * 100 : 0}%`,
                  minWidth: r.value > 0 ? 4 : 0,
                  background: r.color ?? "var(--brand-500)",
                }}
              />
            </span>
            <span className="text-right font-medium text-ink tabular">{formatCount(r.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function severityRows(data: StatsSummary["bySeverity"]): BarRow[] {
  return SEVERITIES.map((s) => ({
    key: s,
    label: humanize(s),
    value: data.find((d) => d.severity === s)?.count ?? 0,
    color: SEV_COLOR[s],
  }));
}

export function severityCounts(data: StatsSummary["bySeverity"] | undefined): Record<Severity, number> {
  const out = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const d of data ?? []) out[d.severity] = d.count;
  return out;
}

/** Part-to-whole severity mix as one thin bar; 2px surface gaps between segments. */
export function SeverityStack({ counts }: { counts: Record<Severity, number> }) {
  const total = SEVERITIES.reduce((s, k) => s + counts[k], 0);
  if (total === 0) {
    return <div className="h-2 rounded-full bg-surface-2" title="No open findings" />;
  }
  const summary = SEVERITIES.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(" · ");
  return (
    <div className="flex h-2 gap-0.5" role="img" aria-label={summary} title={summary}>
      {SEVERITIES.filter((s) => counts[s] > 0).map((s) => (
        <span
          key={s}
          className="h-full rounded-full"
          style={{ flexGrow: counts[s], flexBasis: 0, minWidth: 4, background: SEV_COLOR[s] }}
        />
      ))}
    </div>
  );
}

/** Tiny open-findings trend for table rows. */
export function Sparkline({ values, width = 88, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return <span className="text-xs text-ink-4">{values.length === 1 ? "1 scan" : "—"}</span>;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke="var(--brand-500)"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={3} fill="var(--brand-600)" stroke="var(--surface-1)" strokeWidth={1.5} />
    </svg>
  );
}
