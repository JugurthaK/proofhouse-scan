import type { Finding, Repo, Scan } from "../db/schema.js";
import { fetchRepoFile } from "../scm/index.js";

const MAX_LINES = 1500;
const MAX_BYTES = 60_000;

export interface GatheredContext {
  /** Prompt-ready description of the code context. */
  text: string;
  /** Which files were fetched, for the audit trail. */
  files: { path: string; ref: string | null; truncated: boolean }[];
}

function annotate(content: string, finding: Finding): { text: string; truncated: boolean } {
  const lines = content.split("\n");
  const start = finding.startLine ?? 1;
  const end = finding.endLine ?? start;

  let truncated = false;
  let windowStart = 0;
  let windowEnd = lines.length;
  if (lines.length > MAX_LINES) {
    truncated = true;
    const half = Math.floor(MAX_LINES / 2);
    windowStart = Math.max(0, start - 1 - half);
    windowEnd = Math.min(lines.length, windowStart + MAX_LINES);
  }

  const annotated = lines
    .slice(windowStart, windowEnd)
    .map((line, i) => {
      const lineNo = windowStart + i + 1;
      const marker = lineNo >= start && lineNo <= end ? ">>>" : "   ";
      return `${marker} ${String(lineNo).padStart(5)} | ${line}`;
    })
    .join("\n");

  let text = annotated;
  if (text.length > MAX_BYTES) {
    truncated = true;
    text = text.slice(0, MAX_BYTES) + "\n[truncated]";
  }
  const prefix = truncated ? "[file truncated around the flagged region]\n" : "";
  return { text: prefix + text, truncated };
}

/**
 * Gather code context for a finding: the flagged file at the scanned commit,
 * annotated with line numbers and a >>> marker on the flagged region. For SCA
 * findings, the dependency manifest plus lockfile excerpt instead.
 */
export async function gatherContext(
  finding: Finding,
  repo: Repo,
  scan: Scan | null,
): Promise<GatheredContext> {
  const ref = scan?.commitSha ?? repo.defaultBranch ?? undefined;
  const files: GatheredContext["files"] = [];
  const sections: string[] = [];

  const mainContent = await fetchRepoFile(repo, finding.filePath, ref);
  if (mainContent !== null) {
    const { text, truncated } = annotate(mainContent, finding);
    files.push({ path: finding.filePath, ref: ref ?? null, truncated });
    sections.push(`### File: ${finding.filePath}\n\`\`\`\n${text}\n\`\`\``);
  } else {
    sections.push(
      `### File: ${finding.filePath}\n(could not fetch file content — it may exist only in git history, e.g. a deleted secret)`,
    );
  }

  if (finding.category === "sca") {
    // For dependency findings the lockfile pins the actual resolved version.
    const lockCandidates = [
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "poetry.lock",
      "Gemfile.lock",
      "go.sum",
    ].filter((p) => p !== finding.filePath);
    for (const lockPath of lockCandidates) {
      const lock = await fetchRepoFile(repo, lockPath, ref);
      if (lock !== null) {
        const excerpt = lock.length > 8000 ? lock.slice(0, 8000) + "\n[truncated]" : lock;
        files.push({ path: lockPath, ref: ref ?? null, truncated: lock.length > 8000 });
        sections.push(`### Lockfile: ${lockPath}\n\`\`\`\n${excerpt}\n\`\`\``);
        break;
      }
    }
  }

  return { text: sections.join("\n\n"), files };
}
