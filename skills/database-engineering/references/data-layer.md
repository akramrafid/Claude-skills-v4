
# Data Layer (reference for database-engineering)

## 0. Load these with this skill
`supabase-postgres-best-practices` for every table, index, migration, query or RLS decision on Postgres (it
applies to any Postgres, not only Supabase). Using Qdrant → also `qdrant-clients-sdk` (optional skill, LEAD
installs it with `--only qdrant`).

## 1. Where the database lives (no Docker)
Neon Postgres branches: `dev` → `DATABASE_URL` (laptop), `test` → `TEST_DATABASE_URL` (tests, db:check,
gates), `main` → `PROD_DATABASE_URL` (pushed to Vercel as `DATABASE_URL`; agents never connect to it except
the approved prod ingest/seed). Builders never create their own databases. The app has no Postgres at all →
SQLite file `sqlite+aiosqlite:///./.data/app.db` for dev/test only (never deployed).

## 1b. Serverless-safe connections (Vercel + Neon)
```python
# app/core/db_url.py — Neon gives libpq-style URLs; asyncpg needs ssl=require instead of sslmode
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

def to_asyncpg_url(url: str) -> str:
    parts = urlsplit(url)
    scheme = "postgresql+asyncpg" if parts.scheme in {"postgres", "postgresql"} else parts.scheme
    q = dict(parse_qsl(parts.query))
    if q.pop("sslmode", None) in {"require", "verify-ca", "verify-full"}:
        q["ssl"] = "require"
    q.pop("channel_binding", None)
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))
```
```python
# app/adapters/db/engine.py — created once in lifespan
import uuid
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

engine = create_async_engine(
    to_asyncpg_url(settings.database_url),
    poolclass=NullPool,                       # Neon's pooled endpoint does the pooling
    connect_args={
        "timeout": 5,                         # connect timeout (s)
        "command_timeout": 10,                # per statement (s)
        "statement_cache_size": 0,            # PgBouncer transaction mode
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",
    },
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
```
Use Neon's **pooled** connection string (host contains `-pooler`) for the app; migrations may use the direct
one. asyncpg works on Windows' default event loop; prefer it over async psycopg there.

## 2. Schema rules
- UUID primary keys (`uuid4`) for anything exposed in URLs; `created_at`/`updated_at` as `timestamptz`
  with server defaults; UTC everywhere.
- NOT NULL by default; FKs with explicit `ondelete`; UNIQUE for natural keys; CHECK for enums/ranges.
- Index every column used in WHERE/JOIN/ORDER BY on the demo path; GIN index for queried JSONB.
- JSONB only for genuinely flexible metadata — not to avoid modelling.
- Multi-tenant/user data: `tenant_id`/`user_id` column + index, enforced in repositories.

```python
import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, MetaData, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    # deterministic constraint names → clean Alembic autogenerate diffs
    metadata = MetaData(naming_convention={
        "ix": "ix_%(column_0_label)s", "uq": "uq_%(table_name)s_%(column_0_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s", "pk": "pk_%(table_name)s"})

class Document(Base):
    __tablename__ = "documents"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(500))
    source_uri: Mapped[str] = mapped_column(String(2000), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")   # pending|indexed|failed
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

## 3. Migrations (Alembic, async)
```
cd apps/api
uv run alembic init -t async migrations
# migrations/env.py: target_metadata = Base.metadata; url from get_settings().database_url
uv run alembic revision --autogenerate -m "create documents"    # then READ the generated file
uv run alembic upgrade head
```
Root scripts: `npm run db:migrate` (`alembic upgrade head` on `DATABASE_URL`), `npm run db:check`
(reversibility proof on `TEST_DATABASE_URL`, see SKILL.md).
Only the DATA owner writes migrations (one linear history). pgvector: first migration runs
`op.execute("CREATE EXTENSION IF NOT EXISTS vector")`. Never edit an applied migration — add a new one.

## 4. Repositories and transactions
Repositories take an `AsyncSession` and return domain objects/DTOs; services own transactions:
```python
async def create_document(session, docs, jobs, payload):
    async with session.begin():          # both writes commit together or not at all
        doc = await docs.create(payload)
        await jobs.enqueue(doc.id)
    return doc
```
Avoid N+1 with `selectinload`/`joinedload`. Keyset pagination (`WHERE (created_at, id) < (:c, :i)`).
Bulk inserts with `insert(...).values([...])`; Postgres upserts with `on_conflict_do_update`/`do_nothing`.

## 5. Seed and demo data (`apps/api/scripts/seed.py`, `npm run seed`)
Idempotent (upsert by natural key), realistic (names, numbers, edge cases the demo shows), small enough to
load in < 30 s, and includes the exact records the golden path uses. Print counts, never secrets.

## 6. Provided datasets (`/data`)
Profile first (row counts, nulls, types, duplicates) → validate rows with a Pydantic model → load valid rows,
write rejects to `data/rejects/<name>.csv` with the reason → log summary. Loading is idempotent and
re-runnable. Large files: stream/chunk (polars or pandas with chunksize). Document the dataset in README.

## 7. Rate limits, files, jobs on serverless (only when the plan needs them)
- Rate limits/caches: in-process per instance for the demo; global limits → Upstash Redis (Vercel
  Marketplace) with keys namespaced `app:<feature>:<id>`.
- Files: no local disk on Vercel. Uploads → object storage (Vercel Blob, S3/R2) with random keys,
  content-type + size validated first; or parse in-request and keep only extracted text in Postgres.
- Jobs: a `jobs` table (status, progress, error, attempts) + a client that polls; long ingestion runs from
  the CLI on a laptop, not in a function.

## 8. Connectivity check (`apps/api/app/healthcheck.py`, `npm run healthcheck`)
```python
import asyncio, time
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import get_settings

async def _timed(name, coro):
    t0 = time.perf_counter()
    try:
        await asyncio.wait_for(coro, timeout=5)
        status = "OK"
    except Exception as e:                       # print the error type only, never connection strings
        status = f"FAIL ({type(e).__name__})"
    return name, status, (time.perf_counter() - t0) * 1000

async def _postgres(url: str):
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    finally:
        await engine.dispose()

async def main() -> int:
    s = get_settings()
    checks = [("postgres", _postgres(s.database_url))]
    # add: ("qdrant", store.c.get_collections()), ("redis", redis.ping()), ("llm", tiny completion) as configured
    results = await asyncio.gather(*(_timed(n, c) for n, c in checks))
    for name, status, ms in results:
        print(f"{name:<10} {status:<28} {ms:7.0f} ms")
    return 0 if all(r[1] == "OK" for r in results) else 1

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
```

## 9. Done checklist
`npm run db:check` green · constraints + indexes for demo queries · seed idempotent · dataset rejects logged ·
healthcheck green · pooled URL + NullPool + timeouts · no credentials in code, logs or migration files.
