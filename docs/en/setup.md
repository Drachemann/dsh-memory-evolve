# Setup

dsh-memory-evolve has two paths: files only, which works immediately, and hybrid, which adds pgvector plus local embedding and rerank models.

## Prerequisites

- DSH 0.2.1-rc.2 with a web profile.
- Node 22 or newer.
- Optional: a pgvector container, a local embedding endpoint, a local rerank endpoint.

## Tier 0: under five minutes, no database

1. Install into the profile: `dsh plugin --profile web add /path/to/dsh-memory-evolve`
2. Restart `dsh web`.
3. Open a session, then Memory, then Flows. The tour shows one sample flow; click Try recall.
4. Approve a proposal when it appears, or click "That's not how I'd do it" on any assistant reply to create one.
5. The next session recalls the flow at tier 0. The header badge shows `file`.

## Hybrid: under fifteen minutes

1. Start the database: `podman run -d --name memory-evolve-postgres -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=memory_evolve -p 127.0.0.1:5432:5432 pgvector/pgvector:0.8.7-pg18-trixie`
2. Reuse the gbrain embedder: `gbrain-embed.service` serves `bge-m3` at `http://127.0.0.1:8080/v1` (1024 dimensions, ONNX int8). If it is not running, start it from the gbrain deploy tree. Export `MEMORY_EVOLVE_DB_PASSWORD`; the default `embedding.baseUrl` and `embedding.model` already point at it.
3. Rerank: set `rerank.baseUrl` to `https://openrouter.ai/api/v1`, `rerank.model` to `cohere/rerank-v3.5`, and `rerank.dailySearchCap` to `1000`; export `OPENROUTER_API_KEY`. At the cap, recall returns the fused order with `rerank_daily_cap`.
4. Settings, then Memory Index: set the same values and the embedding dimensions.
5. Run `memory index doctor`. Expect `db: ok`, `pgvector: 0.8.7`, and `tier: hybrid` (or `lexical` without an embedding key).
6. Enable the index and click Rebuild.
7. The next recall uses the hybrid tier. The badge shows `hybrid`.

## Expected doctor output

```
db: ok (memory_evolve)
pgvector: 0.8.7 (HNSW, iterative scan)
embedding: bge-m3 (1024d, ready 128/128)
rerank: cohere/rerank-v3.5 (ready)
tier: rerank
```

The values are illustrative. The shape is the contract.

## Troubleshooting

- `db_unavailable`: the container is down, or the password environment variable is missing.
- `pgvector_missing`: create the extension in the database.
- `embeddings_disabled`: set the endpoint and the model, then run `memory index backfill`.
- `rerank_failed`: the rerank server is down; recall returns the fused order.
- `embedding_model_mismatch`: run `memory index rebuild --reembed`.

## First useful recall

Run a task you have done before. The snapshot offers the flow, and `memory` with `action: "recall"` returns the detail. The first "I have done this before" is the moment.
