# Model routing — the one place that says which model plays which seat

Skills name **seats** (LEAD, DESIGN, UI, CORE, DATA, QA, REVIEWER-CODE, REVIEWER-SEC, OUTSIDER). This file
maps seats to models. Change models here only.

## Seats
| Seat | Roles | Primary: agent · model · effort | When its limit runs out (in order) |
|---|---|---|---|
| LEAD | 1 requirements · 3 architecture · 8 integration | claude · Opus 5.5 (`opus`) · max | agy · Gemini 4 Neon · max → opencode · Muse Wonder · max |
| DESIGN | 4 system design · critiques of PRD and architecture | agy · Gemini 4 Neon · max | opencode · Muse Wonder · max → claude · `opus` · max |
| UI | 2 UX · 10 frontend | agy · Gemini 4 Neon · xhigh | agy · Gemini 4 Hydrogen · xhigh → opencode · Muse Wonder · max |
| UI-2 (optional, parallel UI slice) | 10 frontend | agy · Gemini 4 Hydrogen · xhigh | agy · Gemini 4 Neon · xhigh |
| CORE | 5 AI engineering · 9 backend · 15 LLMOps | claude · Sonnet 5.5 (`sonnet`) · max | agy · Gemini 4 Neon · xhigh → opencode · Kimi K3.1 Pro · max |
| DATA | 6 data · 7 database | opencode · Kimi K3.1 Pro · max | agy · Gemini 4 Neon · xhigh → opencode · Muse Wonder · max |
| QA | 11 evals · 12 SQA · 14 deploy prep · 16 demo & docs | opencode · Kimi K3.1 Pro · max | agy · Gemini 4 Neon · xhigh → agy · Gemini 4 Hydrogen · xhigh |
| REVIEWER-CODE | code review of all code | claude · `opus` · max | agy · Gemini 4 Neon · max |
| REVIEWER-SEC | 13 red team · security review | opencode · Muse Wonder · max | agy · Gemini 4 Neon · max |
| OUTSIDER | hallway test (UX) · scored dry run (docs) | opencode · Muse Wonder · max | agy · Gemini 4 Hydrogen · xhigh (only if the author isn't Gemini) |

## Rules
1. **Out of quota → Gemini 4 Neon** (xhigh for building, max for design and review). If Neon is out too,
   take the next model in the row — it is in a different quota pool.
2. **Checker ≠ author family.** Families: Anthropic (Opus, Sonnet) · Google (Neon, Hydrogen) · Meta (Muse
   Wonder) · Moonshot (Kimi). When a fallback puts a checker in the author's family (e.g. Neon reviewing
   Neon-built UI), LEAD adds a second checker from another family and logs it in STATUS.md.
3. **Never use Kimi K3.1 Pro for security review or red teaming** — Moonshot removed cyber-related data from
   its training. Security work stays on Muse Wonder or Neon.
4. **Claude Pro budget:** at most LEAD + one more Claude seat at a time. Run REVIEWER-CODE when CORE is idle,
   or let it fall back to Neon max.
5. **OpenCode has two models here** (Kimi for DATA/QA, Muse for REVIEWER-SEC/OUTSIDER), so OpenCode workers
   get `--model`. If Orca rejects it, start without `--model` and the human sets the default in `/models`
   before that dispatch.

## Exact names for `worker-start`
```
--agent claude       --model opus    --effort max      # Claude Opus 5.5
--agent claude       --model sonnet  --effort max      # Claude Sonnet 5.5
--agent antigravity  --model "Gemini 4 Neon"      --effort max | xhigh
--agent antigravity  --model "Gemini 4 Hydrogen"  --effort xhigh
--agent opencode     --model opencode-go/kimi-k3.1-pro
--agent opencode     --model <provider>/<muse-wonder id>   # copy the exact id from `opencode models`
```
Names must match what each tool shows (`/model` in agy and Claude, `opencode models` in OpenCode). If a name
or effort level is rejected: start without it, note it in STATUS.md "Model switches", and fix this file.

## Quota pools
Claude Code (Opus, Sonnet) · Antigravity Gemini (Neon, Hydrogen — may share one quota) · OpenCode (Kimi,
Muse — check which plan or provider each comes from). A fallback inside an exhausted pool doesn't help.
