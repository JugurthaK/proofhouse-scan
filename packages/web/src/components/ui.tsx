import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { absoluteTime, relativeTime } from "../format";
import { AlertIcon, ChevronRightIcon, LockIcon } from "./Icons";

const BTN =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const btn = {
  primary: `${BTN} bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:hover:bg-brand-600`,
  secondary: `${BTN} border border-line bg-surface-1 text-ink shadow-sm hover:border-line-strong hover:bg-surface-2 disabled:hover:bg-surface-1`,
  ghost: `${BTN} text-ink-2 hover:bg-surface-2 hover:text-ink`,
};

export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · proofhouse-scan` : "proofhouse-scan";
  }, [title]);
}

export function PageHeader({
  title,
  subtitle,
  actions,
  leading,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-ink-3">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  className = "",
  bodyClassName = "p-5",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface-1 shadow-card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Severity/status color for the small marker beside the label. */
  accent?: string;
  /** Drill-down, usually a filtered findings list. */
  to?: string;
}) {
  const body = (
    <>
      <p className="flex items-center gap-2 text-xs font-medium text-ink-3">
        {accent && <span className="h-2 w-2 rounded-full" style={{ background: accent }} />}
        {label}
        {to && <ChevronRightIcon size={14} className="ml-auto text-ink-4 transition-colors group-hover:text-brand-600" />}
      </p>
      <p className="mt-1.5 text-[28px] leading-none font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-2 text-xs text-ink-3">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-line bg-surface-1 px-5 py-4 shadow-card";
  return to ? (
    <Link to={to} className={`group ${cls} transition-colors hover:border-brand-200`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function initials(name: string): string {
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  const letters =
    parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : name.replace(/[^a-z0-9]/gi, "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function RepoAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const cls = {
    sm: "h-6 w-6 rounded-md text-[10px]",
    md: "h-8 w-8 rounded-lg text-[11px]",
    lg: "h-11 w-11 rounded-xl text-sm",
  }[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-100 ring-inset ${cls}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function RepoLabel({
  owner,
  name,
  isPrivate,
  className = "",
}: {
  owner: string;
  name: string;
  isPrivate?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="truncate">
        <span className="text-ink-3">{owner}/</span>
        <span className="font-medium text-ink">{name}</span>
      </span>
      {isPrivate && <LockIcon size={12} className="text-ink-4" aria-label="Private repository" />}
    </span>
  );
}

export function TimeAgo({ iso, className = "" }: { iso: string | null | undefined; className?: string }) {
  return (
    <time dateTime={iso ?? undefined} title={absoluteTime(iso)} className={className}>
      {relativeTime(iso)}
    </time>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-3 ${className}`} />;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-bad/20 bg-bad-bg px-3.5 py-2.5 text-sm text-bad">
      <AlertIcon size={16} className="mt-0.5" />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

export function Crumbs({ items }: { items: { label: ReactNode; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-ink-3">
      {items.map((item, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span className="text-ink-4">/</span>}
          {item.to ? (
            <Link to={item.to} className="truncate hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span className="truncate text-ink-2">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
