
# FastAPI patterns (reference for backend-engineering)

Architecture: modular monolith cut into **vertical slices** with **ports & adapters** (ADR-0001,
`solution-architecture/references/blueprint.md` §3).
```
app/ports/llm.py              Protocol LLM            (LEAD)   ← what services depend on
app/adapters/llm.py           class LLMClient         (CORE)   ← real SDK code lives only here
app/adapters/fake_llm.py      class FakeLLM           (CORE)   ← tests, LLM_MOCK, test mode
app/features/ask/schemas.py   AskRequest, AskEvent    (LEAD)   ← contract
app/features/ask/service.py   AskService              (core-ask) imports ports + schemas + shared only
app/features/ask/deps.py      get_ask_service         (core-ask) Depends wiring
app/features/ask/router.py    POST /api/v1/ask/stream (core-ask) HTTP only
```
`router` (parse, call service, map errors) → `service` (business logic, no FastAPI/SDK/ORM imports) →
`ports` (Protocols) ← implemented by `adapters`. Lifespan builds adapters once; `deps.py` hands the service
its ports through `Depends`, so tests swap fakes with `dependency_overrides`. Features never import each
other; shared logic goes to `app/shared/`.

## 1. Setup
```
cd apps/api
uv init --app --python 3.12   # if pyproject.toml doesn't exist yet
uv add fastapi "uvicorn[standard]" pydantic-settings httpx tenacity openai
uv add "sqlalchemy[asyncio]" asyncpg alembic                     # if Postgres (Neon)
uv add qdrant-client  |  uv add pgvector                          # vector store choice
uv add slowapi                                                    # if rate limiting
uv add --dev pytest pytest-asyncio pytest-cov respx asgi-lifespan ruff pyright
```
Vercel needs only this in `pyproject.toml` (plus a committed `uv.lock` and `.python-version` = `3.12`):
```toml
[tool.vercel]
entrypoint = "app.main:app"
```
Keep runtime dependencies lean (Python bundle limit 500 MB); dev tools stay in the dev group.

## 2. Settings — `app/core/config.py`
```python
from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

import os
from typing import Annotated, Literal
from pydantic import field_validator
from pydantic_settings import NoDecode

class Settings(BaseSettings):
    # worktree-root .env first, then apps/api/.env overrides; real env vars (Vercel) override both
    model_config = SettingsConfigDict(env_file=("../../.env", ".env"), extra="ignore")
    app_env: Literal["dev", "test", "production"] = "dev"
    log_level: str = "INFO"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000", "http://localhost:3001"]  # env: a,b
    cors_origin_regex: str | None = None          # e.g. ^https://myapp-web(-[a-z0-9-]+)?\.vercel\.app$
    database_url: str = ""                        # Neon dev branch locally; prod URL on Vercel
    test_database_url: str = ""                   # Neon test branch; used when app_env == "test"
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: SecretStr | None = None
    llm_model: str = ""
    llm_fallback_model: str = ""
    llm_mock: bool = False
    rate_limit_enabled: bool = True
    fault_inject: str = ""                        # honoured only when app_env == "test"
    http_timeout_s: float = 30.0

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v):                   # "https://a.vercel.app,https://b.vercel.app" → list
        return [o.strip() for o in v.split(",") if o.strip()] if isinstance(v, str) else v

    @property
    def effective_database_url(self) -> str:
        return self.test_database_url if self.app_env == "test" else self.database_url

    def require_runtime(self) -> None:
        """Called in lifespan. Import stays side-effect free so `npm run contracts` works without secrets."""
        if self.app_env == "test":
            if os.getenv("VERCEL"):
                raise RuntimeError("APP_ENV=test is not allowed on Vercel")
            self.llm_mock, self.rate_limit_enabled = True, False
            return
        missing = []
        if self.app_env == "production" and self.llm_mock:
            missing.append("LLM_MOCK must be off in production")
        if not self.llm_mock and (self.llm_api_key is None or not self.llm_model):
            missing.append("LLM_API_KEY + LLM_MODEL (or set LLM_MOCK=1 outside production)")
        if missing:
            raise RuntimeError("Missing/invalid settings: " + "; ".join(missing))

@lru_cache
def get_settings() -> Settings:
    return Settings()
```
Use `SecretStr` for secrets (`.get_secret_value()` only where the client is built).

## 3. Logging + request context — `app/core/logging.py`, `app/core/middleware.py`
```python
import json, logging, sys, time, uuid
from contextvars import ContextVar
from starlette.middleware.base import BaseHTTPMiddleware

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {"ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"), "level": record.levelname,
                   "logger": record.name, "msg": record.getMessage(), "request_id": request_id_var.get()}
        payload.update(getattr(record, "fields", {}))
        if record.exc_info:
            payload["exc_type"] = record.exc_info[0].__name__
        return json.dumps(payload, default=str)

def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)

log = logging.getLogger("app")
# usage: log.info("llm_call", extra={"fields": {"model": m, "latency_ms": ms, "tokens_in": ti}})

class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        token = request_id_var.set(rid)
        start, status = time.perf_counter(), 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            log.info("request", extra={"fields": {"method": request.method, "path": request.url.path,
                     "status": status, "duration_ms": round((time.perf_counter() - start) * 1000, 1)}})
            request_id_var.reset(token)
```

## 4. Errors — `app/core/errors.py` (one shape everywhere)
```python
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.core.logging import log, request_id_var

from pydantic import BaseModel

class Problem(BaseModel):                     # RFC 9457 body, documented in the contract
    type: str = "about:blank"
    title: str
    status: int
    detail: str = ""
    request_id: str

def problem_responses(*codes: int) -> dict:
    """Router-level `responses=` so every route documents its problem+json errors (Schemathesis checks them)."""
    content = {"application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}}}
    return {c: {"model": Problem, "content": content, "description": "Problem details"} for c in codes}

class AppError(Exception):
    def __init__(self, status: int, title: str, detail: str = "", type_: str = "about:blank"):
        self.status, self.title, self.detail, self.type_ = status, title, detail, type_

def problem(status: int, title: str, detail: str = "", type_: str = "about:blank", **extra) -> JSONResponse:
    body = {"type": type_, "title": title, "status": status, "detail": detail,
            "request_id": request_id_var.get(), **extra}
    return JSONResponse(status_code=status, content=jsonable_encoder(body), media_type="application/problem+json")

def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app(_: Request, e: AppError):
        return problem(e.status, e.title, e.detail, e.type_)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        return problem(422, "Validation failed", "Request does not match the schema.", errors=e.errors())

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, e: Exception):
        log.exception("unhandled_error")
        return problem(500, "Internal error", "Unexpected error. Quote the request_id when reporting.")
```
Map provider/adapter failures to `AppError(502, "Upstream model unavailable")`, timeouts to 504, quota to 429.

## 5. App factory, lifespan, health — `app/main.py`
```python
from contextlib import asynccontextmanager
import asyncio, httpx
from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, setup_logging  # or app.core.middleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    s.require_runtime()
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(s.http_timeout_s, connect=3.0))
    app.state.readiness = {}            # name -> async callable; adapters register themselves here
    # build adapters once: app.state.llm = FakeLLM() if s.llm_mock else LLMClient(...)  (ai-engineering/references/llm-client.md)
    yield
    await app.state.http.aclose()

health = APIRouter(tags=["health"])

@health.get("/healthz")
async def healthz():
    return {"status": "ok"}

@health.get("/readyz")
async def readyz(request: Request):
    results = {}
    for name, check in request.app.state.readiness.items():
        try:
            await asyncio.wait_for(check(), timeout=2.0)
            results[name] = "ok"
        except Exception as e:  # report which dependency failed, never its credentials
            results[name] = f"fail: {type(e).__name__}"
    ok = all(v == "ok" for v in results.values())
    return JSONResponse({"status": "ok" if ok else "degraded", "checks": results}, status_code=200 if ok else 503)

def create_app() -> FastAPI:
    s = get_settings()
    setup_logging(s.log_level)
    app = FastAPI(title="<Project> API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_origin_regex=s.cors_origin_regex,
                       allow_credentials=False,           # bearer tokens, no cookies → no credentials
                       allow_methods=["GET", "POST", "PATCH", "DELETE"],
                       allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
                       expose_headers=["X-Request-ID"])
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(health)
    for r in FEATURE_ROUTERS:            # LEAD keeps this list: from app.features.ask.router import router as ask
        app.include_router(r, prefix="/api/v1")
    return app

app = create_app()
```

## 6. One slice: port → service → deps → router
```python
# app/ports/llm.py  (LEAD) — the only thing services know about the model
from typing import AsyncIterator, Protocol, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

class LLM(Protocol):          # LLMClient (adapters/llm.py) and FakeLLM (adapters/fake_llm.py) both satisfy it
    async def complete(self, messages: list[dict], *, max_tokens: int = 1024,
                       temperature: float | None = 0.2, model: str | None = None) -> "LLMResult": ...
    async def complete_json(self, messages: list[dict], schema: type[T], **kw) -> T: ...
    def stream(self, messages: list[dict], *, max_tokens: int = 1024) -> AsyncIterator[str]: ...
```
```python
# app/features/ask/service.py  (core-ask) — no FastAPI, no SDK, no ORM imports
from app.ports.llm import LLM
from app.ports.vector_store import VectorStore
from app.features.ask.prompts import build_messages   # versioned prompt files live in prompts/
from app.features.ask.schemas import AskRequest, AskEvent
from app.shared.retrieval import retrieve

class AskService:
    def __init__(self, llm: LLM, store: VectorStore, *, max_tokens: int):
        self.llm, self.store, self.max_tokens = llm, store, max_tokens

    async def stream_answer(self, body: AskRequest):
        chunks = await retrieve(self.store, body.question, k=body.top_k)
        if not chunks:
            yield AskEvent(type="refusal", text="I don't have a source for that.")
            return
        async for token in self.llm.stream(build_messages(body, chunks), max_tokens=self.max_tokens):
            yield AskEvent(type="token", text=token)
        yield AskEvent(type="done", citations=[c.ref for c in chunks])
```
```python
# app/features/ask/deps.py  (core-ask)
from fastapi import Request
from app.core.config import get_settings
from app.features.ask.service import AskService

def get_ask_service(request: Request) -> AskService:
    s = get_settings()
    return AskService(request.app.state.llm, request.app.state.store, max_tokens=s.max_output_tokens)
```
```python
# app/features/ask/router.py  (core-ask) — HTTP only
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.core.errors import problem_responses
from app.core.logging import request_id_var, log
from app.features.ask.deps import get_ask_service
from app.features.ask.schemas import AskRequest
from app.features.ask.service import AskService

router = APIRouter(tags=["ask"])

@router.post("/ask/stream", responses=problem_responses(422, 429, 502, 504))
async def ask_stream(body: AskRequest, svc: AskService = Depends(get_ask_service)):
    rid = request_id_var.get()                      # capture now; body streams after middleware returns
    async def events():
        try:
            async for ev in svc.stream_answer(body):          # typed events: token, refusal, done
                yield f"event: {ev.type}\ndata: {ev.model_dump_json()}\n\n"
        except Exception:
            log.exception("stream_failed")
            yield f'event: error\ndata: {{"title": "Generation failed", "request_id": "{rid}"}}\n\n'
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```
Tests (in `tests/features/ask/`) build the service directly with fakes —
`AskService(FakeLLM(["Hi"]), InMemoryStore(fixtures), max_tokens=64)` (timeouts live in the adapter) — or swap it in the app:
`app.dependency_overrides[get_ask_service] = lambda: AskService(FakeLLM(...), InMemoryStore(...), ...)`.

## 7. Data access (async SQLAlchemy 2)
Engine settings for Neon + Vercel (pooled URL, NullPool, timeouts, asyncpg URL conversion) are in
`database-engineering/references/data-layer.md` §1b — use `settings.effective_database_url`.
```python
async def get_session():
    async with SessionLocal() as session:
        yield session
```
Repositories take an `AsyncSession`; multi-step writes in `async with session.begin():`. Register
`app.state.readiness["postgres"] = lambda: session.execute(text("SELECT 1"))`-style checks in lifespan.

## 8. Other production patterns
- **Pagination**: `limit` (default 20, max 100) + opaque `cursor`; response `{items, next_cursor}`.
- **Rate limiting** (expensive routes): `slowapi` `Limiter(key_func=get_remote_address, enabled=s.rate_limit_enabled)`,
  e.g. `10/minute` on LLM endpoints; per-user key when auth exists; 429 problem+json with `Retry-After`.
  In-memory storage is per Vercel instance (fine for a demo; Upstash Redis for global limits). Behind Vercel,
  the client IP is the first entry of `X-Forwarded-For`.
- **Uploads**: check content-type + size before reading fully; stream to disk/object storage; random server
  filenames; never trust the client filename for paths.
- **Auth** (only if users exist): web signs in (Auth.js or provider) → API verifies a JWT (shared
  `AUTH_SECRET` or provider JWKS) in one dependency `get_current_user`; enforce ownership in services.
  Demo-only apps: seeded demo user, clearly labelled.
- **Long jobs**: on Vercel there is no work after the response. Keep requests < 60 s; long batch work runs
  from a CLI (`npm run ingest`) or in resumable chunks the client drives (`POST /jobs` → `POST /jobs/{id}/step`).
- **Error responses in the contract**: `APIRouter(prefix="/api/v1", responses=problem_responses(422, 429, 500, 502, 504))`
  (+ 404/409/413 where a route can return them) so Schemathesis status-code and content-type checks pass.
- **Outbound HTTP**: one shared `httpx.AsyncClient` from `app.state.http`; tenacity retry on 429/5xx/timeouts only.
- **Versioning**: routes under `/api/v1`. **Docs**: FastAPI `/docs` stays enabled for the demo.

## 9. Done checklist (in addition to production-standards)
`/healthz` 200 · `/readyz` names each dependency · every route returns contract-valid bodies and
problem+json errors · no blocking I/O in async routes · services unit-tested with fake adapters ·
no feature imports another feature · SDK/ORM imports only in `adapters/` ·
`npm run contracts` re-run if you touched schemas (LEAD only) · `ruff check` + `ruff format` clean.
