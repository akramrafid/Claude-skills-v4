# Task spec templates (paste into `--spec`, fill every field)

## Builder task
```
ROLE: <SEAT: CORE|UI|DATA|QA> · role <n> <name, e.g. 9 Backend engineer> · hat <frame|design|build|prove|ship>
LEAD_BRANCH: <branch>
TASK: <id> — <title>          WAVE: <1|2|3>      FEATURE: <slice name, e.g. ask | — for shared work>
MODEL: <agent · model · effort from model-routing.md; on LIMIT HIT LEAD restarts on Gemini 4 Neon>
SKILLS: production-standards, verification-before-completion, <role skill>, <external skills>
        (AGENTS.md §2 — e.g. UI: frontend-engineering, frontend-design, vercel-react-best-practices, web-design-guidelines)
GOAL: <one or two sentences: the user-visible outcome>
OWNED PATHS (only these may be edited):
  - <path/glob — for a slice: apps/api/app/features/<name>/** except schemas.py, apps/api/tests/features/<name>/**>
READ-ONLY CONTEXT: TASK.md, docs/PRD.md (ACs <ids>), contracts/openapi.json, docs/system-design.md, <files>
CONTRACT: <endpoints / schemas / tables / eval capability this task implements or consumes>
ACCEPTANCE CRITERIA (from docs/PRD.md — name tests after the AC ids):
  AC-<n>: Given <state>, when <action>, then <observable result>.
  AC-<m>: Given <bad input / dependency down>, then <specific error shape/status>.
GATE TO PASS: node .orca-team/tools/gates.mjs <id>   (+ npm run ci)
ENV VARS NEEDED: <VAR1, VAR2 | none> (if missing: build in test mode / LLM_MOCK and say so in the report)
DEV PORT: <port>
OUT OF SCOPE: <what not to touch or build>
DONE WHEN: ACs pass + gate passes + production-standards definition of done + worker_done report sent.
```

## Reviewer task
```
ROLE: REVIEWER-<CODE|SEC>
LEAD_BRANCH: <branch>
TASK: <id> — Review round <N>
SKILLS: CODE → code-review, production-standards, find-bugs, web-design-guidelines, webapp-testing
        SEC  → security-review, ai-red-team, differential-review, insecure-defaults, semgrep, supply-chain-risk-auditor
DIFF RANGE: git diff <base-commit>...HEAD   (base = <commit or branch>)
AUTHORS IN RANGE: <seat/agent/model per area — e.g. api/ask: CORE claude sonnet · web/ask: UI Gemini 4 Neon>
FOCUS: <areas changed this round>
GOLDEN PATH: <steps from docs/PRD.md to run end-to-end>
HOW TO RUN: npm run ci · npm run dev:api · npm run dev:web · gates: node .orca-team/tools/gates.mjs <ids>
REPORT: .orca-team/reviews/r<N>-<code|security>.md (only file you may write; title line contains
        "reviewer: <agent/model>"); commit it; then worker_done with verdict and counts per severity.
```

## Critique / outsider task (read-only, short)
```
ROLE: <DESIGN|OUTSIDER>   LEAD_BRANCH: <branch>   TASK: <id> — <PRD critique | architecture critique | hallway test | dry run>
INPUT ONLY: <files / URL you may look at — nothing else>
OUTPUT: <.orca-team/reviews/prd-critique.md | docs/ux/hallway-test.md | docs/dry-run.md> in the format of skill <name>
RULE: you did not build this; judge it as an outsider. Max 15 bullets. Commit, then worker_done.
```

## RACE task (same spec to 2–3 agents)
Use the builder template and add:
```
RACE: yes — competing implementations exist. Optimise for passing the gate, correctness, simplicity, latency.
Branch name must be race-<slug>-<agent>. Do not look at other race branches.
```

## Fix task (from review findings or red gates)
```
ROLE: <owner seat>   LEAD_BRANCH: <branch>   TASK: <id> — Fix review r<N> findings / gate <id>
SKILLS: production-standards, production-hardening, receiving-code-review, verification-before-completion, <role skill>
FINDINGS TO FIX: <ids + file:line from .orca-team/reviews/r<N>-*.md, or the failing lines from .orca-team/GATES.md>
DONE WHEN: each finding has a test proving the fix (where testable), npm run ci + the gate are green,
           report lists finding → commit → test.
```
