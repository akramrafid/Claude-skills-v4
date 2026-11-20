---
name: database-engineering
description: Role 7 (Design hat) - database engineer. Designs the relational schema (constraints, indexes, naming convention), writes reversible Alembic migrations, an idempotent seed, the ERD in docs/data-model.md, and serverless-safe connection settings for Neon Postgres on Vercel (pooled URL, NullPool, SSL, statement timeouts, Windows-safe asyncpg URLs). Provides scripts/db_check.py proving migrations go up, down and up again cleanly on an empty test database with no model drift. Full patterns in references/data-layer.md. Use for any table, migration, index, seed or connection change. Done check - node .orca-team/tools/gates.mjs migrations.
---

# Database Engineering — Role 7 · Design hat

**Seat:** DATA (models: `swarm-lead/references/model-routing.md`). **Independent check:** REVIEWER-CODE (Claude) with
`supabase-postgres-best-practices`. **Hand-off:** `apps/api/migrations/`, `apps/api/app/adapters/db/`,
`apps/api/scripts/seed.py`, `apps/api/scripts/db_check.py`, `docs/data-model.md`.
**Done when:** `node .orca-team/tools/gates.mjs migrations` (runs `npm run db:check`) passes.

Read `references/data-layer.md` for the model base class, repositories, transactions, seed and healthcheck.

## Steps
1. **Model** the PRD entities: UUID public ids, `timestamptz` UTC, NOT NULL by default, FKs with explicit
   `ondelete`, UNIQUE natural keys, CHECK for enums, an index for every WHERE/JOIN/ORDER BY on the demo path.
2. **ERD** in `docs/data-model.md` (Mermaid `erDiagram`) + a table of indexes and why each exists.
3. **Migrations** (Alembic async, one linear history, only DATA writes them): autogenerate, then **read and
   edit** the file; every `upgrade` has a real `downgrade`; schema and data migrations separate; pgvector:
   `CREATE EXTENSION IF NOT EXISTS vector` in the first revision. Never edit an applied migration.
4. **Seed** — idempotent upserts, realistic records the golden path uses, < 30 s.
5. **Connections** — environments per `solution-architecture/references/blueprint.md` §2: Neon branches
   `dev` (`DATABASE_URL`), `test` (`TEST_DATABASE_URL`), `main` (`PROD_DATABASE_URL`, only pushed to Vercel).
   Serverless settings in references §1b. `/readyz` checks the DB with a 2 s timeout.
6. **`scripts/db_check.py`** (template below) + root script `npm run db:check`.

## `apps/api/scripts/db_check.py`
```python
"""Prove migrations are reversible on an EMPTY throwaway DB: downgrade→assert empty→upgrade→check→
downgrade→assert empty→upgrade. Refuses any URL except TEST_DATABASE_URL."""
import asyncio

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings

def _cfg(url: str) -> Config:
    cfg = Config("alembic.ini")
    cfg.attributes["url"] = url          # env.py: url = config.attributes.get("url") or settings URL
    return cfg

async def _user_tables(url: str) -> list[str]:
    engine = create_async_engine(url)
    try:
        async with engine.connect() as conn:
            names = await conn.run_sync(lambda c: inspect(c).get_table_names())
    finally:
        await engine.dispose()
    return [n for n in names if n != "alembic_version"]

def main() -> int:
    s = get_settings()
    url = s.test_database_url
    if not url or url in {s.database_url, getattr(s, "prod_database_url", None)}:
        print("db:check needs TEST_DATABASE_URL pointing at a throwaway test database")
        return 2
    cfg = _cfg(url)
    command.downgrade(cfg, "base")
    if left := asyncio.run(_user_tables(url)):
        print(f"FAIL: tables not managed by migrations: {left}")
        return 1
    command.upgrade(cfg, "head")
    command.check(cfg)                   # raises if models and migrations differ
    command.downgrade(cfg, "base")
    if left := asyncio.run(_user_tables(url)):
        print(f"FAIL: downgrade left tables behind: {left}")
        return 1
    command.upgrade(cfg, "head")         # leave the test DB ready for the test suite
    print("db:check OK: up, check, down, up on an empty database")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```
`migrations/env.py` must take the URL from `config.attributes.get("url")` first (avoids `%` interpolation
issues with `set_main_option`), else from settings. SQLite projects: `render_as_batch=True` in env.py.

## The check
`gates.mjs migrations` runs `npm run db:check` and fails on a non-zero exit. Integration tests also start
from `alembic upgrade head` on the test branch, so schema drift shows up twice.

## Anti-patterns
`Base.metadata.create_all()` outside tests · `downgrade(): pass` · migrations generated and never read ·
tests or db:check pointed at dev/prod data · a connection pool per request · `sslmode` query params passed
to asyncpg unchanged (fails — see references §1b).
