---
name: code-review
description: REVIEWER-CODE protocol - verify by running npm run ci and the role gates, walk the golden path, then review the diff for correctness against PRD acceptance criteria, contract consistency, reliability, async and resource misuse, data integrity, AI quality, frontend states and test quality, and score it on a production-grade scorecard (industry standards). Fixed severity definitions, verdict rule, RACE comparison rubric, report template with concrete patches, and fix routing to the owner seat with production-hardening. Use when assigned a code review round, a re-check after fixes, or a RACE decision.
---

# Code Review

You are the last line of defence before judges see the product. Be specific, verify claims by running code,
propose patches — don't rewrite the codebase. Read-only except your report file.

## 1. Procedure
1. Read `TASK.md`, PLAN.md §2 (golden path) and §3 (MUST features + acceptance criteria), your spec (diff range).
2. Verify mechanically — record each result in the report:
   `npm run ci` (lint, typecheck, tests, smoke in test mode) · the gates of the roles whose code changed
   (`node .orca-team/tools/gates.mjs contract e2e eval …`, or `gates.mjs all` at the final round) ·
   start the app (`npm run dev:api -- --port 8010`, web if relevant) and walk the golden path by hand
   (curl or browser via `webapp-testing`).
3. Read the diff (`git diff <range> --stat`, then file by file). Start with schemas/contracts and ports, then
   each slice (service → deps → router → its UI → its tests), then shared/ and adapters.
4. Check integration across slices: UI calls match the contract; CORE returns what UI expects; error shapes
   handled in UI; env vars documented.
5. Write findings. Only report what you can point to (`file:line`) and explain. Mark uncertainty explicitly.

## 1b. Tools that make the review stronger (use them, then report in OUR format)
- **`/pr-review-toolkit:review-pr code errors tests types parallel`** (Claude plugin): parallel sub-agents incl.
  `silent-failure-hunter` (swallowed errors, bad fallbacks) and `pr-test-analyzer`. Don't run its `simplify`
  aspect — you are read-only. Re-grade its findings with the severity table in §3.
- **`find-bugs`** skill: a second, security-aware pass over the diff. Use the diff range from your spec instead
  of its default-branch detection.
- **`web-design-guidelines`** for any UI files in the diff (accessibility, UX, interface rules).
- **`webapp-testing`**: drive the golden path in a real browser; attach screenshot paths and console errors
  as evidence.
- **`supabase-postgres-best-practices`** when migrations, schemas or queries changed.
- **`verification-before-completion`**: every ✅ in your report is backed by command output you actually ran.

## 2. Checklist
**Correctness** — acceptance criteria met · edge cases (empty, huge, unicode, duplicates, concurrent) ·
off-by-one/pagination · time zones (UTC) · idempotency of retried writes.
**Contract** — response bodies validate against schemas · status codes · problem+json errors · exported
`contracts/openapi.json` matches code (drift test passes).
**Reliability** — timeouts on every external call · retries only for transient errors · fallbacks · no
swallowed exceptions · readiness checks real dependencies.
**Async/resources** — no blocking I/O in async handlers (`requests`, sync DB, `time.sleep`) · awaited
coroutines · clients created once (lifespan) and closed · no shared mutable state across requests.
**Data** — transactions around multi-step writes · constraints/indexes · migrations reversible-safe · no N+1
on the demo path · seed idempotent.
**AI quality** — prompts in versioned files · structured outputs validated + repaired · grounding/citations ·
"I don't know" path · token caps · cost/latency logged · eval set present and passing threshold · mock and
replay modes work.
**Frontend** — types generated from contract · loading/empty/error states · streaming with Stop · sanitised
Markdown · test IDs on golden path · no secrets/provider calls in browser.
**Tests** — assert behaviour not just status · error paths covered · fakes instead of network · no sleeps.
**Maintainability** — slice rules kept (no feature imports another feature; router thin; service imports
only ports/schemas/shared; SDK and ORM code only in `adapters/`; `main.py` and `schemas.py` touched only
by LEAD) · no dead code/TODO in MUST
features · names clear · duplicated logic from parallel merges removed.
**Production-standards anti-patterns** — any one is at least HIGH.

## 2b. Production-grade scorecard (1–5 each; put the table in the report)
| Dimension | Standard it is judged against | 5 means |
|---|---|---|
| Correctness | PRD acceptance criteria | every MUST AC proven by a named test |
| Contract & API | OpenAPI 3.1, RFC 9457 | Schemathesis clean, errors documented |
| Reliability | SRE practice, resilience register | timeouts, retries, fallback, fault tests pass |
| Security | OWASP Top 10 2025, LLM Top 10 2026 | REVIEWER-SEC finds nothing above LOW |
| AI quality | eval held-out vs baseline | above threshold, judged cross-family, no regression |
| Performance | PRD NFRs | k6 thresholds and TTFT target met |
| Maintainability | slice rules, typing, lint | small modules, strict types, no dead code |
| Tests | test plan | behaviour asserted, error paths, coverage ≥ 80 % on feature services + shared |
| Operability | 12-Factor, golden signals | one-command run, traces, health/readiness, docs true |
| UX & a11y | WCAG 2.2 AA, docs/ux | four states, axe clean, hallway test passed |
Any dimension ≤ 2 on the golden path is at least a HIGH finding.

## 3. Severity and verdict
| Severity | Meaning |
|---|---|
| BLOCKER | Golden path broken · build/tests red · crash/data loss · secret exposed · contract mismatch causing errors |
| HIGH | Wrong result in a MUST feature · unhandled boundary error → 500 · missing timeout · race condition · core logic untested · production-standards anti-pattern |
| MEDIUM | Will bite during the event: fragile code, missing edge case off the golden path, perf issue off the demo path |
| LOW | Naming, small refactors, docs |
Verdict: any BLOCKER → `FIX-BLOCKERS` (or `REWORK` if the design is wrong, e.g. slices don't fit the contract
or the wrong approach for a MUST) · only HIGH and below → `FIX-BLOCKERS` if any HIGH is on the golden path,
else `SHIP` · none → `SHIP`.

Fixes go to the **owner seat** (not you) as a fix task with skills `production-hardening` +
`receiving-code-review`. Re-check rounds review only the changed files and the findings list.

## 4. RACE comparison (when asked to pick a winner)
Gate: tests pass. Then score each branch 1–5 on: acceptance-criteria coverage · correctness on edge cases ·
simplicity (code size, dependencies) · latency/cost · readability and fit with the codebase. Table + winner +
one paragraph why + anything worth porting from the losers.

## 5. Report — `.orca-team/reviews/r<N>-code.md`
~~~markdown
# Code review r<N> — <date/time> — reviewer: <agent/model>
Authors reviewed: <seat/agent/model, …>
Verdict: SHIP | FIX-BLOCKERS | REWORK
Summary: <3 lines: overall state, biggest risk, what's solid>
Verified: ci ✅/❌ · gates <ids> ✅/❌ · golden path by hand ✅/❌ · evals <held-out rate>
Scorecard: <table from §2b>
Counts: BLOCKER <n> · HIGH <n> · MEDIUM <n> · LOW <n>

## Findings
### CR-1 [BLOCKER] <short title>
File: `path/to/file.py:123` · Owner: <role / branch>
Problem: <what is wrong, with evidence (command output, input that breaks it)>
Why it matters: <impact on demo/users/judging>
Fix:
```diff
- old
+ new
```

## Keep (max 3 things done well)
~~~
Commit the report (`git add .orca-team/reviews/r<N>-code.md && git commit -m "review: r<N> code"`), then send
`worker_done` with verdict and counts.
