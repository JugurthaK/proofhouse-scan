import { config as loadDotenv } from "dotenv";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

// Load .env from the current working directory and, as a fallback, from the
// monorepo root two levels up (when running from packages/*).
loadDotenv({ quiet: true });
loadDotenv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  PROOFHOUSE_SCAN_REPO: z
    .string()
    .regex(/^[^/]+\/[^/]+$/, "PROOFHOUSE_SCAN_REPO must be owner/repo"),
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  LLM_MODEL: z.string().default("claude-opus-5"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  PROOFHOUSE_SCAN_DB_PATH: z.string().default("~/.proofhouse-scan/proofhouse-scan.db"),
  PORT: z.coerce.number().int().positive().default(8790),
  HOST: z.string().default("127.0.0.1"),
  PROOFHOUSE_SCAN_API_TOKEN: z.string().optional(),
  PROOFHOUSE_SCAN_INGEST_TOKEN: z.string().optional(),
});

export type ProofhouseScanConfig = z.infer<typeof envSchema> & {
  dbPath: string;
  proofhouseScanOwner: string;
  proofhouseScanRepo: string;
};

function expandHome(p: string): string {
  return p.startsWith("~/") || p === "~" ? p.replace("~", homedir()) : p;
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
  const [proofhouseScanOwner, proofhouseScanRepo] = env.PROOFHOUSE_SCAN_REPO.split("/") as [
    string,
    string,
  ];
  cached = {
    ...env,
    dbPath: resolve(expandHome(env.PROOFHOUSE_SCAN_DB_PATH)),
    proofhouseScanOwner,
    proofhouseScanRepo,
  };
  return cached;
}

/**
 * Config for the server and commands that only touch the local database.
 * Deliberately loose: hosted ingest must not require GITHUB_TOKEN etc.
 */
export function getLocalConfig(): {
  dbPath: string;
  port: number;
  host: string;
  apiToken: string | undefined;
  ingestToken: string | undefined;
} {
  const dbPath = resolve(
    expandHome(process.env.PROOFHOUSE_SCAN_DB_PATH ?? "~/.proofhouse-scan/proofhouse-scan.db"),
  );
  return {
    dbPath,
    port: Number(process.env.PORT ?? 8790),
    host: process.env.HOST ?? "127.0.0.1",
    apiToken: process.env.PROOFHOUSE_SCAN_API_TOKEN || undefined,
    ingestToken: process.env.PROOFHOUSE_SCAN_INGEST_TOKEN || undefined,
  };
}
