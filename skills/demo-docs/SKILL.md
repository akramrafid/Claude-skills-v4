---
name: demo-docs
description: Role 16 (Ship hat) - demo and docs lead. Writes the README judges read first (value, live URL, architecture, production-grade evidence, one-command run, configuration, testing, limitations), polishes docs/architecture.md, writes the 3-minute demo script with a rubric evidence map and copy-paste demo inputs, prepares demo safety (replay mode, backup video), and runs a scored dry run where an outsider model of a different family follows the README and the demo script and scores every rubric line. README and demo templates in references/readme-and-demo.md. Use from feature freeze to submission and after any change to run steps. Done check - node .orca-team/tools/gates.mjs dryrun.
---

# Demo & Docs — Role 16 · Ship hat

**Seat:** QA writes (models: `swarm-lead/references/model-routing.md`). **Independent check:** OUTSIDER — any model family other than the
author's — runs the dry run and scores it. **Hand-off:** `README.md`,
`docs/architecture.md` (polished), `docs/demo.md`, `docs/demo-inputs.md`, `docs/dry-run.md`.
**Done when:** `node .orca-team/tools/gates.mjs dryrun` passes.

Read `references/readme-and-demo.md` for the README skeleton, demo beats, evidence map and safety list.

## Steps
1. **README** — top 30 lines sell it: one-line value, live URL (from `.orca-team/deploy.json`), 3 bullets of
   what it does, architecture diagram, "Production-grade by design" with real numbers pulled from the gates
   (eval held-out score, tests passing, contract tests, red-team pass rate, p95 latency, cost per request).
   Then: Run it (`cp .env.example .env` → `npm run up`), Configuration table, Testing (`npm run ci`,
   `npm run gates`), Known limitations. Every command in README must be one that `gates.mjs fresh-clone` runs.
2. **Architecture doc** — keep role 3's views current; add the deployed URLs and the request flow.
3. **Demo script** `docs/demo.md` — 3 minutes, beats mapped to rubric ids (from `docs/PRD.md`), plus the
   evidence map (criterion → what we show → where). One wow moment in the middle.
4. **Demo inputs** `docs/demo-inputs.md` — exact copy-paste inputs that are tested on the final build.
5. **Safety** — `DEMO_REPLAY=record` on the final build, backup screen recording, local run ready.
6. **Dry run** (below), fix what it finds, re-run if the score is below target.

## Dry run (independent, scored)
Ask LEAD to dispatch OUTSIDER with only: `TASK.md` (rubric), `README.md`, `docs/demo.md`, the live URL (or
local run). It must:
1. Follow README "Run it" exactly in a fresh clone (or rely on the `gates.mjs fresh-clone` result) and
   report any step that needed guessing.
2. Perform every demo beat on the app (`webapp-testing` for screenshots) and time it.
3. Score each rubric line 0–10 with one sentence of evidence; compute the weighted total out of 100.
4. List confusions and blocking issues.
Record `docs/dry-run.md` (the gate parses these lines):
~~~markdown
# Dry run
Author: opencode/kimi-k3.1-pro · Tester: opencode/muse-wonder · Build: <commit> · URL: <url or local>
| Rubric | Weight | Score 0–10 | Evidence |
|---|---|---|---|
Total: 84/100
Demo time: 2:52
Blocking issues: none
Confusions: <list>
~~~
Pass = total ≥ `dry_run_min` (default 80, `.orca-team/gates.json`), `Blocking issues: none`, demo ≤ 3:00,
tester family ≠ author family.

## The check
`gates.mjs dryrun` verifies the dry-run file (score, blocking issues, families), README sections (`Run it`,
`Architecture`, `Testing`), and that `docs/demo.md` exists with a timing table.

## Anti-patterns
README that lists features nobody can find in the demo · run steps that only work in the author's worktree ·
numbers in README that no gate produced · rehearsing with the author model as the judge · live coding on stage.
