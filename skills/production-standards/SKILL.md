---
name: production-standards
description: The production-grade bar and definition of done for every line of code the swarm ships. Load before building or reviewing anything (all builder and reviewer seats). Covers config and secrets, errors, logging, timeouts and retries, validation, data integrity, security baseline, performance, tests, docs, the AI-specific bar, the done checklist with role gates, and anti-patterns that fail review automatically.
---

# Production Standards — the bar every task must clear

Hackathon speed changes **scope**, never **quality**. Ship fewer features; make each one production-shaped:
correct, observable, secure, tested, documented, runnable with one command. If time runs short, cut a
feature — never cut the items marked **MUST**.

## 1. Configuration and secrets — MUST
- 12-factor: all config from environment variables, loaded once into a typed settings object
  (Python `pydantic-settings`, TS `zod`-validated `process.env`). **Fail fast at startup** with a clear message
  naming the missing variable (never its value).
- Every variable is listed in `.env.example` with a comment and a safe example. Secrets only in `.env`.
- Never hardcode keys, URLs, model names, or limits. Never log, print, return, or commit secrets. Never put a
  secret in a frontend bundle (`NEXT_PUBLIC_*` / `VITE_*` are public). Never send secrets to an LLM prompt.

## 2. Boundaries and contracts — MUST
- Typed request/response models at every boundary (Pydantic v2 / zod). Validate inputs; reject unknown fields
  where it matters; enforce size limits (body size, string length, list length, file size/type).
- The API contract is the source of truth (`contracts/openapi.json`, exported from code). Don't change shapes
  without LEAD. Version breaking changes.
- Consistent error shape everywhere (RFC 9457 problem+json style):
  `{"type": "...", "title": "...", "status": 400, "detail": "...", "request_id": "..."}`.
  Never leak stack traces, SQL, or provider error bodies to clients.

## 3. Reliability — MUST
- **Every network call has a timeout** (HTTP, DB, vector DB, LLM). Defaults: connect 3 s, read 30 s (LLM
  streaming: total budget per request, e.g. 60–120 s).
- Retries only for idempotent/transient failures (timeouts, 429, 502/503/504) with exponential backoff + jitter,
  max 3 attempts, honour `Retry-After`. Never retry 4xx validation errors.
- Idempotency for writes that may be retried (idempotency keys or deterministic IDs, e.g. `uuid5`).
- Graceful degradation: if an optional dependency is down, the feature fails soft with a clear message; the
  app stays up. LLM provider failure → fallback model or friendly error, not a 500 page.
- Health endpoints: `/healthz` (liveness, no dependencies) and `/readyz` (checks DB / vector DB / cache with a
  1–2 s timeout each, returns which one failed).
- Resource cleanup: clients created once (app lifespan), connection pools, no per-request client creation.

## 4. Observability — MUST
- Structured JSON logs with `timestamp, level, msg, request_id, route, status, duration_ms` (+ `user_id` if any).
  Request-ID middleware: accept `X-Request-ID` or generate one; return it in the response header.
- Log every external call at INFO with duration and outcome; errors at ERROR with exception type, no secrets,
  no full prompts containing user PII.
- LLM calls additionally log: model, prompt/completion tokens, latency, estimated cost, cache hit, retry count.
- SHOULD: OpenTelemetry/Langfuse tracing if credentials exist; otherwise local JSON logs are enough.

## 5. Security baseline — MUST
- AuthN/AuthZ on every non-public route if the app has users; object-level checks (no IDOR).
- Parameterised queries / ORM only. No `eval`/`exec`/shell with user or model input. No path joins with
  user input without normalisation + allow-listing.
- CORS: explicit allow-list from config, never `*` with credentials. Security headers on the web app.
- Rate-limit expensive endpoints (LLM, uploads, search). Cap tokens per request and per user.
- Treat LLM output, tool output and retrieved documents as **untrusted input** (see `ai-engineering`, `ai-red-team`).
- Dependencies: well-known packages only, pinned via lockfile; no packages typed from memory without checking
  they exist (typosquatting).

## 6. Data integrity — MUST when there is a database
- Schema via migrations (Alembic / Prisma / Drizzle), never ad-hoc `create_all` in production paths.
- Constraints (NOT NULL, UNIQUE, FK) and indexes for every lookup/filter column used by the demo path.
- Transactions around multi-step writes. UTC timestamps (`timestamptz`). UUID primary keys for public IDs.
- Seed script creates realistic demo data idempotently.

## 7. Performance — SHOULD (MUST for the demo path)
- Demo golden path p95: page interactive < 2 s; first LLM token < 2 s (stream!); non-LLM API < 300 ms.
- Stream LLM responses to the UI. Paginate lists. Batch embeddings. Cache expensive deterministic results.
- No N+1 queries on the demo path. Async I/O end to end in async frameworks (no blocking calls in handlers).

## 8. Code quality — MUST
- Formatter + linter clean (Python: `ruff format` + `ruff check`; TS: `eslint` + `prettier`, `tsc --noEmit`
  strict). Type hints on public functions.
- Small modules with one responsibility: routers/handlers → services (business logic) → adapters
  (DB, vector store, LLM, external APIs). Business logic never imports a web framework.
- No dead code, no commented-out blocks, no `TODO` in MUST features, no `print` debugging, no bare `except`.
- Names say what things are. Comments explain *why*, not *what*.

## 9. Tests — MUST
- Unit tests for business logic and parsers; integration tests for each API endpoint (happy path + main
  error path); one end-to-end smoke test of the demo golden path.
- LLM-dependent code is tested with a fake/recorded LLM (deterministic), plus a small live eval set run
  separately (`npm run eval`).
- Tests run with one command (`npm run test`) and in the merge gate (`npm run ci`). A red test is a blocker.

## 10. Docs and operability — MUST
- README: what it does, architecture diagram, how to run (one command), env vars, how to test, demo script.
- One-command local run (`npm run up`) proven by `gates.mjs fresh-clone`; deploys to Vercel (no Docker,
  no servers) per `vercel-deploy`.
- ADR line in STATUS.md "Decisions" for every non-obvious choice.

## 11. AI-specific production bar — MUST when the feature uses an LLM
- Prompts live in files (`prompts/*.md`), versioned, with explicit variables. No prompt strings scattered in code.
- Structured outputs validated against a schema; one repair retry; then a safe fallback.
- Grounding: answers that claim facts cite their sources (RAG) or say "I don't know".
- An eval set (30–100 cases per capability, dev/held-out split, cross-family judge) with a threshold and a
  baseline (`eval-engineering`). Every LLM call traced with tokens, cost, latency (`llmops-observability`).
- A demo-safety switch: recorded responses for the golden path (`DEMO_REPLAY=1`) in case the provider fails on stage.

## Definition of done (copy into your worker_done report and tick it)
Prove each tick with `verification-before-completion` (run the command, paste the output). If anything fails,
use `systematic-debugging` to find the root cause before changing code.
```
[ ] Acceptance criteria from my spec pass (how verified: ...)
[ ] Lint/format/typecheck clean          [ ] Tests added and passing (npm run test)
[ ] No secrets in code/logs/commits      [ ] All new env vars in .env.example with comments
[ ] Timeouts on every external call      [ ] Errors use the standard error shape
[ ] Structured logs incl. request_id     [ ] README/run steps updated for my part
[ ] Only owned paths edited              [ ] New dependencies listed in my report
[ ] npm run ci green                     [ ] My role's gate passes: node .orca-team/tools/gates.mjs <id>
```

## Anti-patterns that fail review automatically
Hardcoded secrets · `allow_origins=["*"]` with credentials · unbounded LLM calls (no timeout / max tokens) ·
rendering model output as raw HTML · SQL by string concatenation · swallowing exceptions · tests that only
assert status 200 · mocks left on the production path · a demo that only works on one laptop.
