import { nowIso, sessions, type Db, type LocalConfig } from "@proofhouse-scan/core";
import { eq, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface SessionUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    // Set by the auth hook for requests authenticated by a GitHub session.
    user: SessionUser | null;
  }
}

export interface AuthConfig {
  apiToken: string | undefined;
  ingestToken: string | undefined;
  github: { clientId: string; clientSecret: string } | null;
  allowedUsers: Set<string>;
  allowedOrgs: Set<string>;
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

const SESSION_COOKIE = "proofhouse_scan_session";
const STATE_COOKIE = "proofhouse_scan_oauth";
const STATE_COOKIE_PATH = "/api/auth/github";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;
const GITHUB_TIMEOUT_MS = 10_000;

const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/auth/github/login",
  "/api/auth/github/callback",
]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Validates auth env vars; throws rather than start with an open door. */
export function resolveAuthConfig(config: LocalConfig): AuthConfig {
  const { githubClientId: clientId, githubClientSecret: clientSecret } = config;
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error(
      "GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET must be set together",
    );
  }
  const github = clientId && clientSecret ? { clientId, clientSecret } : null;
  if (github && config.allowedUsers.length === 0 && config.allowedOrgs.length === 0) {
    throw new Error(
      "GitHub sign-in is enabled but neither PROOFHOUSE_SCAN_ALLOWED_USERS nor " +
        "PROOFHOUSE_SCAN_ALLOWED_ORGS is set — refusing to admit every GitHub account",
    );
  }
  return {
    apiToken: config.apiToken,
    ingestToken: config.ingestToken,
    github,
    allowedUsers: new Set(config.allowedUsers),
    allowedOrgs: new Set(config.allowedOrgs),
  };
}

/**
 * Post-login redirect target: a same-origin absolute path only. Rejects
 * "//host" and "/\host", which browsers resolve as protocol-relative URLs.
 */
export function safeNextPath(next: unknown): string {
  return typeof next === "string" && /^\/(?![/\\])[\x21-\x7e]{0,1000}$/.test(next)
    ? next
    : "/";
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

// Only decides whether to add the Secure attribute, so a spoofed
// X-Forwarded-Proto can at worst make the requester's own cookie stricter.
function isHttps(request: FastifyRequest): boolean {
  const header = request.headers["x-forwarded-proto"];
  const proto = (Array.isArray(header) ? header[0] : header)?.split(",")[0]?.trim();
  return proto === "https" || request.protocol === "https";
}

function setCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
  value: string,
  opts: { path: string; maxAge: number },
): void {
  const attrs = [`${name}=${value}`, `Path=${opts.path}`, `Max-Age=${opts.maxAge}`];
  attrs.push("HttpOnly", "SameSite=Lax");
  if (isHttps(request)) attrs.push("Secure");
  // Fastify appends repeated set-cookie headers rather than replacing them.
  reply.header("set-cookie", attrs.join("; "));
}

/**
 * Browser CSRF guard for cookie-authenticated unsafe requests (same approach
 * as Go's http.CrossOriginProtection). SameSite=Lax already stops cross-site
 * requests; this also covers same-site, cross-origin ones (sibling subdomains).
 */
function isCrossOrigin(request: FastifyRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  const site = request.headers["sec-fetch-site"];
  if (site) return site !== "same-origin" && site !== "none";
  const origin = request.headers.origin;
  if (!origin) return false; // neither header: not a browser request
  try {
    return new URL(origin).host !== request.headers.host;
  } catch {
    return true;
  }
}

function createSession(db: Db, user: GithubUser, grantedByOrg: string | null): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.delete(sessions).where(lt(sessions.expiresAt, new Date(now).toISOString())).run();
  db.insert(sessions)
    .values({
      id: hashToken(token),
      githubUserId: user.id,
      githubLogin: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      grantedByOrg,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
    })
    .run();
  return token;
}

function loadSession(db: Db, config: AuthConfig, token: string): SessionUser | null {
  const row = db.select().from(sessions).where(eq(sessions.id, hashToken(token))).get();
  if (!row) return null;
  // Re-check the allowlist on every request so removing a user or org from
  // the config (and restarting) revokes their existing sessions.
  const stillAllowed =
    config.allowedUsers.has(row.githubLogin.toLowerCase()) ||
    (row.grantedByOrg !== null && config.allowedOrgs.has(row.grantedByOrg));
  if (row.expiresAt <= nowIso() || !stillAllowed) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return null;
  }
  return { login: row.githubLogin, name: row.name, avatarUrl: row.avatarUrl };
}

async function exchangeCode(
  github: NonNullable<AuthConfig["github"]>,
  code: string,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: github.clientId,
      client_secret: github.clientSecret,
      code,
    }),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  // GitHub reports OAuth errors (bad_verification_code, ...) with HTTP 200.
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(`token exchange failed: ${body.error ?? `HTTP ${res.status}`}`);
  }
  return body.access_token;
}

function githubApi(path: string, accessToken: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "proofhouse-scan",
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
}

async function fetchGithubUser(accessToken: string): Promise<GithubUser> {
  const res = await githubApi("/user", accessToken);
  if (!res.ok) throw new Error(`GET /user failed: HTTP ${res.status}`);
  return (await res.json()) as GithubUser;
}

/** null = not allowed; otherwise the allowlisted org that granted access, if any. */
async function findGrant(
  config: AuthConfig,
  login: string,
  accessToken: string,
): Promise<{ org: string | null } | null> {
  if (config.allowedUsers.has(login.toLowerCase())) return { org: null };
  for (const org of config.allowedOrgs) {
    const res = await githubApi(
      `/user/memberships/orgs/${encodeURIComponent(org)}`,
      accessToken,
    );
    // 404: not a member. 403: the org restricts OAuth App access.
    if (res.status === 404 || res.status === 403) continue;
    if (!res.ok) throw new Error(`org membership check failed: HTTP ${res.status}`);
    const membership = (await res.json()) as { state?: string };
    if (membership.state === "active") return { org };
  }
  return null;
}

export function registerAuth(app: FastifyInstance, db: Db, config: AuthConfig): void {
  const authEnabled = Boolean(config.github || config.apiToken);
  app.decorateRequest("user", null);

  // Registered FIRST (see buildApp) so every later route, including the
  // static/SPA fallback, inherits it. Static assets stay public; data does not.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/api/") || PUBLIC_ROUTES.has(url)) return;
    const header = request.headers.authorization ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";

    // Ingest is machine-only (bearer, never a browser session). It falls back
    // to the api token, and stays closed whenever any auth is configured.
    if (url.startsWith("/api/ingest")) {
      const required = config.ingestToken ?? config.apiToken;
      const ok = required ? tokenMatches(bearer, required) : !authEnabled;
      if (!ok) return reply.code(401).send({ error: "unauthorized" });
      return;
    }

    if (!authEnabled) return; // nothing configured: open, for local dev
    if (config.apiToken && tokenMatches(bearer, config.apiToken)) return;

    const token = config.github ? readCookie(request, SESSION_COOKIE) : undefined;
    const user = token ? loadSession(db, config, token) : null;
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (isCrossOrigin(request)) {
      return reply.code(403).send({ error: "cross-origin request rejected" });
    }
    request.user = user;
  });

  app.get("/api/auth/me", (request) => ({ user: request.user }));

  app.post("/api/auth/logout", (request, reply) => {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
    setCookie(request, reply, SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return { ok: true };
  });

  app.get<{ Querystring: { next?: string } }>(
    "/api/auth/github/login",
    (request, reply) => {
      if (!config.github) return reply.redirect("/login?error=not_configured");
      const state = randomBytes(32).toString("base64url");
      const next = Buffer.from(safeNextPath(request.query.next)).toString("base64url");
      setCookie(request, reply, STATE_COOKIE, `${state}.${next}`, {
        path: STATE_COOKIE_PATH,
        maxAge: STATE_TTL_SECONDS,
      });
      // No redirect_uri: GitHub uses the OAuth App's registered callback URL.
      const params = new URLSearchParams({
        client_id: config.github.clientId,
        state,
        allow_signup: "false",
      });
      if (config.allowedOrgs.size > 0) params.set("scope", "read:org");
      return reply.redirect(`https://github.com/login/oauth/authorize?${params}`);
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/github/callback",
    async (request, reply) => {
      const fail = (error: string) => reply.redirect(`/login?error=${error}`);
      const saved = readCookie(request, STATE_COOKIE);
      setCookie(request, reply, STATE_COOKIE, "", { path: STATE_COOKIE_PATH, maxAge: 0 });

      if (!config.github) return fail("not_configured");
      const { code, state, error } = request.query;
      if (error) return fail(error === "access_denied" ? "access_denied" : "github_error");
      const [savedState = "", savedNext = ""] = (saved ?? "").split(".", 2);
      if (!code || !state || !savedState || !tokenMatches(state, savedState)) {
        return fail("state_mismatch");
      }

      let user: GithubUser;
      let grant: { org: string | null } | null;
      try {
        // The GitHub token is only used here and never stored.
        const accessToken = await exchangeCode(config.github, code);
        user = await fetchGithubUser(accessToken);
        grant = await findGrant(config, user.login, accessToken);
      } catch (err) {
        console.error(
          "GitHub sign-in failed:",
          err instanceof Error ? err.message : String(err),
        );
        return fail("github_error");
      }
      if (!grant) {
        console.warn(`GitHub sign-in denied for @${user.login} (not in allowlist)`);
        return fail("not_allowed");
      }

      const token = createSession(db, user, grant.org);
      setCookie(request, reply, SESSION_COOKIE, token, {
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      });
      console.log(
        `GitHub sign-in: @${user.login}${grant.org ? ` (member of ${grant.org})` : ""}`,
      );
      return reply.redirect(
        safeNextPath(Buffer.from(savedNext, "base64url").toString("utf8")),
      );
    },
  );
}
