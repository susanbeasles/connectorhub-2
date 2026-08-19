# Phase 8 — Telemetry plane: ingest everything, explain everything

Today the broker only sees what passes through its own proxy. The pivot: make Aegis a universal sink for agent telemetry — prompts, context windows, tool calls, skills, model spend, game/app state — then normalize it, price it, chain it into provenance, and let you interrogate it in plain language.

## 1. Ingest boundary (`src/lib/telemetry/`)

One entrypoint, many shapes. Callers never talk to the database.

```text
telemetry/
  ingest.server.ts    Telemetry.capture(batch) — validate, dedupe, persist raw
  schema.ts           Event/Span/Trace contracts (zod), version-tagged
  normalize.server.ts vendor payload -> canonical span
  price.server.ts     token counts -> cost, per model/provider
  enrich.server.ts    derived fields: intent, cache-hit, retries, parent linkage
  archive.server.ts   long-term object storage batching
  query.server.ts     rollup + provenance reads for the UI
```

- Public endpoint `POST /api/public/telemetry/v1/events` — accepts a single event or an NDJSON batch, up to a size cap, authenticated by a per-source ingest key (hashed at rest) and rate-limited through the existing rate boundary.
- Accepts partial/unknown fields: anything not in the canonical schema lands in a `raw` JSON column so nothing is ever dropped. Normalization is a later pass, not a gate on acceptance.
- Adapters shipped as thin docs + snippets: OpenAI/Anthropic-style chat completions, MCP tool calls, a local CLI/agent hook, and a generic "just POST me your JSON" shape.
- The existing MCP proxy emits the same events internally, so proxied traffic and external traffic land in one timeline.

## 2. Canonical model

- `traces` — one agent run/session: entrypoint, actor, client, start/end, totals.
- `spans` — one unit of work inside a trace: `llm_call`, `tool_call`, `skill`, `retrieval`, `human_approval`. Parent/child links give the provenance chain.
- `span_payloads` — prompt, context window, rendered system/skill text, args, output. Stored separately so payloads can age out to archive independently of metrics.
- `span_costs` — input/output/cached/reasoning tokens, unit price snapshot, computed cost. Prices live in a `model_prices` table so old rows keep the price they were billed at.
- `ingest_sources` — named source (tool, agent, plugin), key hash, last seen, event counts.

Grants + RLS on every table; operator-scoped reads, ingest writes only through the server key path.

## 3. Long-term storage

- Raw batches written to object storage (S3 via credentials stored encrypted in the existing vault) as newline-delimited JSON, keyed `source/date/trace`. Immutable, audit-grade.
- Hot database holds the recent window; the existing retention sweep rolls older payloads to archive and keeps costs/rollups forever.
- Every archived batch records a content hash so the provenance chain can prove nothing was edited.

## 4. Breakdown + insights UI

New top-level `/telemetry` section, plus a per-broker tab:

- **Spend** — cost split by model, by tool, by skill, by trace, by source, over a selectable window. Prompt vs completion vs cached tokens broken out, because "burning in prompting" is the question being asked.
- **Traces** — searchable list; open one to get the provenance chain as a tree: intent, each prompt, the context window at that moment, tool calls with args and results, retries, cost per hop.
- **Patterns** — repeated prompts, cache-miss hotspots, tools whose cost/latency dominates, skills that inflate context.
- **Ask** — a chat panel over your own telemetry. The question plus a compact, structured slice of the relevant rollups and trace summaries goes to an external model through the AI gateway; the answer cites the traces it used so nothing is unverifiable.

## 5. Order of work

1. Schema + ingest endpoint + ingest keys, with the raw catch-all column and archive writes.
2. Normalizer, pricing table, enrichment, and internal emission from the MCP proxy.
3. Spend + Traces UI with the provenance tree.
4. Patterns, S3 archival lifecycle, export.
5. Ask panel over the rollups.

Each step ships alone and leaves the app working.

## Technical notes

- Ingest must never block the caller: validate cheaply, persist raw, do normalization/pricing in the existing cron sweep and on read where needed.
- Payload columns hold prompt text — treat as sensitive: operator-only reads, redaction rules configurable per source, and never returned to the analysis model in full unless the operator opts in per query.
- The Ask panel sends aggregates and truncated excerpts, not whole payload dumps, to keep the external call bounded and the blast radius small.
