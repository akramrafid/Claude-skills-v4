
# Test harness (reference for sqa-testing)

Goal: prove the golden path works, keep `LEAD_BRANCH` green, and catch regressions in minutes. Order of
value in a hackathon: **smoke of golden path → API integration tests → unit tests of core logic → evals →
e2e UI → load**.

## 1. API test harness (`apps/api/tests/conftest.py`)
```
uv add --dev pytest pytest-asyncio respx asgi-lifespan
```
`pyproject.toml`:
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
markers = [
  "live: calls real providers (run with RUN_LIVE=1)",
  "faults: fault-injection tests for the resilience register (role 4)",
  "tracing: every LLM call is traced with tokens, cost, latency (role 15)",
]
addopts = "--cov=app --cov-report=term-missing:skip-covered"
```
```python
import os
import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from app.core.config import get_settings
from app.main import create_app

@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")          # mock LLM, test DB, rate limits off, fixtures corpus
    get_settings.cache_clear()
    app = create_app()
    async with LifespanManager(app):              # ASGITransport alone does not run lifespan
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c

def pytest_collection_modifyitems(config, items):
    if os.getenv("RUN_LIVE") != "1":
        skip = pytest.mark.skip(reason="live test; set RUN_LIVE=1")
        for item in items:
            if "live" in item.keywords:
                item.add_marker(skip)
```
Swap any service with `app.dependency_overrides[get_x_service] = lambda: FakeX()`; mock outbound HTTP with
`respx`. Integration tests use the Neon `test` branch (`TEST_DATABASE_URL`) migrated to head by `db:check`,
truncate the tables they touch, and skip with a clear reason when `TEST_DATABASE_URL` is missing.

## 2. What every endpoint needs
- Happy path: status + body validates against the response model (`ResponseModel.model_validate(r.json())`).
- Validation error: 422 with problem+json keys `type,title,status,detail,request_id`.
- Dependency failure: fake adapter raises → 502/503/504 problem+json, no stack trace in body.
- AuthZ (if users): user A cannot read user B's object (404/403).
- Contract drift test (catches un-exported schema changes):
```python
import json, pathlib
def test_contract_is_exported():
    from app.main import app
    committed = json.loads(pathlib.Path("../../contracts/openapi.json").read_text(encoding="utf-8"))
    assert app.openapi() == committed, "Schemas changed: LEAD must run `npm run contracts` and commit"
```

## 3. LLM features
- Unit tests use the fake LLM (fixtures in `tests/fixtures/llm/`); assert on parsing, validation, fallbacks,
  refusal paths, and that prompts include required sections (not exact wording).
- Live checks are `@pytest.mark.live` and skipped by default.
- Evals are role 11 (`eval-engineering`); retrieval metrics are role 6 (`data-engineering`).

## 4. Golden-path smoke (`scripts/smoke.mjs`) — no dependencies; local, test-mode or deployed
```js
#!/usr/bin/env node
// node scripts/smoke.mjs --api http://127.0.0.1:8000 [--web https://myapp-web.vercel.app]
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const API = (arg("--api", process.env.SMOKE_API_URL ?? "http://127.0.0.1:8000")).replace(/\/$/, "");
const WEB = arg("--web", process.env.SMOKE_WEB_URL ?? "");
const headers = { "Content-Type": "application/json" };
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const signal = () => AbortSignal.timeout(Number(process.env.SMOKE_TIMEOUT_MS ?? 30000));
const get = (u) => fetch(u, { headers, signal: signal() });
const post = (u, body) => fetch(u, { method: "POST", headers, body: JSON.stringify(body), signal: signal() });
const ok = async (r) => { if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`); return r; };

const steps = [
  ["healthz", async () => ok(await get(`${API}/healthz`))],
  ["readyz", async () => ok(await get(`${API}/readyz`))],
  // QA adds one step per golden-path action from docs/PRD.md, e.g.:
  // ["AC-1 ask", async () => { const j = await (await ok(await post(`${API}/api/v1/ask?stream=false`,
  //     { question: "How much credit for a 30 hour outage?" }))).json();
  //   if (!j.answer || !j.citations?.length) throw new Error("no cited answer"); }],
];
if (WEB) steps.push(["web home", async () => { const r = await ok(await get(WEB));
  if (!(await r.text()).includes("<html")) throw new Error("not html"); }]);

let failed = 0;
for (const [name, fn] of steps) {
  const t0 = Date.now();
  try { await fn(); console.log(`PASS ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}
console.log(failed ? `${failed} step(s) failed` : "smoke OK");
process.exit(failed ? 1 : 0);
```

## 5. UI end-to-end
Owned by role 10 (`frontend-engineering`: Playwright happy path + error states + axe). QA adds
cross-feature journeys only, in the same `apps/web/e2e/` folder and style.

## 5b. Agent-driven browser checks (`webapp-testing` skill)
Use it to *see* the app: screenshots of each golden-path step, browser console errors, network failures.
It uses Python Playwright — run its helper scripts through uv so nothing is installed globally:
`uv run --with playwright python -m playwright install chromium` (once), then
`uv run --with playwright python <script.py>`. Save screenshots under `apps/web/e2e/screens/` and list them in
your report. For parsers, scoring logic or data transforms, the optional `property-based-testing` skill
(`--only pbt`) finds edge cases example tests miss.

## 6. Load
See SKILL.md (k6 with thresholds, `npm run load`).

## 7. Policies
- A failing test on `LEAD_BRANCH` is a BLOCKER. Report to LEAD: test name, `file:line`, error, likely owner.
- No sleeps; wait on conditions. No network in unit tests. No real secrets in fixtures.
- Tests must pass from a clean worktree: `npm run test` after `--setup run`.

## 8. Done checklist
Harness + fake LLM in place · every endpoint: happy + validation + dependency-failure tests · contract drift
test · smoke covers every golden-path step · coverage ≥ 80 % on `app/features/*/service.py` + `app/shared/` · `npm run ci` green.
