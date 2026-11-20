# Claude Skills v4 — AI Engineering Hackathon (16 roles + 6 review/hardening skills)

Every skill is a folder with a `SKILL.md` (frontmatter: `name`, `description`) and, where useful, a
`references/` folder with code templates. Each role skill states its **hand-off** (file paths) and its
**done check**: `node .orca-team/tools/gates.mjs <check>`.

## The 16 role skills
| Hat | # | Role | Skill folder | Inside | Hand-off | Done check | Pairs with (external skills) |
|---|---|---|---|---|---|---|---|
| Frame | 1 | Product owner / requirements analyst | `product-requirements` | SKILL.md | `docs/PRD.md` | `prd` | — |
| Frame | 2 | UX designer | `ux-flow-design` | SKILL.md | `docs/ux/flow.md`, `wireframes.md`, `hallway-test.md` | `ux` | frontend-design, web-design-guidelines, webapp-testing |
| Design | 3 | Solution architect | `solution-architecture` | SKILL.md + `references/blueprint.md` (vertical slices, ports & adapters) | `docs/architecture.md`, `docs/adr/` | `adr`, `contracts`, `slices` | — |
| Design | 4 | System designer | `system-design` | SKILL.md | `docs/system-design.md` + fault tests | `resilience` | — |
| Design | 5 | AI engineer | `ai-engineering` | SKILL.md + `references/llm-client.md`, `agents.md` | `docs/ai-design.md`, prompts, baseline | `baseline` | claude-api, qdrant-clients-sdk, mcp-builder (optional) |
| Design | 6 | Data engineer | `data-engineering` | SKILL.md + `references/rag-pipeline.md` | ingest CLI, golden queries | `retrieval` | qdrant-clients-sdk, supabase-postgres-best-practices |
| Design | 7 | Database engineer | `database-engineering` | SKILL.md + `references/data-layer.md` | migrations, `db_check.py`, ERD | `migrations` | supabase-postgres-best-practices |
| Build | 8 | Tech lead / integrator | `tech-lead-integration` | SKILL.md + `references/ci-and-hygiene.md` | green integration branch | `merge`, `promote` | — |
| Build | 9 | Backend engineer | `backend-engineering` | SKILL.md + `references/fastapi-patterns.md` | one slice per worker: `app/features/<name>/` | `contract` (Schemathesis) | api-design-principles (optional), systematic-debugging |
| Build | 10 | Frontend engineer | `frontend-engineering` | SKILL.md + `references/nextjs-patterns.md` | `apps/web/src/features/<name>/` + Playwright e2e | `e2e` | frontend-design, vercel-react-best-practices, web-design-guidelines |
| Prove | 11 | Eval engineer | `eval-engineering` | SKILL.md + `references/eval-runner.md` | datasets, rubric, history | `eval` | — |
| Prove | 12 | SQA engineer | `sqa-testing` | SKILL.md + `references/test-harness.md` | test plan, tests, k6 | `ci`, `load` | webapp-testing, property-based-testing |
| Prove | 13 | AI security / red-teamer | `ai-red-team` | SKILL.md + `references/redteam-runner.md` | threat model, attack suite | `redteam` | differential-review, insecure-defaults, semgrep, supply-chain-risk-auditor |
| Ship | 14 | Platform & deploy (Vercel, no DevOps) | `vercel-deploy` | SKILL.md | `docs/deploy.md`, live URLs | `fresh-clone`, `deploy` | deploy-to-vercel (optional) |
| Ship | 15 | LLMOps / SRE | `llmops-observability` | SKILL.md + `references/tracing.md` | traces, `/ops` dashboard, `docs/llmops.md` | `traces` | — |
| Ship | 16 | Demo & docs lead | `demo-docs` | SKILL.md + `references/readme-and-demo.md` | README, `docs/demo.md`, dry run | `dryrun` | webapp-testing |

## Review the code and make it production grade
| Skill folder | Used by | What it does |
|---|---|---|
| `production-standards` | every coder and reviewer | The production-grade bar and definition of done |
| `code-review` | REVIEWER-CODE · Claude Opus 5.5 max | Runs ci + gates, reviews the diff, production-grade scorecard against named standards, verdict |
| `security-review` | REVIEWER-SEC · Muse Wonder max (never Kimi) | Diff review against OWASP Top 10:2025, API Security Top 10, LLM Top 10 2026 |
| `production-hardening` | the code's owner | Fix pass: failing test first, smallest fix, layer-by-layer sweep, re-check |
| `swarm-lead` | Lead | Runs the 5 hats, routes the 16 roles to seats and models (`references/model-routing.md`), merges, review rounds |
| `credentials-gate` | Lead | Asks you once for keys, never reads or prints secrets |

## Built-in safety of the set
- Builders and checkers use different model families (e.g. Neon UI → Opus review; Sonnet backend → Muse Wonder
  security review; outsider tests by Muse Wonder). Any model out of quota → Gemini 4 Neon.
- Code is cut into vertical slices with ports & adapters; `gates.mjs slices` and `gates.mjs merge` enforce the
  boundaries.
- No skill asks you to retype the task, prints secrets, deploys, or merges to `main` without your yes.
