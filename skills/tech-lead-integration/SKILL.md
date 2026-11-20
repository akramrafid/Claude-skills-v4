---
name: tech-lead-integration
description: Role 8 (Build hat) - tech lead and integrator. Defines branch rules (worker branches into LEAD_BRANCH, LEAD_BRANCH into main only after full gates and human approval), merge order, the merge gate (no-commit merge, vertical-slice boundary check, npm run ci, commit or abort), non-author review for every merge, cross-family review rounds, conflict resolution toward the contract, commit conventions and the promotion checklist. Use whenever a worker branch is ready to merge, when the integration branch turns red, and before anything reaches main. Done check - node .orca-team/tools/gates.mjs merge BRANCH for each merge and gates.mjs promote before main.
---

# Tech Lead / Integrator — Role 8 · Build hat

**Seat:** LEAD (models: `swarm-lead/references/model-routing.md`). **Independent check:** every merge is reviewed by a non-author; every
review round uses two model families; `main` needs the human's approval. **Hand-off:** a green
`LEAD_BRANCH`, `.orca-team/STATUS.md` "Merged", review files in `.orca-team/reviews/`.

## Branch model
```
main            release · only from LEAD_BRANCH · gates.mjs promote green + review verdicts SHIP + human "yes"
LEAD_BRANCH     integration (e.g. lead) · every merge through gates.mjs merge
<seat>-<slug>   worker branches (core-ask, ui-chat, data-ingest, qa-evals, …) · created by Orca worktrees
race-<slug>-<agent>  RACE candidates · only the winner is merged
```
Nothing reaches `main` without CI green + non-author review. Nobody pushes; the human pushes or approves.

## Merge order (dependency order, one at a time)
contracts/schemas → data (migrations, ingest) → core (services, adapters) → ui → qa/docs.
Conflicts resolve **toward the contract** (`contracts/openapi.json`, migrations, eval set). If both sides
changed behaviour, keep the one that satisfies the PRD AC and dispatch a fix task to the other owner.

## The merge gate — for every `worker_done`
1. Read the worker report (branch, commits, how to test, new deps, new env vars).
2. **Non-author review** (you didn't write it): `git diff LEAD_BRANCH...<branch>` — scope matches owned
   paths · AC covered by tests named after AC ids · no secrets · no contract edits · new env vars in
   `.env.example`. Write 3–8 lines to `.orca-team/reviews/merge-<branch>.md` ending `Verdict: MERGE | FIX`.
3. `node .orca-team/tools/gates.mjs merge <branch>` → it runs `git merge --no-ff --no-commit <branch>`,
   then the slice check (no feature imports another feature; services free of FastAPI/SDK/ORM imports),
   then `npm run ci`; green → commits `merge: <branch>`; red → `git merge --abort` and prints the failure.
4. Red → load `systematic-debugging`, find the root cause, fix it yourself if ≤ 5 minutes, else dispatch a
   fix task with the root cause to the owner. Never leave `LEAD_BRANCH` red.
5. STATUS.md → Merged, then dispatch tasks this merge unblocked.

## Review rounds (cross-family, after wave 1, after big fix batches, before freeze)
Run in parallel, read-only (`--worktree current`): REVIEWER-CODE (Opus, skill `code-review`) and
REVIEWER-SEC (Muse Wonder, skills `security-review` + `ai-red-team`). Gemini-built UI gets its code review
from Claude; Claude-built backend gets its security review from Meta's model; Kimi-built data and QA work
gets both. Models per `swarm-lead/references/model-routing.md`. Fixes go back to the **owner seat** with `production-hardening` + `receiving-code-review`; reviewers
re-check only changed files. Max 2 full rounds.

## Promotion to main
`node .orca-team/tools/gates.mjs promote` runs every gate (all 16 roles + `--strict` traceability) and checks
the latest code and security verdicts are `SHIP` from two different model families. Green → tell the human
the exact commands (`git checkout main && git merge --no-ff <LEAD_BRANCH> && git tag v1.0`) and wait for
their "yes". Red → the gate table in `.orca-team/GATES.md` says which role owns each failure.

## Conventions
Commits: Conventional Commits (`feat(api): stream answers`, `fix(web): retry on 429`, `test(evals): …`).
Branch names: `<seat>-<slug>`. One logical change per commit. Tags: `v1.0` on the submitted commit.
CI on GitHub (optional): `references/ci-and-hygiene.md` runs the same `npm run ci`.

## Anti-patterns
Merging two branches at once · "I'll fix main later" · merging without reading the diff · reviewers from the
author's family only · force-pushing · resolving conflicts by deleting the other side's tests.
