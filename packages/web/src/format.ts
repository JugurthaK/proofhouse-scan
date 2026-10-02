import type { Category, RepoSummary, Severity } from "./api";

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export const CATEGORY_LABEL: Record<Category, string> = {
  sast: "SAST",
  sca: "Dependencies",
  iac: "IaC",
  secret: "Secrets",
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "yesterday", "just now". */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function duration(startIso: string, endIso: string | null): string | null {
  if (!endIso) return null;
  const s = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const nf = new Intl.NumberFormat("en");
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
export function formatCount(n: number): string {
  return n >= 10_000 ? compact.format(n) : nf.format(n);
}

/** "true_positive" → "True positive". */
export function humanize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${formatCount(n)} ${n === 1 ? word : many}`;
}

/** Stable alphabetical order — keeps the sidebar predictable. */
export function byName(a: RepoSummary, b: RepoSummary): number {
  return a.fullName.localeCompare(b.fullName);
}

/** Most urgent first: critical/high, then open count, then name. */
export function byRisk(a: RepoSummary, b: RepoSummary): number {
  return b.criticalOrHigh - a.criticalOrHigh || b.openFindings - a.openFindings || byName(a, b);
}

export const github = {
  repo: (fullName: string) => `https://github.com/${fullName}`,
  commit: (fullName: string, sha: string) => `https://github.com/${fullName}/commit/${sha}`,
  file: (
    fullName: string,
    ref: string,
    path: string,
    start?: number | null,
    end?: number | null,
  ) => {
    const anchor = start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : "";
    return `https://github.com/${fullName}/blob/${ref}/${path.split("/").map(encodeURIComponent).join("/")}${anchor}`;
  },
};
