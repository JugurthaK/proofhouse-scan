import { config as loadDotenv } from "dotenv";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

// Load .env from the current working directory and, as a fallback, from the
// monorepo root two levels up (when running from packages/*).
loadDotenv({ quiet: true });
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

// GitHub and GitLab credentials are each optional here — a GitLab-only setup
// needs no GITHUB_TOKEN. They are enforced when a repo of that kind is used.
const envSchema = z.object({
  GITHUB_TOKEN: z.string().optional(),
  PROOFHOUSE_SCAN_REPO: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, "PROOFHOUSE_SCAN_REPO must be owner/repo")
    .optional(),
  GITLAB_TOKEN: z.string().optional(),
  GITLAB_TOKENS: z.string().optional(),
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_MODEL: z.string().default("claude-opus-5"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  PROOFHOUSE_SCAN_DB_PATH: z.string().default("~/.proofhouse-scan/proofhouse-scan.db"),
  PORT: z.coerce.number().int().positive().default(8790),
  HOST: z.string().default("127.0.0.1"),
  PROOFHOUSE_SCAN_API_TOKEN: z.string().optional(),
  PROOFHOUSE_SCAN_INGEST_TOKEN: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  PROOFHOUSE_SCAN_ALLOWED_USERS: z.string().optional(),
  PROOFHOUSE_SCAN_ALLOWED_ORGS: z.string().optional(),
});

export interface GitlabHost {
  /** API base without /api/v4, e.g. https://gitlab.com */
  baseUrl: string;
  token: string;
}

export type ProofhouseScanConfig = z.infer<typeof envSchema> & {
  dbPath: string;
  /** GitLab instances by lowercased host (with port), from GITLAB_TOKEN(S). */
  gitlabHosts: Map<string, GitlabHost>;
};

function expandHome(p: string): string {
  return p.startsWith("~/") || p === "~" ? p.replace("~", homedir()) : p;
}

/**
 * GITLAB_TOKENS is a comma-separated list of `host=token`; the host may be a
 * URL to pick the scheme (`http://localhost:8080=glpat-…`), else https.
 * GITLAB_TOKEN is shorthand for gitlab.com.
 */
export function parseGitlabTokens(
  list: string | undefined,
  single: string | undefined,
): Map<string, GitlabHost> {
  const hosts = new Map<string, GitlabHost>();
  const entries = (list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  entries.forEach((entry, i) => {
    const eq = entry.indexOf("=");
    const key = eq > 0 ? entry.slice(0, eq).trim() : "";
    const token = eq > 0 ? entry.slice(eq + 1).trim() : "";
    let url: URL | null = null;
    try {
      url = new URL(/^https?:\/\//i.test(key) ? key : `https://${key}`);
    } catch {
      // reported below
    }
    if (!key || !token || !url || url.pathname !== "/") {
      // Never echo the entry: a missing "=" would print the token itself.
      throw new Error(
        `Invalid GITLAB_TOKENS entry #${i + 1} — expected host=token, e.g. gitlab.com=glpat-…`,
      );
    }
    hosts.set(url.host, { baseUrl: url.origin, token });
  });
  if (single && !hosts.has("gitlab.com")) {
    hosts.set("gitlab.com", { baseUrl: "https://gitlab.com", token: single });
  }
  return hosts;
}

/** owner/repo of the GitHub repo hosting scan.yml, for dispatch mode. */
export function getGithubScanRepo(): { owner: string; repo: string } {
  const { PROOFHOUSE_SCAN_REPO } = getConfig();
  if (!PROOFHOUSE_SCAN_REPO) {
    throw new Error(
      "PROOFHOUSE_SCAN_REPO is required to dispatch GitHub scans (see .env.example)",
    );
  }
  const [owner, repo] = PROOFHOUSE_SCAN_REPO.split("/") as [string, string];
  return { owner, repo };
}

let cached: ProofhouseScanConfig | null = null;

/**
 * Validated configuration. `requireGithub`/`requireLlm` let read-only commands
 * (e.g. `proofhouse-scan list`) run without a full .env.
 */
export function getConfig(): ProofhouseScanConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid configuration (check your .env — see .env.example):\n${issues}`,
    );
  }
  const env = parsed.data;
  cached = {
    ...env,
    dbPath: resolve(expandHome(env.PROOFHOUSE_SCAN_DB_PATH)),
    gitlabHosts: parseGitlabTokens(env.GITLAB_TOKENS, env.GITLAB_TOKEN),
  };
  return cached;
}

/** Comma-separated GitHub logins/orgs, normalized (GitHub names are case-insensitive). */
function parseNameList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

export interface LocalConfig {
  dbPath: string;
  port: number;
  host: string;
  apiToken: string | undefined;
  ingestToken: string | undefined;
  githubClientId: string | undefined;
  githubClientSecret: string | undefined;
  allowedUsers: string[];
  allowedOrgs: string[];
  /** Serve landing.html at "/" to signed-out visitors (needs GitHub sign-in). */
  landing: boolean;
}

/**
 * Config for the server and commands that only touch the local database.
 * Deliberately loose: hosted ingest must not require GITHUB_TOKEN etc.
 */
export function getLocalConfig(): LocalConfig {
  const dbPath = resolve(
    expandHome(process.env.PROOFHOUSE_SCAN_DB_PATH ?? "~/.proofhouse-scan/proofhouse-scan.db"),
  );
  return {
    dbPath,
    port: Number(process.env.PORT ?? 8790),
    host: process.env.HOST ?? "127.0.0.1",
    apiToken: process.env.PROOFHOUSE_SCAN_API_TOKEN || undefined,
    ingestToken: process.env.PROOFHOUSE_SCAN_INGEST_TOKEN || undefined,
    githubClientId: process.env.GITHUB_OAUTH_CLIENT_ID || undefined,
    githubClientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || undefined,
    allowedUsers: parseNameList(process.env.PROOFHOUSE_SCAN_ALLOWED_USERS),
    allowedOrgs: parseNameList(process.env.PROOFHOUSE_SCAN_ALLOWED_ORGS),
    landing: /^(1|true|yes)$/i.test(process.env.PROOFHOUSE_SCAN_LANDING ?? ""),
  };
}
