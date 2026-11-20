---
name: llmops-observability
description: Role 15 (Ship hat) - LLMOps and SRE. Makes every LLM call traced with request id, route, prompt version, model, attempt, fallback flag, status, tokens in and out, cost, latency and time to first token; ships the records to stdout JSON (Vercel logs), a Postgres llm_calls table and optionally Langfuse or OpenTelemetry GenAI spans; serves a protected cost and latency dashboard; defines SLOs, a daily budget guard, a circuit breaker and the model fallback chain with a runbook. Code in references/tracing.md. Use when wiring the LLM client, before demo day, and whenever cost, latency or provider errors matter. Done check - node .orca-team/tools/gates.mjs traces.
---

# LLMOps / SRE — Role 15 · Ship hat

**Seat:** CORE (models: `swarm-lead/references/model-routing.md`). **Independent check:** the tracing tests count SDK invocations against
trace records (machine-checked); REVIEWER-CODE reviews. **Hand-off:** `apps/api/app/observability/`,
`llm_calls` migration (with DATA), `GET /api/v1/ops/llm-metrics`, web page `/ops`, `docs/llmops.md`.
**Done when:** `node .orca-team/tools/gates.mjs traces` passes.

Read `references/tracing.md` for the record type, sinks, pricing, metrics endpoint and tests.

## 1. Every LLM call is traced — no exceptions
The single `LLMClient` (role 5) wraps each attempt and emits one `LLMCallRecord`:
`ts, request_id, route, feature, prompt_name, prompt_version, provider, model, attempt, fallback_used,
status (ok|error|timeout|refused|budget_blocked), error_type, tokens_in, tokens_out, cached_tokens,
latency_ms, ttft_ms (streaming), cost_usd, cache_hit, tenant_hash`. Failed attempts are traced too.
No raw prompts or answers by default (PII); `TRACE_CONTENT=redacted` stores a redacted sample for debugging.

## 2. Sinks (all through one `TraceSink` interface)
- **stdout JSON** — always on; shows in `vercel logs` and local consoles.
- **Postgres `llm_calls`** — production and dev (Neon); batched insert at the end of the request, never
  blocking the stream; failures to write a trace are logged and never fail the user request.
- **In-memory** — test mode; tests read it.
- **Optional** Langfuse or OpenTelemetry with GenAI semantic conventions (`gen_ai.*` attributes) when the
  human provides credentials.

## 3. Cost
`app/observability/pricing.py` loads `pricing.json` (USD per 1M input/output tokens per model). Prices change
— look them up on the provider's pricing page when you write the file and keep `"source"` and `"checked"`
fields; unknown model → cost `null` and a warning, never a guess.

## 4. Dashboard
`GET /api/v1/ops/llm-metrics?window=1h|24h` (header `X-Ops-Token` = `OPS_TOKEN`; 404 without it) →
requests, error rate, fallback rate, p50/p95 latency and TTFT, tokens, cost total and per request, grouped
by model and route. Web `/ops` page fetches it through a Next route handler that adds the token server-side
(the token never reaches the browser). Show it in the demo's "under the hood" beat.

## 5. Resilience controls
Fallback chain `LLM_MODEL → LLM_FALLBACK_MODEL → friendly 503` · circuit breaker (5 failures in 60 s → skip
primary for 30 s; per instance) · budget guard (`LLM_DAILY_BUDGET_USD` from `llm_calls` sum → switch to the
cheaper model at 80 %, `budget_blocked` at 100 %) · `max_tokens` and timeouts on every call.

## 6. `docs/llmops.md` (gate checks the headings)
~~~markdown
# LLMOps
## SLOs
| Signal | Target | Source |
| Availability (non-5xx) | ≥ 99 % during demo | llm-metrics |
| TTFT p95 | < 2 s | llm-metrics |
| Error rate | < 2 % | llm-metrics |
## Budget
Daily cap, cost per request target, eval-run cost.
## Fallback chain
primary → fallback → 503 with retry advice; breaker settings.
## Runbook
Provider down · rate limited · cost spike · slow responses · bad outputs (switch prompt version back).
~~~

## The check
`gates.mjs traces` runs `npm run check:traces` (`pytest -m tracing`: success, failure + fallback,
streaming TTFT, cost computed, **records == SDK invocations**) and checks `docs/llmops.md` has the four
sections.

## Anti-patterns
LLM calls outside the client · traces only on success · logging full prompts with user data · cost
computed from guessed prices · dashboard open to the internet · tracing that can break a user request.
