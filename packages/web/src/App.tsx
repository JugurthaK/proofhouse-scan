import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, matchPath, NavLink, Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { api, type SessionUser } from "./api";
import { ListIcon, LogOutIcon, MenuIcon, OverviewIcon, SearchIcon, ShieldCheckIcon, XIcon } from "./components/Icons";
import { RepoAvatar } from "./components/ui";
import { byName, formatCount } from "./format";

async function signOut() {
  await api.logout().catch(() => {});
  // Full reload so no cached query data outlives the session.
  window.location.assign("/login");
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <ShieldCheckIcon size={18} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        proofhouse<span className="font-normal text-ink-3">-scan</span>
      </span>
    </Link>
  );
}

function NavItem({ to, end, icon, children }: { to: string; end?: boolean; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
          isActive ? "bg-brand-50 text-brand-700" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
        }`
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

function RepoNav() {
  const { data: repos, isLoading } = useQuery({ queryKey: ["repos"], queryFn: () => api.repos() });
  const [filter, setFilter] = useState("");
  const { pathname, search } = useLocation();

  // A repo stays highlighted on its own page and on findings scoped to it.
  const activeId =
    matchPath("/repos/:id", pathname)?.params.id ??
    (pathname === "/findings" ? new URLSearchParams(search).get("repo_id") : null);

  const all = [...(repos ?? [])].sort(byName);
  // Show the owner only when two repos share a name.
  const dupes = new Set(all.filter((r, _, a) => a.filter((o) => o.name === r.name).length > 1).map((r) => r.name));
  const q = filter.trim().toLowerCase();
  const shown = q ? all.filter((r) => r.fullName.toLowerCase().includes(q)) : all;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mt-7 mb-2 flex items-center justify-between px-6">
        <span className="text-[11px] font-semibold tracking-wider text-ink-4 uppercase">Repositories</span>
        {repos && <span className="text-[11px] font-medium text-ink-4">{repos.length}</span>}
      </div>
      {all.length > 6 && (
        <label className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-ink-3 focus-within:border-brand-300 focus-within:bg-surface-1">
          <SearchIcon size={14} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter repositories"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
          />
        </label>
      )}
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {isLoading &&
          [0, 1, 2, 3].map((i) => <div key={i} className="mx-1 my-2 h-6 animate-pulse rounded-md bg-surface-2" />)}
        {repos?.length === 0 && <p className="px-3 py-2 text-xs text-ink-3">No repositories scanned yet.</p>}
        {q && shown.length === 0 && <p className="px-3 py-2 text-xs text-ink-3">No match.</p>}
        {shown.map((repo) => {
          const active = String(repo.id) === activeId;
          return (
            <Link
              key={repo.id}
              to={`/repos/${repo.id}`}
              title={repo.fullName}
              aria-current={active ? "page" : undefined}
              className={`group flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors ${
                active ? "bg-brand-50 text-brand-700" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <RepoAvatar name={repo.name} size="sm" />
              <span className={`min-w-0 flex-1 truncate ${active ? "font-medium" : ""}`}>
                {dupes.has(repo.name) ? repo.fullName : repo.name}
              </span>
              <span
                className="flex items-center gap-1.5 text-xs text-ink-3 tabular"
                title={`${repo.openFindings} open · ${repo.criticalOrHigh} critical or high`}
              >
                {repo.criticalOrHigh > 0 && <span className="h-1.5 w-1.5 rounded-full bg-sev-critical" />}
                {formatCount(repo.openFindings)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function UserFooter({ user }: { user: SessionUser }) {
  return (
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-3 px-2 py-1">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full ring-1 ring-line" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-ink-2">
            {user.login.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-ink">{user.name ?? user.login}</p>
          <p className="truncate text-xs text-ink-3">@{user.login}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          title="Sign out"
          aria-label="Sign out"
          className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <LogOutIcon />
        </button>
      </div>
    </div>
  );
}

function Sidebar({ user }: { user: SessionUser | null | undefined }) {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center px-5">
        <Brand />
      </div>
      <nav className="space-y-0.5 px-3">
        <NavItem to="/" end icon={<OverviewIcon />}>
          Overview
        </NavItem>
        <NavItem to="/findings" icon={<ListIcon />}>
          Findings
        </NavItem>
      </nav>
      <RepoNav />
      {user && <UserFooter user={user} />}
    </>
  );
}

export default function App() {
  // user is null on an open (no-auth) instance.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: Infinity });
  const user = me?.user;
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setNavOpen(false), [location.pathname, location.search]);

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface-1 lg:flex">
        <Sidebar user={user} />
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface-1/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2"
        >
          <MenuIcon size={20} />
        </button>
        <Brand />
      </header>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/25" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface-1 shadow-pop">
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              aria-label="Close navigation"
              className="absolute top-4 right-3 rounded-md p-1.5 text-ink-3 hover:bg-surface-2"
            >
              <XIcon size={18} />
            </button>
            <Sidebar user={user} />
          </aside>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Outlet />
      </main>
      <ScrollRestoration />
    </div>
  );
}
