
# FastAPI patterns (reference for backend-engineering)

Layering: `routes` (HTTP only: parse, call service, map errors) → `services` (business logic, no FastAPI
imports) → `adapters` (LLM, vector store, DB, storage, external APIs). Services receive adapters through
constructors; routes get services through `Depends` so tests can swap them.

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
    # build adapters + services once, e.g. app.state.chat_service = ChatService(llm=..., store=...)
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
    # app.include_router(chat_router, prefix="/api/v1")
    return app

app = create_app()
```

## 6. Routes stay thin; services are injectable
```python
def get_chat_service(request: Request) -> ChatService:
    return request.app.state.chat_service

@router.post("/chat/stream")
async def chat_stream(body: ChatRequest, svc: ChatService = Depends(get_chat_service)):
    rid = request_id_var.get()                      # capture now; body streams after middleware returns
    async def events():
        try:
            async for ev in svc.stream_answer(body):          # yields typed events: token, citation, done
                yield f"event: {ev.type}\ndata: {ev.model_dump_json()}\n\n"
        except Exception:
            log.exception("stream_failed")
            yield f'event: error\ndata: {{"title": "Generation failed", "request_id": "{rid}"}}\n\n'
    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```
Tests swap services: `app.dependency_overrides[get_chat_service] = lambda: FakeChatService()`.

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
`npm run contracts` re-run if you touched schemas (LEAD only) · `ruff check` + `ruff format` clean.
