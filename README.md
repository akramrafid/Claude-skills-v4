# Claude Skills v4 — AI Engineering Hackathon

22 skills for Claude Code (also read by OpenCode and Antigravity): one for each of the 16 hackathon roles,
plus 6 that run the team and review the code to production grade. Each role skill names its hand-off files
and a runnable "done" check (`node .orca-team/tools/gates.mjs <check>`).

| Hat | Skills |
|---|---|
| Frame | `product-requirements`, `ux-flow-design` |
| Design | `solution-architecture`, `system-design`, `ai-engineering`, `data-engineering`, `database-engineering` |
| Build | `tech-lead-integration`, `backend-engineering`, `frontend-engineering` |
| Prove | `eval-engineering`, `sqa-testing`, `ai-red-team` |
| Ship | `vercel-deploy`, `llmops-observability`, `demo-docs` |
| Review & run | `code-review`, `security-review`, `production-hardening`, `production-standards`, `swarm-lead`, `credentials-gate` |

- **[INSTALL.md](INSTALL.md)** — copy-paste PowerShell steps (project or all projects).
- **[SKILLS-INDEX.md](SKILLS-INDEX.md)** — every role → skill → hand-off → check.
- `skills/` — the skill folders (`SKILL.md` + `references/` code templates).
- `orca-team-tools/` — the check runner (`gates.mjs`), test-server helper, Vercel env tool, env checker.

Quick install into a project:
```powershell
git clone https://github.com/akramrafid/Claude-skills-v4 "$env:TEMP\claude-skills-v4"
Copy-Item "$env:TEMP\claude-skills-v4\skills\*" ".claude\skills\" -Recurse -Force
Copy-Item "$env:TEMP\claude-skills-v4\skills\*" ".agents\skills\" -Recurse -Force
```
Run those from the project folder; see INSTALL.md for the check tools and for removing old v3 skills.

## Which model plays which seat
Skills name **seats**, not models. One file maps seats to models:
[`skills/swarm-lead/references/model-routing.md`](skills/swarm-lead/references/model-routing.md) — change models there only.

| Seat | Work | Model (effort) | Out of quota → |
|---|---|---|---|
| LEAD | requirements, architecture, integration | Claude Opus 5.5 (max) | Gemini 4 Neon max → Muse Wonder max |
| DESIGN | system design, PRD/architecture critique | Gemini 4 Neon (max) | Muse Wonder max → Opus max |
| UI | UX, frontend | Gemini 4 Neon (xhigh) · second UI slice: Gemini 4 Hydrogen (xhigh) | Hydrogen xhigh → Muse Wonder max |
| CORE | backend, AI engineering, LLMOps | Claude Sonnet 5.5 (max) | Gemini 4 Neon xhigh → Kimi K3.1 Pro max |
| DATA | data + database | Kimi K3.1 Pro (max) | Gemini 4 Neon xhigh → Muse Wonder max |
| QA | evals, tests, deploy prep, docs | Kimi K3.1 Pro (max) | Gemini 4 Neon xhigh → Hydrogen xhigh |
| REVIEWER-CODE | code review | Claude Opus 5.5 (max) | Gemini 4 Neon max |
| REVIEWER-SEC | security review, red team | Muse Wonder (max) — never Kimi | Gemini 4 Neon max |
| OUTSIDER | hallway test, dry run | Muse Wonder (max) | Gemini 4 Hydrogen xhigh |

**Any model out of quota → Gemini 4 Neon** (xhigh to build, max to design and review). A checker never shares
the author's model family (Anthropic · Google · Meta · Moonshot).

## Architecture the skills build
Modular monolith · **vertical slices** (`apps/api/app/features/<name>/`, `apps/web/src/features/<name>/`) ·
**ports & adapters** around the LLM, embeddings, vector store and database. One MUST feature = one slice = one
backend worker + one frontend worker, so parallel agents never edit the same files. `gates.mjs slices` (also run
inside `gates.mjs merge`) fails when a feature imports another feature or a service imports FastAPI, an SDK or
the ORM. Full rules: `skills/solution-architecture/references/blueprint.md` §3.
