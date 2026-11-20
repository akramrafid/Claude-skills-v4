---
name: ux-flow-design
description: Role 2 (Frame hat) - UX designer. Turns the PRD golden path into a user-flow diagram, low-fidelity wireframes for every screen with all four states (empty, loading, error, success), exact UI copy, data-testid names shared with frontend and QA, accessibility notes, and a hallway test where an outsider model of a different family completes the core flow without hints. Use right after the PRD golden path exists, before frontend work starts, and again on the running UI before freeze. Done check - node .orca-team/tools/gates.mjs ux.
---

# UX Flow Design — Role 2 · Frame hat

**Seat:** UI (models: `swarm-lead/references/model-routing.md`). **Independent check:** OUTSIDER (a non-Gemini model) runs the hallway
test. **Hand-off:** `docs/ux/flow.md`, `docs/ux/wireframes.md`, `docs/ux/hallway-test.md`.
**Done when:** `node .orca-team/tools/gates.mjs ux` passes.

The judges are outsiders who see the product for 3 minutes. If an outsider model can't finish the core flow
from the wireframes alone, neither can a judge.

## Steps
1. Read `docs/PRD.md` (golden path, MUSTs, ACs, personas) and PLAN.md "Design direction".
2. **Flow** — `docs/ux/flow.md`: one Mermaid flowchart of the golden path including error and empty branches
   and where the user recovers. Keep the golden path to ≤ 3 screens.
3. **Wireframes** — `docs/ux/wireframes.md`: one section per screen (format below). One primary action per
   screen; system status always visible (streaming text, progress, which sources were used).
4. **Copy** — write the exact labels, empty-state text, error messages (what happened + what to do next),
   and button text. Errors never blame the user and always offer a recovery action.
5. **Test IDs** — name every element the golden path touches (`data-testid="ask-input"`). This list is the
   contract between UX, frontend (role 10) and QA (roles 12, 16).
6. **Accessibility** — keyboard order, focus after actions, labels for inputs, contrast, `aria-live` for
   streamed answers, reduced motion. Target WCAG 2.2 AA.
7. **Languages** — if TASK.md has non-English users (e.g. Bangla), wireframe with real text in that script;
   check text expansion and fonts.
8. **Hallway test** on the wireframes (below). Fix what fails, re-test once.

## Wireframe section format (the gate checks headings and the four states)
~~~markdown
### Screen: Ask
Purpose: <one line> · Entry: <from where> · Exit: <to where>
```
+--------------------------------------------------+
| Logo        LumaDesk Help             [EN | বাংলা] |
|--------------------------------------------------|
| [ Ask a question about your plan...        ][Ask]|
|                                                  |
| Answer (streams here)                            |
| Sources: [1] Plans & pricing  [2] Refund policy  |
+--------------------------------------------------+
```
Components: question input (`ask-input`), submit (`ask-submit`), answer (`answer`), sources (`citation-<n>`)
States:
- Empty: "Ask anything about plans, billing or outages." + 3 example chips (`example-<n>`)
- Loading: skeleton + "Searching the help center…", Stop button (`ask-stop`)
- Error: "We couldn't answer right now. Try again." + Retry (`ask-retry`); request id shown small
- Success: answer with inline [n] citations; "Not helpful?" link
A11y: input labelled; answer region aria-live=polite; focus moves to answer on completion
~~~

## Hallway test (independent, cross-family)
Ask LEAD to dispatch OUTSIDER (read-only; the author is Gemini, so the tester must not be — see model-routing).
Give the outsider **only** the persona, one task sentence ("You were charged twice — find out if you get a
refund"), and `docs/ux/wireframes.md`. It narrates each step: where it looks, what it clicks or types,
where it hesitated, and whether it reached the goal. Record in `docs/ux/hallway-test.md`:
~~~markdown
# Hallway test
Author: antigravity/Gemini 4 Neon · Tester: opencode/muse-wonder · Material: wireframes | running app
Task: <sentence>
| Step | Expected | What the tester did | Hesitation? |
|---|---|---|---|
Result: PASS | FAIL
Fixes applied: <list>
~~~
PASS = goal reached without hints and at most one hesitation in the whole flow. Before freeze, repeat the
test on the **running app** (the tester drives it with the `webapp-testing` skill and attaches screenshots)
and update the file — that run is the one that counts.

## Pair with
`frontend-design` (one bold, coherent direction) · `web-design-guidelines` (audit) · `webapp-testing`
(hallway test on the running app).

## Anti-patterns
Pixel-perfect mockups before the flow works · screens without error/empty states · copy left as "Lorem" ·
more than one primary action per screen · testing the flow with the same model that designed it.
