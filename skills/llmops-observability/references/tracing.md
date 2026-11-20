# Tracing, cost and metrics (reference for llmops-observability)

## 1. Record and sinks — `app/observability/traces.py`
```python
from __future__ import annotations

import json, logging, sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Protocol

log = logging.getLogger("llm")

@dataclass
class LLMCallRecord:
    request_id: str
    route: str
    feature: str
    prompt_name: str
    prompt_version: str
    provider: str
    model: str
    attempt: int
    fallback_used: bool
    status: str                      # ok | error | timeout | refused | budget_blocked
    latency_ms: float
    tokens_in: int | None = None
    tokens_out: int | None = None
    cached_tokens: int | None = None
    ttft_ms: float | None = None
    cost_usd: float | None = None
    error_type: str | None = None
    cache_hit: bool = False
    tenant_hash: str | None = None
    ts: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds"))

class TraceSink(Protocol):
    async def emit(self, rec: LLMCallRecord) -> None: ...

class StdoutSink:
    async def emit(self, rec: LLMCallRecord) -> None:
        sys.stdout.write(json.dumps({"type": "llm_call", **asdict(rec)}) + "\n")

class MemorySink:                     # test mode
    def __init__(self) -> None:
        self.records: list[LLMCallRecord] = []
    async def emit(self, rec: LLMCallRecord) -> None:
        self.records.append(rec)

class DbSink:                         # Postgres llm_calls table (migration owned by DATA)
    def __init__(self, session_factory) -> None:
        self._sf = session_factory
    async def emit(self, rec: LLMCallRecord) -> None:
        from app.adapters.db.models import LLMCall
        try:
            async with self._sf() as s, s.begin():
                s.add(LLMCall(**asdict(rec)))
        except Exception as e:        # tracing must never break a user request
            log.warning("trace_write_failed", extra={"fields": {"error": type(e).__name__}})

class FanOut:
    def __init__(self, *sinks: TraceSink) -> None:
        self.sinks = sinks
    async def emit(self, rec: LLMCallRecord) -> None:
        for s in self.sinks:
            await s.emit(rec)
```
Wire in lifespan: test → `FanOut(MemorySink())`; dev/production → `FanOut(StdoutSink(), DbSink(SessionLocal))`.
Inside streaming responses, emit after the final chunk (still inside the generator) so TTFT and totals are known.

## 2. Pricing — `app/observability/pricing.py` + `pricing.json`
```json
{ "source": "<provider pricing page URL>", "checked": "<date>",
  "models": { "<model-id>": { "input_per_1m": 0.0, "output_per_1m": 0.0 } } }
```
```python
import json, logging, pathlib
from functools import lru_cache

@lru_cache
def _prices() -> dict:
    return json.loads((pathlib.Path(__file__).parent / "pricing.json").read_text(encoding="utf-8"))["models"]

def cost_usd(model: str, tokens_in: int | None, tokens_out: int | None) -> float | None:
    p = _prices().get(model)
    if p is None or tokens_in is None or tokens_out is None:
        logging.getLogger("llm").warning("no_price", extra={"fields": {"model": model}})
        return None
    return round(tokens_in / 1e6 * p["input_per_1m"] + tokens_out / 1e6 * p["output_per_1m"], 6)
```

## 3. Inside `LLMClient` (role 5) — one record per attempt
```python
# method of LLMClient; the retry/fallback loop calls it once per attempt
async def _attempt(self, model: str, msgs: list[dict], *, max_tokens: int, timeout: float,
                   attempt: int, prompt, ctx):
    t0 = time.perf_counter()
    status, err, usage = "ok", None, None
    try:
        resp = await self._sdk.chat.completions.create(model=model, messages=msgs, max_tokens=max_tokens,
                                                       timeout=timeout)
        usage = resp.usage
        return resp
    except (asyncio.TimeoutError, APITimeoutError):
        status, err = "timeout", "TimeoutError"
        raise
    except Exception as e:
        status, err = "error", type(e).__name__
        raise
    finally:
        t_in, t_out = getattr(usage, "prompt_tokens", None), getattr(usage, "completion_tokens", None)
        await self._traces.emit(LLMCallRecord(
            request_id=request_id_var.get(), route=ctx.route, feature=ctx.feature, prompt_name=prompt.name,
            prompt_version=prompt.version, provider=self.provider, model=model, attempt=attempt,
            fallback_used=model != self.primary_model, status=status, error_type=err,
            latency_ms=(time.perf_counter() - t0) * 1000, tokens_in=t_in, tokens_out=t_out,
            cost_usd=cost_usd(model, t_in, t_out)))
```
Streaming: request `stream_options={"include_usage": True}` where the provider supports it, set `ttft` on the
first content chunk, read usage from the last chunk.

## 4. Metrics endpoint — `GET /api/v1/ops/llm-metrics`
Guard: compare `X-Ops-Token` with `settings.ops_token` using `hmac.compare_digest`; missing/wrong → 404.
Query `llm_calls` for the window: count, error rate (`status != 'ok'`), fallback rate,
`percentile_cont(0.5/0.95) within group (order by latency_ms)`, same for `ttft_ms`, `sum(cost_usd)`,
`sum(tokens_in/out)`, grouped by `model` and `route`. Return a typed response model (it's in the contract).

## 5. Tests — `apps/api/tests/test_tracing.py` (`@pytest.mark.tracing`)
1. One successful call → exactly one record; every field in the required list is non-null.
2. Primary raises timeout → two records: `status="timeout"` attempt 1, `fallback_used=True` attempt 2.
3. Streaming → `ttft_ms` set and `< latency_ms`.
4. Spy on the fake SDK transport: `len(sink.records) == fake_sdk.calls` across a whole golden-path request.
5. `cost_usd` equals the pricing formula for a known model; unknown model → `None` + warning, no crash.
6. A failing `DbSink` does not change the HTTP response.
