import { NavLink, Outlet } from "react-router-dom";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"
  }`;

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface-1">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <span className="text-lg font-semibold tracking-tight">
            <span className="text-accent">proofhouse</span>-scan
          </span>
          <nav className="flex gap-1">
            <NavLink to="/" end className={linkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/findings" className={linkClass}>
              Findings
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
