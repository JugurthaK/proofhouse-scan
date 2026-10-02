import { openDb, sessions, type Db } from "@proofhouse-scan/core";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { safeNextPath } from "../src/auth.js";

const AUTH_ENV = [
  "PROOFHOUSE_SCAN_API_TOKEN",
  "PROOFHOUSE_SCAN_INGEST_TOKEN",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "PROOFHOUSE_SCAN_ALLOWED_USERS",
  "PROOFHOUSE_SCAN_ALLOWED_ORGS",
];
const GITHUB_ENV = {
  GITHUB_OAUTH_CLIENT_ID: "cid",
  GITHUB_OAUTH_CLIENT_SECRET: "csecret",
};

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "proofhouse-scan-auth-")), "t.db");
}

let savedEnv: Record<string, string | undefined>;

function setEnv(vars: Record<string, string>): void {
  for (const key of AUTH_ENV) delete process.env[key];
  Object.assign(process.env, vars);
}

/** Fake GitHub: "good-code" exchanges for a token; `orgs` maps org -> membership state. */
function mockGithub(opts: { login?: string; orgs?: Record<string, string> } = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body)) as { code: string; client_secret: string };
      if (body.code !== "good-code" || body.client_secret !== "csecret") {
        return Response.json({ error: "bad_verification_code" });
      }
      return Response.json({ access_token: "gho_test", token_type: "bearer" });
    }
    if (url === "https://api.github.com/user") {
      return Response.json({
        id: 42,
        login: opts.login ?? "Alice",
        name: "Alice A.",
        avatar_url: "https://avatars.example/42",
      });
    }
    const org = url.match(/^https:\/\/api\.github\.com\/user\/memberships\/orgs\/(.+)$/)?.[1];
    if (org !== undefined) {
      const state = opts.orgs?.[org];
      return state ? Response.json({ state }) : new Response("{}", { status: 404 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setCookies(res: LightMyRequestResponse): string[] {
  const header = res.headers["set-cookie"] ?? [];
  return Array.isArray(header) ? header : [header];
}

function cookieValue(res: LightMyRequestResponse, name: string): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

async function signIn(app: FastifyInstance, next = "/"): Promise<LightMyRequestResponse> {
  const start = await app.inject({
    url: `/api/auth/github/login?${new URLSearchParams({ next })}`,
  });
  const state = new URL(String(start.headers.location)).searchParams.get("state");
  return app.inject({
    url: `/api/auth/github/callback?code=good-code&state=${state}`,
    headers: { cookie: `proofhouse_scan_oauth=${cookieValue(start, "proofhouse_scan_oauth")}` },
  });
}

function sessionHeader(res: LightMyRequestResponse): string {
  const token = cookieValue(res, "proofhouse_scan_session");
  expect(token).toBeTruthy();
  return `proofhouse_scan_session=${token}`;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(AUTH_ENV.map((k) => [k, process.env[k]]));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/findings/7?severity=high")).toBe("/findings/7?severity=high");
  });

  it("rejects anything that could leave the origin", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "evil.example",
      "/a b",
      "/a\nb",
      "",
      undefined,
      ["/x"],
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("startup validation", () => {
  it("requires the OAuth client id and secret together", () => {
    setEnv({ GITHUB_OAUTH_CLIENT_ID: "cid", PROOFHOUSE_SCAN_ALLOWED_USERS: "alice" });
    expect(() => buildApp(openDb(tempDbPath()))).toThrow(/must be set together/);
  });

  it("refuses GitHub sign-in without an allowlist", () => {
    setEnv(GITHUB_ENV);
    expect(() => buildApp(openDb(tempDbPath()))).toThrow(/refusing to admit/);
  });
});

describe("open mode (no auth configured)", () => {
  it("serves the API without credentials", async () => {
    setEnv({});
    const app = buildApp(openDb(tempDbPath()));
    const res = await app.inject({ url: "/api/auth/me" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: null });
  });
});

describe("GitHub sign-in (user allowlist)", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(() => {
    setEnv({ ...GITHUB_ENV, PROOFHOUSE_SCAN_ALLOWED_USERS: "alice, @Bob" });
    db = openDb(tempDbPath());
    app = buildApp(db);
  });

  it("rejects unauthenticated API requests but keeps health public", async () => {
    expect((await app.inject({ url: "/api/repos" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/auth/me" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
  });

  it("redirects to GitHub with a state cookie", async () => {
    const res = await app.inject({ url: "/api/auth/github/login" });
    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(location.searchParams.get("client_id")).toBe("cid");
    expect(location.searchParams.get("state")).toMatch(/^[\w-]{43}$/);
    expect(location.searchParams.get("allow_signup")).toBe("false");
    expect(location.searchParams.has("scope")).toBe(false); // no orgs => no scopes
    const [cookie] = setCookies(res);
    expect(cookie).toMatch(/^proofhouse_scan_oauth=/);
    expect(cookie).toContain("Path=/api/auth/github");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("marks cookies Secure behind an HTTPS proxy", async () => {
    const res = await app.inject({
      url: "/api/auth/github/login",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(setCookies(res)[0]).toContain("Secure");
  });

  it("signs in an allowlisted user, returns to `next`, and signs out", async () => {
    mockGithub();
    const res = await signIn(app, "/findings/7?severity=high");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/findings/7?severity=high");
    const cookies = setCookies(res);
    expect(cookies).toContainEqual(expect.stringMatching(/^proofhouse_scan_oauth=;.*Max-Age=0/));
    const session = cookies.find((c) => c.startsWith("proofhouse_scan_session="));
    expect(session).toContain("Path=/");
    expect(session).toContain(`Max-Age=${7 * 24 * 60 * 60}`);
    expect(session).toContain("HttpOnly");

    const cookie = sessionHeader(res);
    const me = await app.inject({ url: "/api/auth/me", headers: { cookie } });
    expect(me.json()).toEqual({
      user: { login: "Alice", name: "Alice A.", avatarUrl: "https://avatars.example/42" },
    });
    // Only the token's hash is persisted.
    const [row] = db.select().from(sessions).all();
    expect(row?.id).not.toBe(cookie.split("=")[1]);
    expect(row?.grantedByOrg).toBeNull();

    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(setCookies(out)[0]).toMatch(/^proofhouse_scan_session=;.*Max-Age=0/);
    expect((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("never redirects off-site after sign-in", async () => {
    mockGithub();
    const res = await signIn(app, "//evil.example/phish");
    expect(res.headers.location).toBe("/");
  });

  it("rejects a callback whose state doesn't match the cookie", async () => {
    const fetchMock = mockGithub();
    const start = await app.inject({ url: "/api/auth/github/login" });
    const cookie = `proofhouse_scan_oauth=${cookieValue(start, "proofhouse_scan_oauth")}`;
    const forged = await app.inject({
      url: "/api/auth/github/callback?code=good-code&state=attacker-state",
      headers: { cookie },
    });
    expect(forged.headers.location).toBe("/login?error=state_mismatch");
    const noCookie = await app.inject({
      url: "/api/auth/github/callback?code=good-code&state=x",
    });
    expect(noCookie.headers.location).toBe("/login?error=state_mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports cancelled and failed GitHub authorizations", async () => {
    mockGithub();
    const cancelled = await app.inject({
      url: "/api/auth/github/callback?error=access_denied&state=x",
    });
    expect(cancelled.headers.location).toBe("/login?error=access_denied");

    const start = await app.inject({ url: "/api/auth/github/login" });
    const state = new URL(String(start.headers.location)).searchParams.get("state");
    const badCode = await app.inject({
      url: `/api/auth/github/callback?code=expired&state=${state}`,
      headers: { cookie: `proofhouse_scan_oauth=${cookieValue(start, "proofhouse_scan_oauth")}` },
    });
    expect(badCode.headers.location).toBe("/login?error=github_error");
  });

  it("denies GitHub users outside the allowlist", async () => {
    mockGithub({ login: "mallory" });
    const res = await signIn(app);
    expect(res.headers.location).toBe("/login?error=not_allowed");
    expect(cookieValue(res, "proofhouse_scan_session")).toBeUndefined();
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("rejects expired sessions", async () => {
    mockGithub();
    const cookie = sessionHeader(await signIn(app));
    db.update(sessions).set({ expiresAt: "2000-01-01T00:00:00.000Z" }).run();
    expect((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(401);
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });

  it("revokes sessions when the user leaves the allowlist", async () => {
    mockGithub();
    const cookie = sessionHeader(await signIn(app));
    setEnv({ ...GITHUB_ENV, PROOFHOUSE_SCAN_ALLOWED_USERS: "bob" });
    const restarted = buildApp(db);
    expect((await restarted.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(
      401,
    );
  });

  it("rejects cross-origin unsafe requests made with the session cookie", async () => {
    mockGithub();
    const cookie = sessionHeader(await signIn(app));
    const post = (headers: Record<string, string>) =>
      app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie, ...headers } });

    expect((await post({ "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
    expect((await post({ "sec-fetch-site": "same-site" })).statusCode).toBe(403);
    expect(
      (await post({ host: "scan.example", origin: "https://evil.scan.example" })).statusCode,
    ).toBe(403);
    expect((await post({ host: "scan.example", origin: "https://scan.example" })).statusCode).toBe(
      200,
    );
  });

  it("accepts same-origin fetches", async () => {
    mockGithub();
    const cookie = sessionHeader(await signIn(app));
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("keeps ingest closed to browser sessions", async () => {
    mockGithub();
    const cookie = sessionHeader(await signIn(app));
    const res = await app.inject({ method: "POST", url: "/api/ingest", headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});

describe("GitHub sign-in alongside tokens", () => {
  it("still accepts the API bearer token, and ingest uses its own token", async () => {
    setEnv({
      ...GITHUB_ENV,
      PROOFHOUSE_SCAN_ALLOWED_USERS: "alice",
      PROOFHOUSE_SCAN_API_TOKEN: "api-secret",
      PROOFHOUSE_SCAN_INGEST_TOKEN: "ingest-secret",
    });
    const app = buildApp(openDb(tempDbPath()));
    const me = await app.inject({
      url: "/api/auth/me",
      headers: { authorization: "Bearer api-secret" },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: null });

    const ingest = (token: string) =>
      app.inject({
        method: "POST",
        url: "/api/ingest",
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
    expect((await ingest("api-secret")).statusCode).toBe(401);
    expect((await ingest("ingest-secret")).statusCode).toBe(400); // authorized; empty body
  });
});

describe("GitHub sign-in (org allowlist)", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(() => {
    setEnv({ ...GITHUB_ENV, PROOFHOUSE_SCAN_ALLOWED_ORGS: "acme" });
    db = openDb(tempDbPath());
    app = buildApp(db);
  });

  it("requests read:org and admits active org members", async () => {
    const start = await app.inject({ url: "/api/auth/github/login" });
    expect(new URL(String(start.headers.location)).searchParams.get("scope")).toBe("read:org");

    mockGithub({ login: "carol", orgs: { acme: "active" } });
    const res = await signIn(app);
    expect(res.headers.location).toBe("/");
    expect(db.select().from(sessions).all()[0]?.grantedByOrg).toBe("acme");
  });

  it("denies pending members and non-members", async () => {
    mockGithub({ login: "dave", orgs: { acme: "pending" } });
    expect((await signIn(app)).headers.location).toBe("/login?error=not_allowed");
    mockGithub({ login: "erin" });
    expect((await signIn(app)).headers.location).toBe("/login?error=not_allowed");
  });

  it("revokes org-granted sessions when the org leaves the allowlist", async () => {
    mockGithub({ login: "carol", orgs: { acme: "active" } });
    const cookie = sessionHeader(await signIn(app));
    expect((await app.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(200);
    setEnv({ ...GITHUB_ENV, PROOFHOUSE_SCAN_ALLOWED_ORGS: "other-org" });
    const restarted = buildApp(db);
    expect((await restarted.inject({ url: "/api/auth/me", headers: { cookie } })).statusCode).toBe(
      401,
    );
  });
});
