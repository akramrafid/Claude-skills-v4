---
name: eval-engineering
description: Role 11 (Prove hat) - eval engineer. Builds the golden dataset (30 to 100 cases per capability, tagged, split into dev and a locked held-out set), deterministic checks first and an LLM-as-judge rubric with anchored scores using a judge model from a different family than the generator, a budget-capped runner that writes per-commit results and history, regression detection, and a judge sanity check. Runner code in references/eval-runner.md. Use when an LLM feature exists or is planned, before tuning prompts, at every review round and before promotion. Done check - node .orca-team/tools/gates.mjs eval (held-out score at or above threshold, no regression, judge family differs, held-out set unchanged since lock).
---

# Eval Engineering — Role 11 · Prove hat

**Seat:** QA (models: `swarm-lead/references/model-routing.md`). **Independent check:** the judge model is from a different family than the
generator; the held-out split is locked by hash so nobody tunes on it. **Hand-off:**
`apps/api/evals/datasets/*.jsonl`, `evals/rubrics/*.md`, `evals/config.json`, `evals/run.py`,
`evals/results/latest-heldout.json`, `evals/history.jsonl`. **Done when:**
`node .orca-team/tools/gates.mjs eval` passes.

## 1. Dataset (one JSONL per capability, e.g. `ask.jsonl`, `triage.jsonl`)
```json
{"id": "ASK-014", "split": "heldout", "capability": "ask", "ac": "AC-1",
 "tags": ["fact", "bn"], "input": {"question": "৩০ ঘণ্টা আউটেজে কত ক্রেডিট পাব?"},
 "reference": "5 days of service credit",
 "checks": [{"type": "key_facts", "facts": ["5 day|৫ দিন"]}, {"type": "citations", "min": 1},
            {"type": "judge", "rubric": "answer_quality", "min_score": 4}]}
```
- **Size:** 30–100 cases per capability. Sources: PRD ACs (tag `ac`), provided data, edge cases, every
  language, refusals ("I don't know"), adversarial inputs (role 13 owns the deep attack suite).
- **Split:** ~70 % `dev` / 30 % `heldout`, stratified by tag (each tag present in both).
- **Lock:** `uv run python -m evals.run --lock` writes the held-out hash to `evals/config.json`. After the lock,
  held-out cases are never edited; adding cases = new lock + a line in the report saying why.
- **Labels are reviewed:** every expected answer is traceable to the source data (cite file + section in
  `reference` or `notes`). Wrong labels poison everything.

## 2. Checks (deterministic first, judge last)
`label` (exact field match) · `key_facts` (all facts present; `a|b` alternatives) · `refusal` · `citations`
(min count; citation ids must exist in retrieved sources) · `json_valid` · `not_contains` (leaks) ·
`judge` (rubric, min score). A case passes only if all its checks pass.

## 3. LLM-as-judge
- Rubric files `evals/rubrics/<name>.md`: criterion, anchored 1–5 scale (what a 1, 3, 5 look like),
  output `{"score": n, "reason": "…"}`, the answer wrapped in delimiters and marked untrusted.
- **Judge model ≠ generator family** (`EVAL_JUDGE_MODEL` vs `LLM_MODEL`; e.g. Gemini generates → a Claude
  or GPT-class model judges, or vice versa). Only one provider available → use its strongest other model and
  flag it in the report; the gate then warns.
- **Sanity check before trusting the judge:** 10 cases with a known-good and a deliberately wrong answer each;
  the judge must rank good above bad in ≥ 9/10. Record in `evals/results/judge-sanity.json`.
- Temperature 0, `max_tokens` small, JSON mode.

## 4. Runs, budget, history
- `npm run eval:dev` — builders while tuning (role 5). `npm run eval` — held-out, at review rounds and before
  promotion. `npm run eval:baseline` — once, before tuning.
- Budget: `max_calls` in `evals/config.json` (TASK.md may cap calls, e.g. ≤ 100); the runner stops cleanly
  and fails the run as incomplete if exceeded. Concurrency 4.
- Every run writes `results/<timestamp>-<split>.json`, `results/latest-<split>.json`, appends
  `history.jsonl` (`ts, commit, split, n, pass_rate, by_tag, generator_model, judge_model, prompt_versions,
  cost_usd, p50_ms, p95_ms`) and writes `evals/report.md` (per-case table). Commit results with the code.
- Regression: the gate compares with the best previous held-out run; a drop larger than
  `eval_max_regression` (default 0.05) fails even if above threshold.

## The check
`gates.mjs eval` runs `npm run eval`, then verifies: `n ≥ 30` held-out cases evaluated · `pass_rate ≥
eval_threshold` (default 0.80, `.orca-team/gates.json`) · no regression beyond the limit · judge and
generator families differ (warning if not) · held-out hash equals the locked hash.

## Anti-patterns
Tuning on held-out cases · judge = generator · 10 happy-path cases and calling it an eval · labels nobody
checked · exact-string matching on free text · evals that call the API without a budget · results not
committed (no history = no regression detection).
