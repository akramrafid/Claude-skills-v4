---
name: production-hardening
description: Turns working code into production-grade, industry-standard code. The fixer pass that follows a review - triage findings and failing gates, write a failing test first, apply the smallest correct fix, then sweep each layer (API, services, AI pipeline, data, frontend, config, docs) against named standards (12-Factor, RFC 9457 errors, OpenAPI 3.1, OWASP ASVS and Top 10 2025, OWASP LLM Top 10 2026, WCAG 2.2 AA, SRE golden signals, OpenTelemetry GenAI conventions, Conventional Commits) and prove it with npm run ci and the role gates. Use for fix tasks after code or security review, before freeze, or when asked to make code production ready. The owner seat of the code applies fixes; reviewers re-verify.
---

# Production Hardening — the fix-and-raise-the-bar pass

**Who:** the **owner seat** of the code (builder fixes their own code — they know it; the reviewer stays
independent). Load with `production-standards`, `receiving-code-review`, `verification-before-completion`,
`systematic-debugging`. **Inputs:** `.orca-team/reviews/r<N>-*.md`, `.orca-team/GATES.md`, your task spec.
**Done when:** every assigned finding is fixed or rebutted with evidence, `npm run ci` is green, the gates of
your role pass, and the reviewer's re-check verdict is `SHIP`.

## 1. Triage (5 minutes)
List findings by severity: BLOCKER → HIGH → failing gates → MEDIUM. For each: reproduce it (command, input,
or test). Can't reproduce → `receiving-code-review`: reply to LEAD with evidence, don't "fix" blindly.

## 2. Fix loop (per finding)
1. **Test first** — a failing test that proves the bug (unit, integration, fault, e2e, eval case or attack).
2. **Smallest correct fix** at the right layer (validation at the boundary, retries in the adapter, ownership
   check in the service, sanitising at render). No drive-by refactors, no contract changes (ask LEAD).
3. **Prove** — the new test passes, `npm run ci` green; commit `fix(<area>): <finding id> <what>`.
4. Note `finding → commit → test` in your report.

## 3. Sweep by layer (after the findings; time-box 30–45 minutes)
**Config (12-Factor):** typed settings, fail fast with names (never values), `.env.example` complete,
`APP_ENV=production` refuses mocks, no hardcoded URLs/models/limits.
**API (OpenAPI 3.1, RFC 9457):** every route typed both ways, error responses declared, size/length limits,
pagination capped, idempotency keys on retryable writes, `/healthz` + `/readyz`, versioned paths.
**Reliability (SRE):** timeouts everywhere, retries only on transient errors with jitter, fallback, circuit
breaker, graceful degradation, no swallowed exceptions (OWASP A10:2025 mishandling of exceptional conditions).
**Security (ASVS L1 / Top 10 2025 / LLM Top 10 2026):** object-level authorization, parameterised queries,
SSRF guard, CORS allow-list, security headers, secrets only in env, PII out of logs and prompts, untrusted
text delimited, model output sanitised, tools least-privilege with approval, token and rate caps.
**AI pipeline:** prompts versioned in files, structured outputs validated + repaired + safe fallback,
citations verified, "I don't know" path, eval dev score not lower than baseline, every call traced.
**Data:** constraints and indexes, reversible migrations, transactions around multi-step writes, UTC,
idempotent seed/ingest, pooled serverless connections.
**Frontend (WCAG 2.2 AA):** four states per screen, labelled inputs, focus management, `aria-live` for
streams, contrast, keyboard, 375 px layout, no secrets in bundle, typed client from the contract.
**Observability (golden signals + OTel GenAI):** latency, traffic, errors, saturation visible; JSON logs with
request id; LLM tokens/cost/latency per call.
**Code quality:** `ruff check --fix` + `ruff format`, `eslint --fix` + `prettier`, `pyright` and `tsc
--noEmit` clean; no dead code, `print`, bare `except`, `any`, TODO in MUST paths; functions small, names
precise, comments explain why; duplicated logic from parallel merges removed.
**Tests:** behaviour asserted (not only status), error paths, AC ids in names, coverage ≥ 80 % on services,
no sleeps, no network in unit tests.
**Docs:** README run steps true, env table complete, ADR for any decision you changed.

## 4. Verify and hand back
`npm run ci` → your role's gates (`node .orca-team/tools/gates.mjs <id>`) → paste outputs in `worker_done`
with the finding table. LEAD dispatches the reviewer's re-check of changed files only.

## Anti-patterns
Fixing without a test · rewriting modules during a fix task · suppressing linters/type errors instead of
fixing · loosening a test, schema or threshold to go green · reviewer fixing code they will then approve.
