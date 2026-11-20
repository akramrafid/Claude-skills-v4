---
name: ai-engineering
description: Role 5 (Design hat) - AI engineer. Chooses models with a small measured bake-off (quality, latency, cost, limits) and a fallback, designs the RAG or agent pipeline, writes versioned prompt files and Pydantic structured-output schemas, sets token budgets and guardrails, and records a baseline eval before any prompt tuning. Covers the provider-agnostic LLM client with retries, fallback, mock and demo-replay modes (references/llm-client.md) and bounded tool-using agents (references/agents.md). Use for any LLM, RAG-answering, structured-output or agent work in the product. Done check - node .orca-team/tools/gates.mjs baseline.
---

# AI Engineering — Role 5 · Design hat

**Seat:** CORE (models: `swarm-lead/references/model-routing.md`); LEAD approves the model ADR. **Independent check:** the eval set
is written by QA (OpenCode, role 11) and scored by a judge model from a different family than the generator.
**Hand-off:** `docs/ai-design.md`, `apps/api/app/features/<name>/prompts/*.md`, schemas in `app/features/<name>/schemas.py`,
`apps/api/evals/results/baseline.json`. **Done when:** `node .orca-team/tools/gates.mjs baseline` passes.

Read `references/llm-client.md` (adapter, mock/replay, prompts as files, untrusted input, budgets) before
writing code. Agents → `references/agents.md`. Retrieval internals → `data-engineering`.

## Rule zero: baseline before tuning
Build the simplest working pipeline (prompt `v1`, default parameters), then run `npm run eval:baseline`
and commit `evals/results/baseline.json`. Every later prompt, model or retrieval change is judged against it
on the **dev** split (`npm run eval:dev`); keep a change only if dev improves and nothing regresses. The
**held-out** split is run by role 11 at round end — never tune on it.

## 1. Model choice (measured, not guessed)
1. Candidates = models you actually have keys for (see `.orca-team/CREDENTIALS.md`); include one cheap/fast.
2. Bake-off on 10 dev cases: quality (deterministic checks), p50/p95 latency, TTFT, cost per case, JSON-mode
   or tool-calling support, context window, rate limits, language support (e.g. Bangla).
3. Choose primary + fallback from **different providers** where possible. Write ADR + table in ai-design.md.
4. Judge model for evals (`EVAL_JUDGE_MODEL`) must be a different family than the generator (`LLM_MODEL`).

## 2. Pipeline design
- **Workflow before agent.** Fixed steps (classify → retrieve → answer → validate) beat an agent loop unless the
  task needs open-ended tool choice. Agents: bounded steps, tokens, time; typed tools; approval for side effects.
- **RAG answering:** retrieve (from role 6) → filter by trust/tenant → pack context with ids → answer with
  inline `[n]` citations → validate citations exist → refuse ("I don't know") under a relevance threshold.
- **Structured outputs:** Pydantic model → JSON schema mode or tool calling → validate → one repair retry →
  safe fallback object with `needs_human=true`. Enums for labels; `confidence` 0–1; `reasons` short.
- **Guardrails:** untrusted text in delimited blocks, never in the system prompt; retrieved instructions are
  data; output rendered as text/Markdown sanitised; canary string in the system prompt for leak tests (role 13).
- **Budgets:** `max_tokens` per call, context cap, per-request time budget, per-user rate limit (role 4).

## 3. Prompts are versioned files
`app/features/<feature>/prompts/<name>.v<N>.md` with a front block: purpose, variables, output schema name, changelog line.
Bump the version for any change; the trace (role 15) and eval history record the version used.

## 4. `docs/ai-design.md` template (gate checks the headings)
~~~markdown
# AI design
## Model choice
| Model | Role | Quality (dev) | p95 latency | Cost/req | Notes |
Primary: <model> · Fallback: <model> · Judge: <model, other family> · Embeddings: <model, dim>
## Pipeline
<Mermaid flowchart of steps, with timeouts>
## Prompts
| Name | Version | Purpose | Inputs | Output schema |
## Structured outputs
<schema names, validation, repair, fallback object>
## Guardrails and budgets
## Baseline
<link to evals/results/baseline.json · headline metrics · commit>
## Tuning log
| Date | Change | Dev before → after | Kept? |
~~~

## 5. Code expectations (details in references)
One `LLMClient` used everywhere (timeouts, retries, fallback, `max_tokens`, cost logging, trace emission
for role 15) · `LLM_MOCK=1` deterministic fake · `DEMO_REPLAY=record|replay` · prompts loaded from files ·
no provider SDK calls outside adapters · structured output parsing tested with fixtures.

## The check
`gates.mjs baseline` verifies `docs/ai-design.md` has the required sections and
`evals/results/baseline.json` exists with `commit`, `metrics`, `prompt_versions`, and that its commit is an
ancestor of HEAD (the baseline came first).

## Pair with
`claude-api` (optional, when the product calls Claude) · `qdrant-clients-sdk` (Qdrant) · `mcp-builder`
(MCP tools) · `verification-before-completion`.

## Anti-patterns
Tuning prompts without a baseline · judging with the generator model · prompt strings in code · trusting
model JSON without validation · agents where a workflow would do · no fallback · unbounded tokens or loops.
