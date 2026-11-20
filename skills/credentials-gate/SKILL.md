---
name: credentials-gate
description: How LEAD discovers every credential and external service the project needs (app LLM keys, an eval judge key from another provider, Neon Postgres branches, Qdrant Cloud or pgvector, Vercel login, object storage, auth, third-party APIs, observability), prefers mock or test-mode alternatives while waiting, writes .env.example, asks the human once in a fixed format, verifies keys without ever reading or printing values, gates dependent tasks and distributes .env to worktrees. Use at intake and whenever any worker reports a missing key.
---

# Credentials Gate

Credentials come **only from the human**. Agents never invent, guess, reuse from memory, print, log, commit,
or put secrets into prompts. Only LEAD asks the human; workers ask LEAD (`orca orchestration ask`).
The human writes secret values **directly into the main `.env` file**, never into chat.

## 1. Inventory (5 minutes, from TASK.md + the architecture)
| Category | Variables | While missing |
|---|---|---|
| App LLM (required for real output) | `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_FALLBACK_MODEL` | `APP_ENV=test` / `LLM_MOCK=1` |
| Eval judge (other family than `LLM_MODEL`) | `EVAL_JUDGE_BASE_URL`, `EVAL_JUDGE_API_KEY`, `EVAL_JUDGE_MODEL` | deterministic checks only; gate warns |
| Embeddings | `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` | mock hash embeddings in test mode |
| Postgres (Neon project with branches) | `DATABASE_URL` (dev), `TEST_DATABASE_URL` (test), `PROD_DATABASE_URL` (main) | SQLite for dev/test only — blocks deploy |
| Vector DB | pgvector (no extra key) or `QDRANT_URL`/`QDRANT_API_KEY` (+ `PROD_QDRANT_URL`/`PROD_QDRANT_API_KEY`) | Qdrant local mode `.data/qdrant`, in-memory in tests |
| Deploy (Vercel) | none in `.env` — the human runs `vercel login` once | local demo |
| Rate limits (optional) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | in-process limiter |
| Object storage (if uploads) | `BLOB_READ_WRITE_TOKEN` or `S3_*` | parse in request, store text only |
| Auth (if users) | `AUTH_SECRET`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | seeded demo user |
| Ops | `OPS_TOKEN` (generated), `CANARY` (generated), `LLM_DAILY_BUDGET_USD` | — |
| Observability (optional) | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | stdout + Postgres traces |
| Third-party APIs in TASK.md | `<VENDOR>_API_KEY` | recorded fixtures |

Decision rules:
- **The app's LLM key is separate from the coding agents.** Claude Pro, Google AI Pro and OpenCode Go power
  the agents; the product needs its own API key (hackathon credits, Google AI Studio — OpenAI-compatible at
  `https://generativelanguage.googleapis.com/v1beta/openai/`, OpenAI, Anthropic API, OpenRouter).
- Ask for a **second provider** for the eval judge if possible (builders and checkers on different models).
- Random values that no provider issues (`OPS_TOKEN`, `CANARY`, `AUTH_SECRET`): generate them yourself with
  `node .orca-team/tools/envtool.mjs gen OPS_TOKEN CANARY` — fills empty keys in the main `.env`, prints
  names only. Never ask the human for these.
- Deploy target Vercel + any stored state → Neon is required (SQLite and local Qdrant files don't persist).

## 2. `.env.example` (committed) — every variable, no real secrets
```
# --- App LLM (REQUIRED) ---
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/   # any OpenAI-compatible endpoint
LLM_API_KEY=                     # secret — provider console
LLM_MODEL=                       # model id from your provider
LLM_FALLBACK_MODEL=              # optional — different provider/model if possible
# --- Eval judge (different family from LLM_MODEL) ---
EVAL_JUDGE_BASE_URL=             # optional — e.g. https://api.openai.com/v1
EVAL_JUDGE_API_KEY=              # optional — secret
EVAL_JUDGE_MODEL=                # optional
# --- Postgres on Neon (one project, three branches) ---
DATABASE_URL=                    # dev branch, pooled connection string
TEST_DATABASE_URL=               # test branch, pooled — tests and db:check wipe it
PROD_DATABASE_URL=               # optional — main branch; only pushed to Vercel, never used locally
# --- Vector DB (skip if pgvector) ---
QDRANT_URL=                      # optional — Qdrant Cloud cluster URL
QDRANT_API_KEY=                  # optional — secret
# --- Ops ---
OPS_TOKEN=                       # optional — random string, protects /ops metrics
CANARY=                          # optional — random string placed in the system prompt for leak tests
LLM_DAILY_BUDGET_USD=5           # optional
APP_ENV=dev
```
Conventions: a comment containing `optional` marks an optional key; empty = missing; `changeme`, `your-key`,
`xxx`, `<...>` count as placeholders.

## 3. Prepare the human's `.env` and CREDENTIALS.md
```
node .orca-team/tools/envtool.mjs init          # creates/updates the MAIN folder's .env (never prints values)
node .orca-team/tools/envtool.mjs where         # path the human must edit
node .orca-team/tools/envtool.mjs check --main  # MISSING / EMPTY / PLACEHOLDER / OK per variable, names only
```
`.orca-team/CREDENTIALS.md` → variable · service · why · required? · alternative · status.

## 4. Ask the human ONCE (exact format, early)
```
🔑 CREDENTIALS NEEDED — fill these in <path from envtool where>, then reply "creds done".
Don't paste secrets here in chat.

REQUIRED
1. LLM_API_KEY + LLM_MODEL (+ LLM_BASE_URL) — the app's own model. Get it: <provider console>.
2. Neon Postgres (free): neon.tech → New project → Branches: create "dev" and "test" →
   Connect → copy the *pooled* connection string of each branch →
   DATABASE_URL = dev, TEST_DATABASE_URL = test. (Main branch → PROD_DATABASE_URL, needed only for deploy.)

OPTIONAL (I use the alternative if you skip)
3. EVAL_JUDGE_* — a second provider so a different model family grades our AI. Skip → weaker evals.
4. QDRANT_URL + QDRANT_API_KEY — Qdrant Cloud free cluster. Skip → pgvector / local mode.
5. Vercel: run `npm i -g vercel` then `vercel login` once in a terminal — only when we deploy.

To skip one: reply "skip <VAR> → mock" (or "→ local").
Meanwhile I'm continuing with everything that doesn't need these.
```
Repeat (shorter) at the end of your turn if still missing. Never block the swarm on it.

## 5. Gate, verify, distribute
- Tasks needing missing keys: `orca orchestration gate-create --task <id> --reason "waiting for credentials: ..."`;
  builders work in test mode meanwhile.
- "creds done" → `envtool check --main` → `npm run healthcheck` (one tiny call per service; prints name,
  OK/FAIL, latency — never values) → `gate-resolve --gate <id> --decision approve`.
- New worktrees get `.env` via `.worktreeinclude`; existing ones: `orca orchestration send --to @all
  --subject ".env updated" --body "run: node .orca-team/tools/envtool.mjs sync"`.
- Vercel env vars are pushed only by `vercel-env.mjs` (role 14), which reads `.env` and prints names only.

## 6. Rules that never bend
- Never `cat`/open/print `.env`; never echo env vars; no secrets in logs, errors, fixtures, screenshots,
  commits, PR text, prompts, or `NEXT_PUBLIC_*`. Redact in logs (`sk-…` → `***`).
- Least privilege and sandbox keys where offered. Production DB (`PROD_DATABASE_URL`) is touched only by the
  approved deploy/ingest steps.
- Exposed secret → stop, tell the human which variable, they rotate it, purge it, continue after rotation.
- `.env` stays gitignored; before each commit `git diff --cached --name-only` must not list `.env`.
