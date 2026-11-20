---
name: sqa-testing
description: Role 12 (Prove hat) - software quality assurance engineer. Writes docs/test-plan.md (risk-based scope, test levels, acceptance-criteria traceability, entry and exit criteria), the pytest harness with a fake LLM and test database, integration tests for every endpoint (happy, validation, dependency failure, authorization), the contract-drift test, the golden-path smoke script for local and deployed URLs, coverage targets, flaky-test policy, and k6 load tests with p95 and error-rate thresholds. Harness code in references/test-harness.md. Use when setting up tests, before every merge (npm run ci) and before promotion. Done check - node .orca-team/tools/gates.mjs ci and gates.mjs load.
---

# SQA — Role 12 · Prove hat

**Seat:** QA (models: `swarm-lead/references/model-routing.md`). **Independent check:** QA tests code written by Claude (CORE) and Gemini (UI)
— a different family from both; REVIEWER-CODE checks test quality. **Hand-off:** `docs/test-plan.md`,
`apps/api/tests/**`, `scripts/smoke.mjs`, `tests/load/smoke.js`. **Done when:** `gates.mjs ci` and
`gates.mjs load` pass.

Read `references/test-harness.md` (conftest, endpoint test pattern, drift test, smoke script).

## 1. Test plan (`docs/test-plan.md`)
~~~markdown
# Test plan
## Scope and risks
| Risk (from PRD/system design) | Impact | Covered by |
## Levels
| Level | Tool | Owner | Command | When |
| Unit | pytest | CORE | npm run test:api | every merge |
| Integration (API + test DB) | pytest + httpx | QA | npm run test:api | every merge |
| Contract | Schemathesis | CORE | npm run test:contract | rounds, promote |
| E2E + a11y | Playwright + axe | UI | npm run e2e | rounds, promote |
| AI quality | eval runner | QA | npm run eval | rounds, promote |
| Security / red team | attack suite, gitleaks | REVIEWER-SEC | npm run redteam | rounds, promote |
| Load | k6 | QA | npm run load | before freeze |
| Smoke | smoke.mjs | QA | npm run smoke:local / smoke --api <url> | every merge / after deploy |
## Traceability
| AC | Test(s) |
## Entry / exit criteria
Entry: contract locked, skeleton runs. Exit: all gates green (`npm run gates`), no open BLOCKER/HIGH.
~~~

## 2. What every endpoint gets (integration)
Happy path validated against the response model · 422 problem+json · dependency failure (fake adapter
raises → 502/503/504, no stack trace) · authorization (user A can't read B) · size limits (413) · rate
limit (429 when enabled). Test names carry AC ids where they prove an AC.

## 3. Coverage and quality of tests
`pytest-cov` on `app/`: ≥ 80 % lines on `app/features/*/service.py` and `app/shared/` (business logic);
report in CI output. Tests assert
behaviour, not just status codes. No network in unit tests, no sleeps, no real secrets in fixtures.
Flaky test → quarantine with `@pytest.mark.skip(reason="flaky: <issue>")` + fix task; never retry-until-green.

## 4. `npm run ci` (the merge gate)
`lint` → `typecheck` → `test` (unit + integration + faults + tracing + drift) → `smoke:local` (API in test
mode on a free port). Must finish in a few minutes. LEAD runs it through `gates.mjs merge <branch>`.

## 5. Load test (k6) — `tests/load/smoke.js`
Install once: `winget install k6 --source winget` (or the MSI from the k6 docs). Runs against the API in test
mode (mock LLM with realistic latency `LLM_MOCK_LATENCY_MS=300`), so it measures our overhead, not the
provider, and costs nothing.
```js
import http from "k6/http";
import { check, sleep } from "k6";

const API = __ENV.API;
export const options = {
  scenarios: { demo: { executor: "ramping-vus", startVUs: 1,
    stages: [{ duration: "20s", target: 10 }, { duration: "40s", target: 10 }, { duration: "10s", target: 0 }] } },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<300"],     // non-LLM endpoints
    "http_req_duration{kind:llm}": ["p(95)<1500"],     // LLM endpoints with mock latency
    checks: ["rate>0.99"],
  },
};
export default function () {
  const h = http.get(`${API}/healthz`, { tags: { kind: "read" } });
  check(h, { "healthz 200": (r) => r.status === 200 });
  const r = http.post(`${API}/api/v1/ask?stream=false`, JSON.stringify({ question: "refund for double charge?" }),
    { headers: { "Content-Type": "application/json" }, tags: { kind: "llm" } });
  check(r, { "ask 200": (x) => x.status === 200 });
  sleep(1);
}
```
`npm run load` = `with-server.mjs --env LLM_MOCK_LATENCY_MS=300 -- k6 run -e API={API} tests/load/smoke.js`. k6 exits non-zero when a
threshold fails. Take the targets from the PRD NFRs; record results in `docs/test-plan.md`. Never load-test
a deployed URL or a real provider without the human's approval.

## The check
`gates.mjs ci` runs `npm run ci`. `gates.mjs load` runs `npm run load` (reports BLOCKED with the install
command if k6 is missing — that blocks promotion).

## Pair with
`webapp-testing` (screenshots, console errors) · `property-based-testing` (parsers) ·
`verification-before-completion` · `systematic-debugging`.

## Anti-patterns
Tests that only assert 200 · shared mutable test data · sleeps · tests against dev or prod databases ·
load tests that burn LLM credits · skipping failing tests without a fix task.
