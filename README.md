# proofhouse-scan

Security scanning for GitHub repositories with LLM-assisted triage.

Proofhouse-scan scans any GitHub repo (passed as a parameter — nothing is installed in
target repos) using a GitHub Actions pipeline, stores deduplicated findings in
a local SQLite database, and gives you a web UI to browse them, qualify each
finding with an LLM (true positive vs false positive), and open automated fix
pull requests for confirmed issues.

```
proofhouse-scan scan owner/repo
   └─ dispatches .github/workflows/scan.yml (in THIS repo) with the target as input
        ├─ Opengrep  → SAST          → SARIF artifact
        ├─ Trivy     → SCA + IaC     → SARIF artifact
        └─ GitLeaks  → secrets (full git history) → SARIF artifact
   └─ downloads artifacts, normalizes SARIF, upserts findings into SQLite

proofhouse-scan serve
   └─ web UI: dashboards, filterable findings, per-finding LLM triage
        Qualify → LLM verdict (true/false positive + reasoning)
        Remediate → LLM patch → branch + PR on the target repo
                    (direct push if you have write access, fork fallback otherwise)
                    — or a merge request on GitLab (Developer role required)
```

## Architecture

- **`packages/core`** — shared library: SQLite schema (drizzle + better-sqlite3),
  SARIF parsing/normalization, finding fingerprinting & re-scan reconciliation,
  GitHub API (workflow dispatch, artifact download, PR creation), GitLab API
  (file reads, MR creation) behind `scm/`, LLM qualification & remediation
  (provider-agnostic via the Vercel AI SDK).
- **`packages/cli`** — the `proofhouse-scan` command (commander).
- **`packages/server`** — Fastify API, serves the built web UI.
- **`packages/web`** — Vite + React frontend (TanStack Query, Recharts), plus
  `landing.html`, an optional static landing page.
- **`.github/workflows/scan.yml`** — the scan pipeline. Lives in this repo;
  takes `target_repo` / `target_ref` / `correlation_id` as inputs.
- **`action/`** and **`templates/scan.yml`** — scan from the target's own CI:
  a GitHub composite action and a GitLab CI/CD component, sharing
  `action/scripts/post.mjs`.

Findings are fingerprinted (SARIF `partialFingerprints` when present, else a
line-number-independent hash of scanner + rule + path + snippet; package-based
identity for dependency CVEs) so re-scans update existing rows and track status
transitions: `new → open → resolved → reopened`. Qualifications and
remediations survive re-scans.

## Setup

Prereqs: Node 22+, pnpm, a GitHub account.

1. **Install and build**

   ```sh
   pnpm install
   pnpm build
   ```

2. **Push this repo to GitHub** — the scan workflow runs there:

   ```sh
   gh repo create <you>/proofhouse-scan --private --source=. --push
   ```

3. **Configure `.env`** (copy `.env.example`):
   - `GITHUB_TOKEN` — classic PAT with `repo` + `workflow` scopes
   - `PROOFHOUSE_SCAN_REPO` — `<you>/proofhouse-scan` (where scan.yml lives)
   - For GitLab repos: `GITLAB_TOKENS=gitlab.com=glpat-…,git.corp.io=glpat-…`
     (or `GITLAB_TOKEN` for gitlab.com alone) — `api` scope, Developer role
     on the targets. The GitHub settings are only needed for GitHub repos.
   - `LLM_PROVIDER` / `LLM_MODEL` — default `anthropic` / `claude-opus-5`
   - `LLM_PROVIDER` / `LLM_MODEL` — default `anthropic` / `claude-opus-5`;
     open and self-hosted models are supported too (see [LLM providers](#llm-providers))
   - `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` with `LLM_PROVIDER=openai`)

4. **(Private targets only)** add a repo secret `TARGET_REPO_TOKEN` in the
   proofhouse-scan GitHub repo: a PAT that can read the private target repos.

5. **(GitLab targets)** see [Central scans of GitLab projects](#central-scans-of-gitlab-projects).

## Usage

```sh
pnpm proofhouse-scan scan owner/repo        # dispatch a scan, wait, ingest findings
pnpm proofhouse-scan scan gitlab.com/group/sub/project   # same, on GitLab
pnpm proofhouse-scan list --severity high   # query findings from the terminal
pnpm proofhouse-scan repos                  # scanned repos + open counts
pnpm proofhouse-scan serve                  # web UI at http://localhost:8790

# LLM triage (also available from the web UI)
pnpm proofhouse-scan qualify <finding-id>
pnpm proofhouse-scan remediate <finding-id> # generates a fix and opens a PR
```

For development: `pnpm --filter @proofhouse-scan/server dev` (API) and
`pnpm --filter @proofhouse-scan/web dev` (frontend with proxy) in two terminals.

## Central scans of GitLab projects

The root `.gitlab-ci.yml` is the GitLab counterpart of `scan.yml`. Each GitLab
instance you scan gets its own copy of this repo — a **scan project** — so
the runners doing the work sit next to the targets, even behind a firewall.

1. Push this repo to a **private** project on each instance (e.g.
   `security/proofhouse-scan`). Pushes run nothing; pipelines start only with
   the inputs set by dispatch. Keep it separate from the public component
   project on gitlab.com: pipeline names show which targets were scanned, and
   while artifacts are restricted to Developers (`artifacts:access`), the
   SARIF they hold — secrets included — should not live in a public project.
2. Map each host to its scan project, next to the tokens:

   ```sh
   GITLAB_TOKENS=gitlab.com=glpat-…,git.corp.io=glpat-…
   GITLAB_SCAN_PROJECTS=gitlab.com=you/proofhouse-scan,git.corp.io=security/proofhouse-scan
   ```

   The token's user needs the Developer role on the scan project (to run
   pipelines and read their artifacts).
3. **Private targets:** in the scan project, add a masked CI/CD variable
   `TARGET_REPO_TOKEN` with a token that can read them (`read_repository`).
   Without it the jobs use their job token, which works only for targets that
   list the scan project in Settings → CI/CD → Job token permissions.

`proofhouse-scan scan gitlab.com/group/project [--ref <branch|tag|sha>]` (or
**Rescan** in the UI) creates a pipeline with the target as
[pipeline inputs](https://docs.gitlab.com/ci/inputs/) — GitLab.com blocks
pipeline variables by default on new projects, and inputs are validated by
regex before they reach the job scripts. Requires GitLab 18.1+.
## LLM providers

Triage and remediation use one model, chosen in `.env` (restart to switch).
Each qualification/remediation records the `provider/model` that produced it.

| `LLM_PROVIDER` | Also set | Notes |
|---|---|---|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `LLM_MODEL` defaults to `claude-opus-5` |
| `openai` | `OPENAI_API_KEY`, `LLM_MODEL` | |
| `ollama` | `LLM_MODEL` (e.g. `qwen3-coder:30b`) | `LLM_BASE_URL` defaults to `http://127.0.0.1:11434` |
| `openai-compatible` | `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` if needed | LM Studio, vLLM, llama.cpp, OpenRouter, Groq, Together, ... |

```sh
# Local open model
LLM_PROVIDER=ollama LLM_MODEL=qwen3-coder:30b pnpm proofhouse-scan qualify 42
```

- **Context window (Ollama):** Ollama's default is small and it silently
  truncates the prompt. proofhouse-scan requests `LLM_NUM_CTX=32768` tokens per
  call; remediation sends and returns whole files, so raise it for large files
  (memory use grows with it). Other servers — including Ollama's own `/v1`
  endpoint, so prefer `ollama` for Ollama — set context length server-side.
- **Docker:** inside the container `127.0.0.1` is the container itself — point
  `LLM_BASE_URL` at `http://host.docker.internal:11434` (or the Ollama host).
- **Structured output:** responses must match a JSON schema. The schema is sent
  to the server (Ollama `format`, OpenAI-style `json_schema`); when a model still
  gets it wrong, it is retried once with the validation error, and servers that
  reject `json_schema` get a plain-text attempt with the schema in the prompt.
- **Model size:** small (≤8B) models produce valid JSON but often unreliable
  verdicts and fixes. Prefer ~30B+ coding models for triage, and review PRs
  carefully either way.

## Scan from your own CI (composite action)

Instead of central dispatch, any repo can run the same scanners in its own
workflow and push results to a hosted proofhouse-scan backend:

```yaml
# .github/workflows/proofhouse-scan.yml in the target repo
name: proofhouse-scan
on: [push]
jobs:
  proofhouse-scan:
    runs-on: ubuntu-latest # required (docker is used for GitLeaks)
    concurrency: proofhouse-scan-${{ github.ref }} # avoid out-of-order ingests
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # full history so GitLeaks can scan past commits
      - uses: <you>/proofhouse-scan/action@v1
        with:
          api_url: https://your-proofhouse-scan.example.com
          api_token: ${{ secrets.PROOFHOUSE_SCAN_INGEST_TOKEN }}
          # scanners: opengrep,trivy,gitleaks   # optional subset
          # fail_on: high    # fail the job on NEW findings >= this severity
```

Set the `PROOFHOUSE_SCAN_INGEST_TOKEN` secret in the consumer repo to the same value
as the server's `PROOFHOUSE_SCAN_INGEST_TOKEN` env var. Scans ingested this way show
up with an `action` badge; central-dispatch scans show `dispatch`.

Caveat: prefer one mode (action OR dispatch) per repo — opengrep's SARIF
fingerprints can embed the scanned path, which differs between modes, so
mixing them may double-count the same finding.

## Scan from GitLab CI (CI/CD component)

`templates/scan.yml` is the GitLab counterpart of the composite action: one
job per scanner (in its upstream image, GitLeaks with full history) and a
report job that runs the same `action/scripts/post.mjs`. Requires GitLab 18.7+.

```yaml
# .gitlab-ci.yml in the target project
include:
  - component: $CI_SERVER_FQDN/<you>/proofhouse-scan/scan@1.0.0
    inputs:
      api_url: https://your-proofhouse-scan.example.com
      # stage: test                         # default
      # scanners: opengrep,trivy,gitleaks   # optional subset
      # fail_on: high    # fail the pipeline on NEW findings >= this severity
```

Set `PROOFHOUSE_SCAN_TOKEN` as a **masked** CI/CD variable (Settings → CI/CD →
Variables) to the server's `PROOFHOUSE_SCAN_INGEST_TOKEN`. It is deliberately
not an input: inputs are interpolated into the pipeline configuration. If you
also mark it protected, only protected branches report.

Repos ingested from GitLab are stored host-prefixed, e.g.
`gitlab.com/group/subgroup/project`, so they never collide with a GitHub repo
of the same name.

**Publishing the component** (once, by the proofhouse-scan maintainer):

1. Push this repo to a GitLab project (e.g. add it as a second remote) and
   make it **public** — the report job fetches `post.mjs` from it, pinned to
   the component's commit.
2. Give the project a description and enable Settings → General →
   Visibility → **CI/CD Catalog project**.
3. Push a semver tag (`git tag 1.0.0 && git push gitlab 1.0.0`); the root
   `.gitlab-ci.yml` creates the release that publishes it to the Catalog.

**Self-managed GitLab:** components can only be included from the same
instance. Mirror the project into your instance, publish a release there, and
set the `source_project` input if its path differs from
`JugurthaK/proofhouse-scan`.

The jobs run in every pipeline the project creates. To scan only some of them
— e.g. to avoid two ingests per push from branch and merge request pipelines
— restrict pipelines with your project's `workflow:rules`. Overriding a job's
`rules` replaces the check that honours the `scanners` input.

## Hosting the backend

The server is a single Node process with a SQLite file — deploy it anywhere
with a persistent volume. A multi-stage `Dockerfile` is included:

```sh
docker build -t proofhouse-scan .
docker run -p 8790:8790 -v proofhouse-scan-data:/data \
  -e GITHUB_OAUTH_CLIENT_ID=... -e GITHUB_OAUTH_CLIENT_SECRET=... \
  -e PROOFHOUSE_SCAN_ALLOWED_USERS=alice,bob \
  -e PROOFHOUSE_SCAN_INGEST_TOKEN=$(openssl rand -hex 32) \
  proofhouse-scan
```

- **Web UI sign-in is via GitHub.** Create an OAuth App (GitHub → Settings →
  Developer settings → OAuth Apps → New OAuth App) with the authorization
  callback URL `https://<your-host>/api/auth/github/callback`, then set
  `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` and an allowlist:
  - `PROOFHOUSE_SCAN_ALLOWED_USERS` — comma-separated GitHub logins.
  - `PROOFHOUSE_SCAN_ALLOWED_ORGS` — comma-separated orgs; active members are
    admitted. This makes sign-in request the `read:org` scope, and orgs with
    OAuth App access restrictions must approve the app.

  At least one allowlist is required — the server refuses to start otherwise,
  since GitHub alone would admit every GitHub account. Sessions last 7 days
  (HttpOnly cookie, `Secure` when served over HTTPS). Removing someone from
  the allowlist and restarting revokes their sessions; a user removed from
  an allowlisted org on GitHub keeps access until their session expires.

- For local development against the OAuth flow, register a second OAuth App
  with callback `http://localhost:5173/api/auth/github/callback` (Vite dev
  server) or `http://localhost:8790/api/auth/github/callback` (`serve`).
- `PROOFHOUSE_SCAN_INGEST_TOKEN` protects `POST /api/ingest` (the GitHub
  Action). Ingest never accepts browser sessions, so with GitHub sign-in
  enabled it stays closed until this token is set.
- `PROOFHOUSE_SCAN_API_TOKEN` (optional) is a Bearer token for scripts calling
  the API directly; it no longer signs in to the web UI. Ingest falls back to
  it when no ingest token is set.
- Leave everything unset for a local, open instance.
- Health check endpoint: `GET /api/health` (public).
- **Landing page (optional):** `PROOFHOUSE_SCAN_LANDING=true` serves
  `packages/web/landing.html` at `/` to signed-out visitors, while signed-in
  users still get the dashboard at `/` (same origin, no extra domain needed).
  Requires GitHub sign-in. Its canonical and Open Graph URLs point at
  `https://proofhouse.subjug.tech`; edit them in `landing.html` for another host.
  In development, preview it at `http://localhost:5173/landing.html`.
- Fly.io: `fly launch --no-deploy`, `fly volumes create proofhouse-scan_data`, mount
  it at `/data` in fly.toml (`internal_port = 8790`), then
  `fly secrets set GITHUB_OAUTH_CLIENT_ID=... GITHUB_OAUTH_CLIENT_SECRET=... PROOFHOUSE_SCAN_ALLOWED_USERS=... PROOFHOUSE_SCAN_INGEST_TOKEN=...`.
- To use qualify/remediate/rescan on the hosted instance, also set
  `GITHUB_TOKEN`, `PROOFHOUSE_SCAN_REPO` (GitHub repos) and/or `GITLAB_TOKENS`
  (GitLab repos), and your LLM key there; without them the instance is
  ingest + dashboard only.
- SQLite means one machine — do not scale horizontally.
- Auth config changes require a server restart (env is read at startup).

## Testing with the fixture repo

`fixtures/proofhouse-scan-fixture/` is a deliberately vulnerable mini-app (SQLi, XSS,
vulnerable lodash, root Dockerfile, public S3 bucket, an AWS key committed and
then deleted so it only exists in git history, and a false-positive-shaped
snippet in a test file).

```sh
cd fixtures/proofhouse-scan-fixture && ./setup.sh
cd repo && gh repo create <you>/proofhouse-scan-fixture --private --source=. --push
pnpm proofhouse-scan scan <you>/proofhouse-scan-fixture
```

Expected: scan twice → all findings go `new` → `open`; fix one and re-scan →
it becomes `resolved`. Qualifying the test-file finding should yield
`false_positive`; the SQLi in `src/server.js` should yield `true_positive`.

## Notes

- Remediation PRs replace whole files (the LLM returns full file contents; the
  diff shown in the UI is computed locally). Review before merging.
- A leaked-secret fix PR removes the secret from code, but the credential must
  still be rotated — the PR body says so.
- Fine-grained PATs don't work for the fork-based PR path; use a classic PAT.
- GitLab fix MRs are pushed directly, so the token's user needs at least the
  Developer role on the project; there is no fork fallback. A protected
  `proofhouse-scan/*` branch pattern would also block the push.
