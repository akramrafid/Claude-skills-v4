# Architecture Blueprint (v4 — Vercel target, no Docker)

## 1. Default stack (use unless TASK.md mandates otherwise; deviate only with an ADR)
| Layer | Default | Why |
|---|---|---|
| API | Python 3.12 · FastAPI · Pydantic v2 · httpx · tenacity · `uv` | Best AI ecosystem, typed contracts, auto OpenAPI |
| LLM access | One adapter over the `openai` SDK with configurable `base_url` (any OpenAI-compatible endpoint, e.g. Gemini's `/v1beta/openai/`); native SDK only for provider-specific features | Swap providers by config; one code path |
| Relational DB | Postgres on **Neon** (branches: `main` = prod, `dev`, `test`) · SQLAlchemy 2 async · Alembic | Serverless-friendly, free, same engine everywhere |
| Vectors | **pgvector** in the same Neon DB by default · **Qdrant Cloud** when TASK.md asks for Qdrant, heavy filtering/hybrid search, or > ~1M chunks | Fewer services by default |
| Cache / rate limits | In-process (per instance) for the demo · Upstash Redis via Vercel Marketplace only if limits must be global | |
| Frontend | Next.js (App Router) · TypeScript strict · Tailwind · shadcn/ui · TanStack Query · `openapi-typescript` + `openapi-fetch` | Typed against the contract |
| Deploy | **Vercel**: one project for `apps/web`, one for `apps/api` (FastAPI zero-config) | No Docker, no servers |
| Task runner | Root `package.json` scripts (work in PowerShell and bash) | Cross-platform |
| Tests | pytest · Schemathesis (contract) · Playwright (e2e) · k6 (load) · house eval runner | See roles 9–13 |

Mandated other stack → same layering and gates: Node/TS API = Fastify/NestJS + zod + Drizzle/Prisma;
contract tests still run Schemathesis against its OpenAPI.

## 2. Environments and where state lives
| Store | dev (laptop) | test (`APP_ENV=test`, used by gates) | production (Vercel) |
|---|---|---|---|
| Postgres | Neon `dev` branch → `DATABASE_URL` | Neon `test` branch → `TEST_DATABASE_URL` (SQLite file only if the app has no Postgres) | Neon `main` → `PROD_DATABASE_URL` (pushed to Vercel as `DATABASE_URL`) |
| Vectors | same DB (pgvector) or Qdrant Cloud collection `<name>_dev` (or Qdrant local mode `.data/qdrant`) | in-memory, auto-seeded from `apps/api/tests/fixtures/corpus/` | pgvector in prod DB or Qdrant Cloud `<name>_prod` |
| LLM | real provider | deterministic mock (`LLM_MOCK` forced) | real provider + fallback |
| Files | `.data/` (gitignored) | temp dir | none on disk — object storage if needed |
`APP_ENV=production` refuses mock mode and missing credentials at startup. `APP_ENV=test` refuses to start
when the `VERCEL` environment variable is set. Ingestion into production stores runs from a laptop CLI
(`npm run ingest -- --target prod`) after human approval — never inside a request.

## 3. Architecture style and repository layout (seat → paths it may edit)
**Style (ADR-0001, fixed unless TASK.md forbids it):** modular monolith, one deployable API + one web app.
Inside, code is cut into **vertical slices** — one folder per MUST capability (`ask`, `ingest`, `report`…)
holding its contract, router, service, prompts and tests. Outside services (LLM, embeddings, vector store,
DB) sit behind **ports** (Python `Protocol`s) with real and fake **adapters**. The Clean Architecture rule
is kept where it pays: `service.py` imports only ports, schemas and `shared/` — never FastAPI, SDKs or ORM.
Why: one worker can own one slice end to end with no file collisions, a slice can be cut without touching
the others, and fakes make every slice testable offline.

Slice rules (code review checks these):
1. A feature never imports another feature. Logic used by 2+ slices moves to `app/shared/` (CORE).
2. `router.py` is thin: parse → call service → map errors. No business logic, no SDK calls.
3. `service.py` gets its dependencies through `deps.py` (FastAPI `Depends`) as ports, so tests swap fakes.
4. `schemas.py` is the contract. Only LEAD edits it; a change is re-exported and broadcast.
5. LEAD mounts each feature's router in `main.py`. Feature folders never edit `main.py`.

```
package.json, .env.example, contracts/openapi.json       LEAD
docs/PRD.md · docs/architecture.md · docs/adr/            LEAD (roles 1, 3)
docs/system-design.md                                     DESIGN (role 4)
docs/ux/                                                  UI   (role 2)
docs/ai-design.md · docs/llmops.md                        CORE (roles 5, 15)
docs/data-pipeline.md · docs/data-model.md                DATA (roles 6, 7)
docs/test-plan.md · docs/deploy.md · docs/demo.md · docs/dry-run.md · README.md   QA (roles 12, 14, 16)
docs/threat-model.md                                      REVIEWER-SEC (role 13)
apps/api/
  pyproject.toml, uv.lock, .python-version   LEAD  ([tool.vercel] entrypoint = "app.main:app")
  app/__main__.py        LEAD  runner: python -m app [--env test] [--port N] [--no-reload]
  app/main.py            LEAD  create_app(); mounts every features/<name>/router; module-level `app`
  app/export_openapi.py · app/healthcheck.py   LEAD
  app/core/              LEAD  config, logging, errors, middleware, security, rate limits, db_url
  app/ports/             LEAD  llm.py, embeddings.py, vector_store.py, repositories.py (Protocols only)
  app/features/<name>/   one folder per capability:
    schemas.py           LEAD  request/response models = the API contract for this slice
    router.py · service.py · deps.py · prompts/    CORE worker core-<name> (roles 5, 9)
  app/shared/            CORE  logic used by 2+ slices (retrieval.py, citations.py…) — one owner at a time
  app/adapters/          CORE  llm.py (LLMClient: timeouts, retries, fallback, traces), fake_llm.py, embeddings.py,
                               vectorstore.py (pgvector | Qdrant), in-memory store for tests — each implements a port
  app/adapters/db/       DATA  SQLAlchemy models, repositories implementing ports/repositories.py
  app/observability/     CORE  trace records, sinks, pricing, metrics (role 15)
  app/ingest/            DATA  load → parse → chunk → embed → upsert + CLI (role 6)
  migrations/ · scripts/seed.py · scripts/db_check.py    DATA (role 7)
  tests/features/<name>/ slice owner  · tests/integration/ QA · tests/fixtures/ QA (test corpus, fake LLM replies)
  evals/                 QA    run.py, datasets/, rubrics/, results/, history.jsonl, config.json (role 11)
  evals/retrieval.py · evals/datasets/retrieval.jsonl     DATA (role 6)
  evals/redteam.py · evals/redteam/                       REVIEWER-SEC (role 13)
apps/web/                UI    Next.js (role 10):
  src/app/               thin routes/pages that compose features (layout.tsx: LEAD)
  src/features/<name>/   components, hooks, api.ts — worker ui-<name>
  src/components/ui/     shadcn primitives (first UI worker; others ask LEAD)
  src/lib/api/           generated schema.d.ts + typed client
  e2e/<name>.spec.ts     slice owner
scripts/smoke.mjs        QA    golden-path smoke for local or deployed URLs
tests/load/              QA    k6 scripts (role 12)
.github/workflows/ci.yml LEAD  optional: runs `npm run ci`
data/                    DATA  provided datasets (read-only for everyone else)
```
Ports: LEAD api 8000 · core workers 8001, 8002 · ui web 3001 (+ api 8003) · Playwright 3011/8011 ·
`with-server.mjs` picks a free port by itself.

## 4. Contract-first, code-first export
1. LEAD writes Pydantic models in `app/features/<name>/schemas.py`, the port Protocols in `app/ports/`, and a
   stub `router.py` per feature returning schema-valid mock data. Every
   route declares its error responses (`responses={422: ..., 429: ..., 502: ...}` with the problem+json
   model) so contract tests can check status codes.
2. `npm run contracts` → `contracts/openapi.json` (commit). Schema change → re-export → commit → broadcast.
3. UI: `npx openapi-typescript ../../contracts/openapi.json -o src/lib/api/schema.d.ts` + `openapi-fetch`.
4. A drift test fails when code and the committed contract differ.

## 5. Root `package.json` (LEAD creates it in the skeleton)
```json
{
  "name": "hackathon-app",
  "private": true,
  "scripts": {
    "bootstrap": "npm install && npm --prefix apps/web install && cd apps/api && uv sync && uv run alembic upgrade head && uv run python -m scripts.seed",
    "up": "npm run bootstrap && npm run dev",
    "dev:api": "cd apps/api && uv run python -m app",
    "dev:api:test": "cd apps/api && uv run python -m app --env test --port 8011 --no-reload",
    "dev:web": "npm --prefix apps/web run dev --",
    "dev": "concurrently -k -n api,web -c blue,green \"npm:dev:api\" \"npm:dev:web\"",
    "contracts": "cd apps/api && uv run python -m app.export_openapi ../../contracts/openapi.json",
    "healthcheck": "cd apps/api && uv run python -m app.healthcheck",
    "db:migrate": "cd apps/api && uv run alembic upgrade head",
    "db:check": "cd apps/api && uv run python -m scripts.db_check",
    "seed": "cd apps/api && uv run python -m scripts.seed",
    "ingest": "cd apps/api && uv run python -m app.ingest.cli",
    "lint": "cd apps/api && uv run ruff check . && uv run ruff format --check . && cd ../.. && npm --prefix apps/web run lint --if-present",
    "typecheck": "cd apps/api && uv run pyright && cd ../.. && npm --prefix apps/web run typecheck --if-present",
    "test:api": "cd apps/api && uv run pytest -q",
    "test:web": "npm --prefix apps/web run test --if-present",
    "test": "npm run test:api && npm run test:web",
    "test:contract": "node .orca-team/tools/with-server.mjs -- uvx schemathesis run {API}/openapi.json --checks all --max-examples 25",
    "e2e": "npm --prefix apps/web run e2e",
    "eval": "cd apps/api && uv run python -m evals.run --split heldout",
    "eval:dev": "cd apps/api && uv run python -m evals.run --split dev",
    "eval:baseline": "cd apps/api && uv run python -m evals.run --split all --tag baseline",
    "eval:retrieval": "cd apps/api && uv run python -m evals.retrieval",
    "redteam": "cd apps/api && uv run python -m evals.redteam",
    "load": "node .orca-team/tools/with-server.mjs --env LLM_MOCK_LATENCY_MS=300 -- k6 run -e API={API} tests/load/smoke.js",
    "check:traces": "cd apps/api && uv run pytest -q -m tracing",
    "smoke": "node scripts/smoke.mjs",
    "smoke:local": "node .orca-team/tools/with-server.mjs -- node scripts/smoke.mjs --api {API}",
    "ci": "npm run lint && npm run typecheck && npm run test && npm run smoke:local",
    "gates": "node .orca-team/tools/gates.mjs all"
  },
  "devDependencies": { "concurrently": "^9.0.0" }
}
```
`npm run ci` is the fast merge gate (minutes). `npm run gates` runs every role's check (contract, e2e,
evals, load, red team, …) at review rounds and before promotion. Never use `VAR=x cmd` in scripts (fails on
Windows) — use runner flags such as `--env test`.

## 6. Runner `app/__main__.py`
```python
import argparse, os

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=int(os.getenv("API_PORT", "8000")))
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--env", choices=["dev", "test", "production"], default=None)
    p.add_argument("--no-reload", action="store_true")
    a = p.parse_args()
    if a.env:
        os.environ["APP_ENV"] = a.env          # set before the app (and its settings) are imported
    import uvicorn
    uvicorn.run("app.main:app", host=a.host, port=a.port, reload=not a.no_reload)

if __name__ == "__main__":
    main()
```
`app/main.py` ends with `app = create_app()` so Vercel and uvicorn load the same object.

## 7. Archetypes — pick one or combine (record as an ADR)
**A. RAG / knowledge assistant** — offline ingestion, hybrid retrieval + rerank, streamed answer with
citations and "I don't know". Roles 5, 6 heavy. `POST /api/v1/ask` (SSE), `GET /api/v1/sources`.
**B. Agentic workflow / tool use** — bounded loop, typed tool registry, approval gate for side effects,
run trace. `POST /api/v1/runs`, `GET /api/v1/runs/{id}`, `POST /api/v1/runs/{id}/approve`.
**C. Document / data extraction** — parse/OCR → schema-constrained extraction → validation → review UI →
export. Eval: field-level accuracy.
**D. Assistant with memory** — sessions in Postgres, rolling summary, persona prompt files, guardrails.
**E. NL → SQL / analytics** — schema introspection, SELECT-only allow-list, read-only role, LIMIT, timeout.
**F. Multimodal / voice** — media upload, preprocessing, strict latency budget; heavy models stay behind APIs
(Python bundle limit on Vercel is 500 MB).
**G. Search / recommendation** — embeddings + filters + explanations. Eval: precision@k.
**H. Classification / triage at volume** — structured labels + confidence, thresholds, review queue,
confusion matrix. Eval: per-label precision/recall.
**I. Fine-tuning** — only if required; strong baseline first; serve behind the same API.

## 8. Serverless rules (Vercel)
Functions run up to 300 s by default on Fluid compute · Python bundle ≤ 500 MB (no torch; use API embeddings
and rerankers) · only `/tmp` is writable and it is ephemeral · FastAPI lifespan events are supported ·
streaming (`StreamingResponse`, SSE) is supported · no fire-and-forget work after the response · keep imports
light for cold starts · env var changes need a redeploy · preview URLs are behind Vercel Authentication, the
production domain is public.
