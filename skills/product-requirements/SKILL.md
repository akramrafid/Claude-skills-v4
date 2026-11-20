---
name: product-requirements
description: Role 1 (Frame hat) - product owner and requirements analyst. Turns TASK.md and the judging rubric into docs/PRD.md - problem, users, golden path, rubric table, user stories with MoSCoW priority, traceability from every MUST to a rubric line, Given/When/Then acceptance criteria, measurable non-functional requirements, out-of-scope list and a 3-minute demo script draft. Use at kickoff before any design or code, whenever scope changes, and when anyone asks why a feature exists. Done check - node .orca-team/tools/gates.mjs prd.
---

# Product Requirements — Role 1 · Frame hat

**Seat:** LEAD (models: `swarm-lead/references/model-routing.md`). **Independent check:** the DESIGN seat (another family) critiques the PRD.
**Hand-off:** `docs/PRD.md`. **Done when:** `node .orca-team/tools/gates.mjs prd` passes and the DESIGN
seat's must-fix points are applied.

Principle: **start from the rubric and the demo.** Judges score the rubric by watching a 3-minute demo. Every
MUST feature exists because a rubric line rewards it, and every MUST appears in the demo. Anything else waits.

## Steps (≤ 15 minutes)
1. Read `TASK.md` fully and list `data/`. Note hard constraints (mandated tech, languages, budgets, offline).
2. **Rubric table.** Copy each judging criterion as `R1…Rn` with its weight. No rubric given → derive one
   from the deliverables (impact, technical depth, AI quality, UX, presentation), mark it `assumed`.
3. **Users.** 1–2 personas: who, context, the job they hire the product for, what "great" looks like.
4. **Golden path.** 5–7 steps a judge will watch, each naming the screen or endpoint. This is the demo spine.
5. **Requirements.** Stories `FR-n`: "As a <persona> I want <capability> so that <outcome>". Priority with
   MoSCoW: MUST (≤ 5, golden path or explicitly demanded) · SHOULD · COULD · WON'T (this event).
   Each row lists the rubric lines it scores and its acceptance-criteria ids.
6. **Acceptance criteria.** For each MUST: at least one happy AC and one failure AC (bad input, dependency
   down, refusal). Concrete values, observable results, no adjectives ("fast", "nice").
7. **Non-functional requirements** with numbers and the gate that measures each: p95 latency, time to first
   token, cost per request, eval score, languages, accessibility (WCAG 2.2 AA), privacy, demo scale.
8. **Out of scope** (WON'T) — written down so nobody builds it.
9. **Demo script v0** — 3 minutes, beats mapped to rubric lines (role 16 polishes it later).
10. **Assumptions** — decide, log, move on. Never ask the human product questions (exception: no problem
    statement at all).

## `docs/PRD.md` template (the gate parses these headings and tables — keep them)
~~~markdown
# PRD — <product name>
_Owner: LEAD · Updated: <time> · Status: draft | locked_

## Problem
<2 sentences: who, pain, why now. One number if TASK.md gives one.>

## Users
- **<Persona>** — <context>; job: <JTBD>; success: <observable outcome>

## Rubric
| ID | Criterion | Weight |
|---|---|---|
| R1 | <copied from TASK.md> | 30 |

## Golden path
1. <user does X on screen/endpoint> → <system shows Y>

## Requirements
| ID | Priority | Story | Rubric | Acceptance |
|---|---|---|---|---|
| FR-1 | MUST | As a <persona> I want <..> so that <..> | R1, R3 | AC-1, AC-2 |
| FR-2 | SHOULD | ... | R2 | AC-3 |

## Acceptance criteria
- **AC-1** Given <state>, when <action>, then <observable result with concrete values>.
- **AC-2** Given <dependency down / bad input>, when <action>, then <specific error/refusal shown>.

## Non-functional requirements
| ID | Requirement | Target | Measured by |
|---|---|---|---|
| NFR-1 | Time to first token (golden path) | < 2 s p95 | gates load / llmops dashboard |
| NFR-2 | Answer quality | ≥ 0.80 held-out | gates eval |

## Out of scope
- <WON'T item — why>

## Demo script
| Time | Beat | Rubric |
|---|---|---|
| 0:00–0:20 | Hook: <persona + pain> | R1 |

## Assumptions
- <decision taken without asking, and why>
~~~

## Traceability rules (enforced later)
- AC ids flow into tests: name tests after them (`test_ac_2_refuses_unknown_question`,
  Playwright `test("AC-1 …")`, eval cases tagged `"ac": "AC-1"`). `gates.mjs prd --strict` (run by `promote`)
  fails if a MUST's AC has no test referencing it.
- Scope change → update PRD first (LEAD only), re-run the gate, broadcast with `orca orchestration send --to @all`.
- Set `Status: locked` when Design starts; after that only LEAD edits, with a one-line note in STATUS.md.

## DESIGN seat critique (cross-family)
Dispatch a short read-only task to the DESIGN seat (Gemini 4 Neon, max): "Read TASK.md and docs/PRD.md. List: rubric points no MUST
covers · ACs that are not testable · MUSTs that are too big for the time left · risky assumptions. Write
`.orca-team/reviews/prd-critique.md`, max 15 bullets." LEAD applies or rejects each bullet (one line why).

## Anti-patterns
More than 5 MUSTs · a MUST with no rubric line · ACs without numbers or observable results · NFRs without a
measuring command · features invented because they are cool, not because they score · asking the human.
