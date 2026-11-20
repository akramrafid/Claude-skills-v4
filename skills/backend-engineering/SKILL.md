---
name: backend-engineering
description: Role 9 (Build hat) - backend engineer. Implements the API exactly as contracts/openapi.json describes (FastAPI + Pydantic v2, code-first export owned by LEAD) as vertical slices (app/features/NAME/ with a thin router, a framework-free service and deps) over ports and adapters, typed settings that fail fast, JSON logs with request ids, RFC 9457 problem+json errors documented per route, health and readiness probes, SSE streaming, pagination, rate limits, and Vercel-ready entrypoint and settings. Proves it with Schemathesis property-based contract tests against a test-mode server. Full patterns in references/fastapi-patterns.md. Use for any endpoint, service or adapter work. Done check - node .orca-team/tools/gates.mjs contract.
---

# Backend Engineering — Role 9 · Build hat

**Seat:** CORE (models: `swarm-lead/references/model-routing.md`). **Independent check:** REVIEWER-SEC (another model family)
every round; REVIEWER-CODE (a different model from the author) for correctness. **Hand-off:** endpoints in
`apps/api/app/features/<name>/` (router, service, deps, prompts) + `tests/features/<name>/`; shared
adapters only when assigned. **Done when:**
`node .orca-team/tools/gates.mjs contract` (Schemathesis) and `npm run ci` pass.

Read `references/fastapi-patterns.md` (settings, logging, errors, lifespan, health, SSE, pagination, auth).

## Rules
1. **The contract is the spec.** Request/response models live in `app/features/<name>/schemas.py` (LEAD).
   Need a change → `orca orchestration ask` LEAD; never edit schemas yourself. After LEAD re-exports,
   regenerate nothing by hand — the drift test tells you if code and contract disagree.
2. **Vertical slice:** you own one feature folder end to end. `router.py` (HTTP only: parse → service →
   map errors) → `service.py` (business logic; imports only `app.ports`, its own `schemas`, `app.shared`) →
   ports, wired in `deps.py` with `Depends` so tests inject fakes. **Never import another feature**; if two
   slices need the same logic, ask LEAD to move it to `app/shared/`. Never edit `main.py` — LEAD mounts your
   router. Real SDK/DB code lives only in `app/adapters/`.
3. **Errors:** one problem+json shape; every router declares `responses=problem_responses(...)`;
   validation → 422, upstream model down → 502, timeout → 504, quota → 429 with `Retry-After`, oversized →
   413. No stack traces, SQL or provider bodies in responses.
4. **Inputs:** max lengths on strings, max items on lists, enums for closed sets, `extra="forbid"` on request
   models where unknown fields are a bug.
5. **Reliability:** follow the resilience register (role 4): timeouts on every call, retries only on
   transient errors, fallback, readiness checks that name the failed dependency.
6. **Vercel-ready:** `app = create_app()` in `app/main.py`; `[tool.vercel] entrypoint = "app.main:app"`;
   nothing written outside `/tmp`; no work after the response; lifespan creates clients once.
7. **Tests:** in `tests/features/<name>/`, services tested with fake adapters; tests named after PRD AC ids
   (`test_ac_2_unknown_question_refuses`); fault tests (`@pytest.mark.faults`) for the register rows you own.

## Contract tests (Schemathesis)
`npm run test:contract` starts the API in test mode (mock LLM, test DB, rate limits off) on a free port and
runs `uvx schemathesis run {API}/openapi.json --checks all --max-examples 25`. Schemathesis generates valid
and invalid requests from the schema and checks: no 5xx, status codes and content types are documented,
responses match schemas, invalid data is rejected. For each failure:
1. Copy the printed reproduction (curl) and run it against `npm run dev:api:test`.
2. Fix the **code** (missing validation, unhandled exception, undocumented status) — or ask LEAD to fix the
   **contract** if the schema is wrong. Never weaken checks to go green.
3. Re-run until clean. Add a regression unit test for anything that returned 500.
Stateful flows (create → read) work when the contract has OpenAPI links; ask LEAD if needed.

## Pair with
`supabase-postgres-best-practices` (queries) · `api-design-principles` (optional, big APIs) ·
`systematic-debugging` · `verification-before-completion` (paste the Schemathesis summary in your report).

## Anti-patterns
Business logic in routes · a feature importing another feature · SDK calls outside `adapters/` ·
bare `except` · returning 200 with an error message · 500 on bad input · new
endpoints not in the contract · per-request client creation · sync I/O in async routes · mocks reachable in
production (`APP_ENV=production` must refuse `LLM_MOCK`).
