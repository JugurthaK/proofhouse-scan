import { Link, useLocation, useNavigate } from "react-router-dom";
import type { FindingRow } from "../api";
import { CATEGORY_LABEL, shortRuleId } from "../format";
import { QualificationBadge, SeverityBadge, StatusBadge } from "./Badges";

/** "src/api/users.ts:42" with the directory de-emphasized. */
export function FilePath({ path, line }: { path: string; line?: number | null }) {
  const cut = path.lastIndexOf("/");
  return (
    <span className="mono block truncate text-xs" title={`${path}${line ? `:${line}` : ""}`}>
      {cut >= 0 && <span className="text-ink-4">{path.slice(0, cut + 1)}</span>}
      <span className="text-ink-2">{path.slice(cut + 1)}</span>
      {line ? <span className="text-ink-4">:{line}</span> : null}
    </span>
  );
}

export function FindingsTable({ findings, showRepo = true }: { findings: FindingRow[]; showRepo?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  // Lets the detail page return to this exact filtered view.
  const state = { from: location.pathname + location.search };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[940px] table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[104px]" />
          <col />
          <col className="w-[20%]" />
          {showRepo && <col className="w-[13%]" />}
          <col className="w-[120px]" />
          <col className="w-[96px]" />
          <col className="w-[116px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-surface-2/60 text-xs text-ink-3">
            <th className="py-2.5 pr-3 pl-5 font-medium">Severity</th>
            <th className="px-3 py-2.5 font-medium">Finding</th>
            <th className="px-3 py-2.5 font-medium">Location</th>
            {showRepo && <th className="px-3 py-2.5 font-medium">Repository</th>}
            <th className="px-3 py-2.5 font-medium">Source</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="py-2.5 pr-5 pl-3 font-medium">Triage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {findings.map((f) => (
            <tr
              key={f.id}
              onClick={(e) => {
                // Respect cmd/ctrl-click on the inner link (open in new tab).
                if ((e.target as HTMLElement).closest("a")) return;
                navigate(`/findings/${f.id}`, { state });
              }}
              className={`group cursor-pointer transition-colors hover:bg-brand-50/40 ${
                f.status === "resolved" ? "text-ink-3" : ""
              }`}
            >
              <td className="py-3 pr-3 pl-5 align-top">
                <SeverityBadge severity={f.severity} />
              </td>
              <td className="px-3 py-3 align-top">
                <Link
                  to={`/findings/${f.id}`}
                  state={state}
                  className="mono block truncate text-[13px] font-medium text-ink group-hover:text-brand-700"
                  title={f.ruleId}
                >
                  {shortRuleId(f.ruleId)}
                </Link>
                <span className="mt-0.5 block truncate text-xs text-ink-3" title={f.message}>
                  {f.message}
                </span>
              </td>
              <td className="px-3 py-3 align-top">
                <FilePath path={f.filePath} line={f.startLine} />
              </td>
              {showRepo && (
                <td className="px-3 py-3 align-top">
                  <span className="block truncate text-xs text-ink-2" title={f.repo}>
                    {f.repo.split("/").pop()}
                  </span>
                </td>
              )}
              <td className="px-3 py-3 align-top text-xs">
                <span className="block text-ink-2">{f.scanner}</span>
                <span className="block text-ink-4">{CATEGORY_LABEL[f.category]}</span>
              </td>
              <td className="px-3 py-3 align-top">
                <StatusBadge status={f.status} />
              </td>
              <td className="py-3 pr-5 pl-3 align-top">
                <QualificationBadge qualification={f.qualification} compact />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
