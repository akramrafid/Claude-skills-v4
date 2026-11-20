# PLAN.md — <project name>

_Last updated by LEAD: <time> · LEAD_BRANCH: <branch> · Deadline: <from TASK.md>_

Requirements live in `docs/PRD.md` (role 1). This file is the execution plan: who builds what, when, and
which gate proves it.

## 1. Golden path (copy from docs/PRD.md)
1. <user does X> → <system shows Y>

## 2. Architecture summary
- Archetype(s): <from solution-architecture/references/blueprint.md>
- Stack: FastAPI + Next.js · LLM <primary> / fallback <model> · judge <model, other family> · DB Neon (pgvector?)
  · vectors <pgvector | Qdrant Cloud> · deploy Vercel (api + web projects)
- Design direction: <one line — tone, palette + accent, font pairing, density>
- Optional skills installed: <qdrant / claude-api / mcp / pbt / api-design / vercel-deploy, or none>
- Details: docs/architecture.md · docs/adr/ · docs/system-design.md · docs/ai-design.md

## 3. Contracts (locked at <time>; changes only via LEAD)
- API: `contracts/openapi.json` (from `apps/api/app/features/*/schemas.py`)
- Ports: `apps/api/app/ports/*.py` (LLM, embeddings, vector store, repositories)
| Method | Path | Purpose | Request | Response | Streaming | Errors |
|---|---|---|---|---|---|---|
- DB: first migration `<revision>` · ERD in docs/data-model.md
- Eval set: `apps/api/evals/datasets/<capability>.jsonl` (<n> cases, held-out locked: yes/no)

## 4. Roles and seats (models: `.agents/skills/swarm-lead/references/model-routing.md`)
| Role | Seat | Hand-off | Gate |
|---|---|---|---|
| 1 Product owner | LEAD | docs/PRD.md | prd |
| 2 UX designer | UI | docs/ux/* | ux |
| 3 Solution architect | LEAD | docs/architecture.md, docs/adr/ | adr, contracts |
| 4 System designer | DESIGN | docs/system-design.md | resilience |
| 5 AI engineer | CORE | docs/ai-design.md, prompts, baseline | baseline |
| 6 Data engineer | DATA | ingest, golden queries | retrieval |
| 7 Database engineer | DATA | migrations, db_check | migrations |
| 8 Tech lead | LEAD | green LEAD_BRANCH | merge, promote |
| 9 Backend | CORE (one worker per feature) | API per contract | contract |
| 10 Frontend | UI / UI-2 (one worker per feature) | apps/web + e2e | e2e |
| 11 Eval engineer | QA | evals, history | eval |
| 12 SQA | QA | test plan, tests, k6 | ci, load |
| 13 AI red team | REVIEWER-SEC | threat model, attacks | redteam |
| 14 Deploy (Vercel) | QA + LEAD | docs/deploy.md, URLs | fresh-clone, deploy |
| 15 LLMOps | CORE | traces, /ops, docs/llmops.md | traces |
| 16 Demo & docs | QA | README, docs/demo.md, dry run | dryrun |
Not applicable roles → `.orca-team/gates.json` "skip" with a reason + a line in STATUS.md "Decisions".

## 5. Ports and ownership (vertical slices: one worker per feature)
| Seat / worker | Dev port(s) | Owns (may edit) |
|---|---|---|
| LEAD | api 8000 | root `package.json`, `.env.example`, `contracts/`, `apps/api/app/{core,ports}/`, `apps/api/app/features/*/schemas.py`, `apps/api/app/{main,__main__,export_openapi,healthcheck}.py`, `apps/web/src/app/layout.tsx`, `docs/PRD.md`, `docs/architecture.md`, `docs/adr/` |
| design-* | — | `docs/system-design.md`, `.orca-team/reviews/*-critique.md` |
| core-<feature> | api 8001/8002 | `apps/api/app/features/<feature>/**` except `schemas.py`; `apps/api/tests/features/<feature>/**` |
| core (shared) | — | `apps/api/app/{shared,adapters,observability}/**` except `adapters/db/`; `docs/ai-design.md`, `docs/llmops.md` (one worker at a time) |
| ui-<feature> | web 3001 (+ api 8003) | `apps/web/src/features/<feature>/**`, `apps/web/src/app/<feature routes>/**`, `apps/web/e2e/<feature>*.spec.ts`, `docs/ux/**` |
| data-* | — | `apps/api/migrations/**`, `apps/api/app/adapters/db/**`, `apps/api/app/ingest/**`, `apps/api/scripts/**`, `apps/api/evals/retrieval.py`, `apps/api/evals/datasets/retrieval.jsonl`, `docs/data-*.md`, `data/**` |
| qa-* | — | `apps/api/tests/{integration,fixtures}/**`, `apps/api/evals/**` (except retrieval + redteam), `scripts/**`, `tests/load/**`, `README.md`, `docs/{test-plan,deploy,demo,demo-inputs,dry-run}.md` |
| reviewer-sec | — | `docs/threat-model.md`, `apps/api/evals/redteam*`, `.orca-team/reviews/r<N>-security.md` |
Shared UI pieces (`apps/web/src/components/ui/`, `src/lib/`) belong to the first UI worker; others ask LEAD.

## 6. Waves and tasks
| Task | Wave | Seat | Feature | Role | Agent/model | Title | Deps | Gate | Needs creds | RACE |
|---|---|---|---|---|---|---|---|---|---|---|

## 7. Risks and mitigations
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM provider outage during demo | M | H | fallback model + DEMO_REPLAY recorded responses |
| Claude quota runs out | M | H | AGENTS.md §4 ladder; Claude workers ≤ 2 |
