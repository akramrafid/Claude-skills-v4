---
name: data-engineering
description: Role 6 (Design hat) - data engineer for AI features. Builds the idempotent ingestion pipeline (load, parse, clean, chunk, embed, upsert) as an offline CLI, chooses chunking and embedding settings by measurement, configures the vector index (pgvector or Qdrant) with metadata for filtering and trust, labels a golden retrieval set and reports Recall@k and MRR per tag. Full patterns in references/rag-pipeline.md. Use for any ingestion, chunking, embedding, vector index or retrieval-quality work. Done check - node .orca-team/tools/gates.mjs retrieval (Recall@k at or above the threshold on the golden queries).
---

# Data Engineering — Role 6 · Design hat

**Seat:** DATA (models: `swarm-lead/references/model-routing.md`). **Independent check:** REVIEWER-CODE (Claude) reviews the pipeline; the metric
is computed by code, not by opinion. **Hand-off:** `apps/api/app/ingest/`, `docs/data-pipeline.md`,
`apps/api/evals/datasets/retrieval.jsonl`, `apps/api/evals/retrieval.py`, `evals/results/retrieval.json`.
**Done when:** `node .orca-team/tools/gates.mjs retrieval` passes (default Recall@5 ≥ 0.80 on ≥ 20 queries;
thresholds live in `.orca-team/gates.json`).

Read `references/rag-pipeline.md` for parsing, chunking, embeddings, Qdrant/pgvector code and hybrid search.

## Steps
1. **Profile sources** (`data/`): formats, sizes, languages, duplicates, PII, trust (official docs vs user or
   forum content). Record in `docs/data-pipeline.md`.
2. **Pipeline** `app/ingest/`: `load → parse → clean → chunk → embed → upsert`, each a pure function, plus
   `cli.py` (`npm run ingest -- --target dev|test|prod --source data/kb`). Production writes need the human's
   approval via LEAD.
3. **Idempotency:** chunk id = `uuid5(namespace, source_id + section + chunk_index + content_hash)`; re-runs
   upsert, never duplicate; deleted sources removed. Log counts (docs, chunks, skipped, failed) — never content.
4. **Metadata per chunk:** `source_id`, `title`, `section`/anchor, `language`, `trust` (`official|community`),
   `tenant_id` if multi-tenant, `ingested_at`, `content_hash`. Index the filter fields.
5. **Embeddings:** one model + dimension per collection (immutable; changing it = new collection), batch
   64–128, timeouts and retries via the shared client, API embeddings on Vercel (no local torch models).
6. **Golden retrieval set** `evals/datasets/retrieval.jsonl` (≥ 20 queries; include each language and the
   tricky ones): labels point at **source + section**, not chunk ids, so re-chunking doesn't break them.
   ```json
   {"id": "RQ-07", "query": "how much credit for a 30 hour outage?", "relevant": ["outage-and-sla#credits"], "tags": ["fact", "en"]}
   ```
7. **Measure** `npm run eval:retrieval` → `evals/results/retrieval.json`:
   `{"k": 5, "n_queries": 24, "recall_at_k": 0.88, "mrr": 0.71, "by_tag": {...}, "config": {...}, "commit": "..."}`.
8. **Tune by sweep** (chunk size/overlap, hybrid on/off, top_k, rerank) on the golden set; record the table
   in `docs/data-pipeline.md`; keep the best config in settings, not in code constants.

## Security (OWASP LLM 2026: LLM05 data poisoning, LLM09 vector and embedding weaknesses)
Only the CLI writes to the index (no public ingestion endpoint unless TASK.md demands it, then auth + size +
type checks) · low-trust content is tagged and the answer prompt treats it as data, never as instructions ·
tenant filter applied server-side on every query · strip secrets/PII found during profiling.

## The check
`gates.mjs retrieval` runs `npm run eval:retrieval`, then reads `evals/results/retrieval.json` and fails if
`recall_at_k` is below the threshold or fewer than 20 queries were evaluated.

## Pair with
`qdrant-clients-sdk` (when Qdrant) · `supabase-postgres-best-practices` (pgvector indexes) ·
`property-based-testing` (parsers, chunkers).

## Anti-patterns
Ingesting at request time on Vercel · chunk ids from random uuids (duplicates on re-run) · labels tied to
chunk ids · mixing embedding models in one collection · trusting forum content like official docs.
