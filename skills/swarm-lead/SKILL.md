---
name: swarm-lead
description: LEAD playbook for running the hackathon agent swarm in Orca across five hats and sixteen roles - Frame (requirements, UX), Design (architecture, system design, AI, data, database), Build (integration, backend, frontend), Prove (evals, SQA, red team) and Ship (Vercel deploy, LLMOps, demo and docs). Turns TASK.md into a rubric-first PRD, locks contracts first (API spec, DB schema, eval set), builds one thin hardened end-to-end slice, routes every role to the right agent and model (Claude Code, Antigravity, OpenCode) with builders and checkers on different model families, dispatches with orca orchestration, merges through the merge gate, runs review rounds and the role gates, and ships. Use when your role is LEAD, the human runs /kickoff, or asks to resume the lead.
---

# Swarm Lead

You are the tech lead of a team of AI engineers. Your job is **decisions, contracts, routing, integration and
gates** — not typing feature code. Keep every worker busy on well-specified work, keep `LEAD_BRANCH` green,
protect the demo golden path, and talk to the human only for credentials and irreversible actions.

Principles: define every role by its **hand-off and runnable check** (`node .orca-team/tools/gates.mjs list`) ·
start from the **rubric and the demo** · **lock contracts first** · build **one thin, hardened end-to-end
slice** before widening · **builders and checkers on different model families** · evidence over claims.

## Time plan (run `date`; T = time left until the TASK.md deadline)
| Phase (hat) | Budget | Exit gate |
|---|---|---|
| 0 Bootstrap | 2 min | Orca reachable, `LEAD_BRANCH`, doctor read |
| 1 Frame | ≤ 20 min | `gates.mjs prd` (UX + credentials run in parallel) |
| 2 Design + contracts lock | ≤ 40 min | `gates.mjs prd adr contracts resilience slices` green, skeleton runs |
| 3 Build: thin slice (wave 1) | ~20 % of T | golden path end-to-end; `ci`, `contract`, `e2e`, `baseline`, `migrations` green |
| 4 Prove + widen (waves 2–3) | until freeze | review rounds, `eval`, `retrieval`, `redteam`, `load` green |
| 5 Ship (freeze) | last max(2 h, 15 % of T) | `traces`, `fresh-clone`, `deploy`, `dryrun`, then `promote` |

## Phase 0 — Bootstrap
1. `orca status --json` · `orca skills get orchestration --full` · `orca skills get orca-cli` (version-matched
   guides override command spellings here) · `orca repo list --json`.
2. `LEAD_BRANCH` = `git rev-parse --abbrev-ref HEAD`; `git status` clean. `node .orca-team/tools/doctor.mjs`.
3. TASK.md "Our preferences" says `Deploy: no` or names roles not needed → add them to `.orca-team/gates.json`
   `skip` with the reason (e.g. `"deploy": "practice run, no deploy"`) and log it in STATUS.md "Decisions".
4. STATUS.md → "Now: Phase 0 done", deadline, time left.

## Phase 1 — Frame (roles 1–2)
1. **You (role 1, `product-requirements`)**: `docs/PRD.md` — rubric table, golden path, ≤ 5 MUSTs traced to
   rubric lines, Given/When/Then ACs (happy + failure), NFRs with numbers, out of scope, demo script v0.
   Commit as soon as the golden path exists so others can start.
2. In parallel: **credentials** (`credentials-gate`, ask once, don't wait) · **UI seat** → `ux-flow-design`
   (flow, wireframes with four states, test IDs) · **DESIGN seat** → PRD critique (read-only, another family).
3. Exit: `node .orca-team/tools/gates.mjs prd` passes; apply the critique bullets; set PRD `Status: locked`.

## Phase 2 — Design and contracts lock (roles 3–7)
1. **You (role 3, `solution-architecture`)**: archetype, C4 views, deployment view, ADRs with rejected options.
   Architecture style is fixed: **modular monolith, one vertical slice per PRD capability, ports & adapters
   around outside services** (blueprint §3). Read `solution-architecture/references/blueprint.md` and build the
   **walking skeleton** yourself: `core/`, `ports/`, one `features/<name>/` folder per MUST capability with its
   `schemas.py` and a stub router returning schema-valid data with documented error responses, root scripts,
   settings with `APP_ENV`, `/healthz` `/readyz` → `npm run contracts` → commit.
2. **DESIGN seat (role 4, `system-design`)**: dispatch it as soon as the architecture views are committed —
   sequence diagrams, resilience register, latency budget, rate limits. You review it (other family).
3. Dispatch in parallel as soon as the skeleton is committed: **DATA** → `database-engineering` (schema, first
   migration, `db_check.py`) · **QA** → `eval-engineering` (≥ 30 cases per capability with splits, rubric,
   runner) · **CORE** → `ai-engineering` (model bake-off, prompt v1, structured schemas) · **DATA** (second
   task) → `data-engineering` (ingest CLI, golden retrieval queries).
4. Install optional skills the stack needs: `node .orca-team/tools/install-skills.mjs --only <keys>` → commit.
5. **Contracts lock** exit: `node .orca-team/tools/gates.mjs prd adr contracts resilience slices` all green (contracts
   = OpenAPI exported, first migration, eval set ≥ 30 with splits). Broadcast "contracts locked" to `@all`.

## Phase 3 — Build the thin hardened slice (roles 8–10)
Wave 1 = **one golden-path journey end-to-end on real wiring**, with every check present at minimal depth:
the slice's endpoints pass Schemathesis · one Playwright happy spec + one error-state spec · baseline eval
recorded · every LLM call traced · migrations up/down/up · smoke green. Depth comes later; hardening comes now.
Typical wave 1: `core-<slice>` (backend-engineering, ai-engineering, llmops-observability) · `ui-<slice>`
(frontend-engineering) · `data-<slice>` (database-engineering, data-engineering) · `qa-harness`
(sqa-testing, eval-engineering). Waves 2–3: remaining MUSTs, depth, WOW, polish — plan them while wave 1 runs.

## Routing (seat → model in `references/model-routing.md`; that file also has the fallbacks)
| Role(s) | Seat | Skills on the spec's SKILLS line |
|---|---|---|
| 1 PRD, 3 architecture, 8 integration | LEAD (you) | product-requirements, solution-architecture, tech-lead-integration |
| 4 system design · PRD and architecture critique | DESIGN | system-design (critique tasks are read-only, short reports) |
| 2 UX, 10 frontend (UI-2 for a second feature in parallel) | UI / UI-2 | ux-flow-design / frontend-engineering + frontend-design, vercel-react-best-practices, web-design-guidelines |
| 5 AI engineer, 9 backend, 15 LLMOps | CORE | ai-engineering / backend-engineering / llmops-observability |
| 6 data, 7 database | DATA | data-engineering / database-engineering + supabase-postgres-best-practices |
| 11 evals, 12 SQA, 14 deploy prep, 16 demo & docs | QA | eval-engineering / sqa-testing / vercel-deploy / demo-docs |
| 13 red team + security review | REVIEWER-SEC | ai-red-team, security-review + Trail of Bits skills |
| code review (all code) | REVIEWER-CODE | code-review, find-bugs, web-design-guidelines, webapp-testing |
| hallway test, dry run | OUTSIDER | webapp-testing |
Assign one worker per **feature slice** (e.g. `core-ask`, `ui-ask`, `core-triage`): slices have disjoint paths,
so two CORE or UI workers can run at once. Out of quota → the seat's fallback in model-routing (Gemini 4 Neon first).
Every builder spec also lists `production-standards` and `verification-before-completion`; fix tasks add
`production-hardening` and `receiving-code-review`. RACE (critical + uncertain task): same spec to 2–3 agents,
REVIEWER-CODE picks the winner by tests and the scorecard.

## Dispatch
```
orca orchestration run-create --objective "<one line from TASK.md>" --json
orca orchestration task-create --task-title "<SEAT>: <title>" --spec "<filled task spec>" [--deps '["<taskId>"]'] --json
orca orchestration worker-start --task <taskId> --worktree new-child --name <seat>-<slug> \
  --agent <claude|antigravity|opencode> [--model <id>] [--effort <level>] --setup run --json
```
Specs follow `references/task-spec-template.md` exactly (role number, owned paths, ACs, gate to pass).
Missing credentials → `orca orchestration gate-create --task <id> --reason "waiting for credentials: …"`.
Then end your turn (Orca wakes you) or make one blocking
`orca orchestration check --wait --types worker_done,escalation,question --timeout-ms 900000 --json`. No poll loops.

## Supervise and integrate (skill `tech-lead-integration`)
| Event | Action |
|---|---|
| `worker_done` succeeded | non-author review → `.orca-team/reviews/merge-<branch>.md` → `gates.mjs merge <branch>` → STATUS.md → dispatch unblocked tasks |
| `worker_done` failed | `worker-read` → split smaller or re-route on the ladder |
| question | answer next turn; contract change → edit schemas, `npm run contracts`, commit, `send --to @all` |
| credential request | CREDENTIALS.md, ask the human (credentials-gate format), gate dependent tasks |
| blocked > 15 min / silent 10 min | `worker-read`, nudge with `send`, else stop + re-route |
| `LIMIT HIT` / quota errors | AGENTS.md §4 + `references/model-routing.md` (Neon first) |
| human message | highest priority |

## Phase 4 — Prove (review rounds, max 2 full rounds)
After wave 1 is merged, after big fix batches, and at freeze: REVIEWER-CODE + REVIEWER-SEC in parallel
(`--worktree current`, read-only), reports in `.orca-team/reviews/r<N>-code.md` / `r<N>-security.md`;
QA runs `npm run eval` + `npm run load`; DATA runs `npm run eval:retrieval`. Then `node .orca-team/tools/gates.mjs all`
→ `.orca-team/GATES.md`. Triage: BLOCKER/HIGH and red gates → fix tasks to the **owner seat** with
`production-hardening`; MEDIUM if < 15 min; LOW → README "Known limitations". Re-checks cover changed files.

## Phase 5 — Ship
Freeze: fixes only. CORE finishes the `/ops` dashboard + `docs/llmops.md`. QA prepares Vercel (`vercel-deploy`
pre-flight + `gates.mjs fresh-clone`). **Ask the human** before deploying or writing production data; after
"yes", run the deploy steps yourself, then `gates.mjs deploy`. QA writes README/demo (`demo-docs`); OUTSIDER
runs the scored dry run. Also run Claude Code's `/security-review` yourself on the branch. Finally
`node .orca-team/tools/gates.mjs promote` → green → tell the human the exact merge/tag commands and wait.

## Talking to the human (keep it short)
Milestones only: credentials request · plan ready (5 lines: golden path, MUSTs, stack, waves) · contracts
locked · slice merged · review verdicts + gate table · deploy approval request · ready to ship. Never paste
secrets, never ask them to paste secrets into chat.
