---
name: vercel-deploy
description: Role 14 (Ship hat) - platform and deployment on Vercel, no Docker or servers. Prepares the monorepo for two Vercel projects (FastAPI API with zero-config entrypoint, Next.js web), managed state (Neon Postgres, Qdrant Cloud or pgvector), pushes environment variables from .env without printing them, deploys to production only after the human approves, wires CORS and the public API URL, verifies with the smoke script against the live URLs, documents rollback, and proves a fresh clone runs with one command. Use when preparing or performing a deployment, when env vars change, or when a deployed URL misbehaves. Done check - node .orca-team/tools/gates.mjs fresh-clone and gates.mjs deploy.
---

# Vercel Deploy — Role 14 · Ship hat

**Seat:** QA prepares (models: `swarm-lead/references/model-routing.md`); LEAD runs the deploy commands after the human says yes.
**Independent check:** OUTSIDER opens the live URL during the dry run (role 16). **Hand-off:**
`docs/deploy.md`, `.orca-team/deploy.json` (`{"api_url": "...", "web_url": "..."}`), live URLs in README.
**Done when:** `gates.mjs fresh-clone` and `gates.mjs deploy` pass.

Public deploys, production data writes and spending money are irreversible → always ask the human first
(LEAD does this). Agents never handle Vercel tokens: the human runs `vercel login` once.

## 1. Topology
| Vercel project | Root folder | Framework | Needs |
|---|---|---|---|
| `<app>-api` | `apps/api` | FastAPI (zero-config, `[tool.vercel] entrypoint = "app.main:app"`) | `APP_ENV=production`, LLM keys, `DATABASE_URL` (Neon main, pooled), vector DB URL/key, `CORS_ORIGINS`, `CANARY` |
| `<app>-web` | `apps/web` | Next.js | `NEXT_PUBLIC_API_BASE_URL` (baked at build time) |
State lives only in managed services. Ingest/seed production stores from a laptop with
`npm run ingest -- --target prod` (human approval) — never at request time.

## 2. Pre-flight (no deploy yet — any agent can do this)
- `apps/api`: `pyproject.toml` with runtime deps only, committed `uv.lock`, `.python-version` (`3.12`),
  `[tool.vercel]` entrypoint, **no** stray `requirements.txt` next to `pyproject.toml`; nothing heavy
  (Python bundle ≤ 500 MB: no torch/transformers; use API embeddings).
- `APP_ENV=production` boots with mock disabled and fails fast on missing env vars (`require_runtime`).
- `/healthz` and `/readyz` work; CORS reads `CORS_ORIGINS` (+ optional `CORS_ORIGIN_REGEX`).
- `apps/web`: `npm run build` passes with `NEXT_PUBLIC_API_BASE_URL` set; no secrets in client code.
- `.vercel/` is gitignored. CLI: `npm i -g vercel`; the human: `vercel login`.
- Fresh-clone proof: `node .orca-team/tools/gates.mjs fresh-clone` (clones to a temp folder, copies `.env`
  without reading it, runs `npm run bootstrap` and `npm run ci`).

## 3. Deploy (LEAD, after the human approves)
```
cd apps/api
vercel link --yes --project <app>-api
node ../../.orca-team/tools/vercel-env.mjs push --cwd . --env production \
  --keys LLM_API_KEY,LLM_BASE_URL,LLM_MODEL,LLM_FALLBACK_MODEL,CANARY \
  --map DATABASE_URL=PROD_DATABASE_URL,QDRANT_URL=PROD_QDRANT_URL,QDRANT_API_KEY=PROD_QDRANT_API_KEY \
  --set APP_ENV=production
vercel deploy --prod --yes                       # note the production URL, e.g. https://<app>-api.vercel.app
cd ../web
vercel link --yes --project <app>-web
node ../../.orca-team/tools/vercel-env.mjs push --cwd . --env production --set NEXT_PUBLIC_API_BASE_URL=<api url>
vercel deploy --prod --yes                       # → https://<app>-web.vercel.app
cd ../api
node ../../.orca-team/tools/vercel-env.mjs push --cwd . --env production --set CORS_ORIGINS=<web url>
vercel deploy --prod --yes                       # env changes need a redeploy
```
`vercel-env.mjs` reads values from `.env`, pipes each one to `vercel env add <NAME> production --force`
through stdin and prints only names. `--map NAME=ENVKEY` uploads the value of `ENVKEY` as `NAME`.

## 4. Verify and record
`node scripts/smoke.mjs --api <api url> --web <web url>` → all PASS · `/readyz` shows every dependency ok ·
`vercel logs <url>` has no errors · write both URLs to `.orca-team/deploy.json`, README and `docs/deploy.md`
(what is deployed where, env var names, how to redeploy, how to roll back) → `gates.mjs deploy`.

## 5. Rollback and pitfalls
Rollback: `vercel rollback` (or promote a previous deployment in the dashboard), then smoke again.
Pitfalls: preview URLs sit behind Vercel Authentication — judges get the **production** domain; automated
checks on previews need `VERCEL_AUTOMATION_BYPASS_SECRET` (smoke sends `x-vercel-protection-bypass`) ·
`NEXT_PUBLIC_*` changes need a rebuild · functions default to 300 s max · only `/tmp` is writable ·
SSE works with `StreamingResponse` · Neon pooled URL + NullPool · cold starts: keep imports light.

## The checks
`gates.mjs fresh-clone` — temp clone + `.env` copy + `npm run bootstrap` + `npm run ci`.
`gates.mjs deploy` — reads `.orca-team/deploy.json` and runs the smoke script against both URLs.

## Pair with
`deploy-to-vercel` (optional external skill, `--only vercel-deploy`; this skill wins on conflicts) ·
`verification-before-completion`.

## Anti-patterns
Docker or self-managed servers · `vercel deploy` without approval · pasting secrets into commands or chat ·
SQLite or local files in production · forgetting the API redeploy after CORS changes · judges on a preview URL.
