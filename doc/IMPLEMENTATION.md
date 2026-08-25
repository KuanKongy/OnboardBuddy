# Implementation Decisions

This document records the key decisions made during the pipeline implementation,
deviations from the original Design.md/Pipeline.md, and architectural choices.

## Token Model: GitHub App Installation Tokens

**Decision:** The analysis worker uses GitHub App installation tokens (minted on
demand) instead of stored OAuth tokens.

**Rationale:** OAuth tokens are scoped to user consent, may be revoked
independently, and don't match the GitHub App security model. Installation tokens
are short-lived (~1 hour) and minted fresh via `getInstallationToken()` using an
app JWT. This means re-analysis at any point simply requests a new token — no
stored credential expiration to manage.

**Implementation:** `backend/src/worker/index.ts` calls
`getInstallationToken(installationId)` where `installationId` is stored in the
`projects.github_installation_id` column.

## BullMQ Cost Optimization

**Decision:** Set `drainDelay: 30000`, `stalledInterval: 120000`,
`lockDuration: 600000` on both workers.

**Rationale:** BullMQ v5 uses a marker-based system with ZSET signals. When a job
is enqueued, the worker wakes immediately via the signal. The `drainDelay` only
applies when no signal arrives (idle queue). Setting it to 30s reduces idle Redis
commands by ~6x vs the 5s default, saving cost on Upstash pay-as-you-go. Analysis
jobs are user-triggered and infrequent, so worst-case 30s extra latency is
acceptable.

## Database: PostgreSQL Only (No MongoDB)

**Decision:** All data stored in PostgreSQL via Supabase. MongoDB was dropped.

**Rationale:** Design.md mentioned MongoDB for "raw analysis snapshots" but
Pipeline.md stores everything relationally. The worker already writes all graph
data to PostgreSQL. Adding MongoDB would double operational complexity for no
benefit.

## Schema: Pipeline.md Wins

**Decision:** Where Design.md and Pipeline.md schemas conflict, Pipeline.md is
authoritative. All reconciled tables are in `001_initial_schema.sql`.

**Key differences resolved:**
- `graph_nodes.type`: Pipeline.md's expanded set (file, module, function, etc.)
- `graph_edges.type`: Pipeline.md's richer relationship types
- `workflow_steps.step_kind`: Pipeline.md's deterministic types vs Design.md's
  `explanation` column (both are now present)
- `graph_edges.confidence`: Added per Pipeline.md

## Pipeline Checkpointing

**Decision:** The `analysis_jobs` table has a `checkpoint` JSONB column that
tracks `lastCompletedStep`, `tmpDir`, `snapshotId`, and `commitHash`.

**Current state:** Checkpoint is saved after major steps. Full resume logic
(skipping already-completed steps on retry) is scaffolded but not fully exercised
yet — BullMQ's built-in retry with backoff handles most failure cases.

## Embedding Strategy

**Decision:** Use OpenAI `text-embedding-3-small` directly (not via OpenRouter)
for embeddings. Store in PostgreSQL with pgvector extension.

**Rationale:** OpenRouter doesn't reliably proxy embedding models. Direct OpenAI
is $0.02/1M tokens and provides consistent 1536-dimension embeddings. pgvector
allows hybrid retrieval combining vector similarity with deterministic graph
neighbors.

**Implementation:** `backend/src/worker/engine/embeddingService.ts` handles
embedding and storage. The summary worker embeds each section after generation
as a best-effort step (failure doesn't block the job).

## Symbol Extraction: Module-Level Only

**Decision:** `symbolExtractor.ts` only visits direct children of `SourceFile`
(top-level statements), not nested declarations inside functions/classes.

**Rationale:** The original code used `ts.forEachChild(node, visitNode)` which
recursed into all AST children, treating nested helper functions as module-level
symbols. This polluted the graph with implementation details. Class methods and
properties are still captured via the `extractClass` function's member iteration.

## Workflow Extraction: Deterministic First

**Decision:** Workflows are extracted deterministically from the graph structure
(entrypoints + dependency edges + side effects), not via LLM.

**Rationale:** LLM-based workflow extraction is expensive, non-deterministic, and
requires the full codebase as context. The deterministic approach traces from
detected entrypoints through the dependency graph to side effects, producing
workflow steps with `step_kind` and `deterministic_description`. LLM-generated
explanations are added in the summary phase.

## Frontend: Mock Data in Dev Only

**Decision:** `fetchOnboardingPackage` and `fetchDependencyGraph` only fall back
to mock data when `import.meta.env.DEV` is true. In production, real errors are
surfaced.

**Rationale:** Mock fallbacks in production mask real API failures and make
debugging difficult. The Error Boundary added to `App.tsx` provides a user-friendly
fallback for unhandled exceptions.

## Items deferred at the time, since shipped

Four items were deferred from the first pipeline build as non-blocking and have all since shipped:
the receipt viewer (click a citation to open file, lines and code; see [FRONTEND.md](./FRONTEND.md)),
the citation validator that checks generated sections against their own receipts, receipt staleness
tracking across snapshots, and confidence labels on receipts and sections (the last three are
described in [Pipeline.md](./Pipeline.md)).

---

## Worker Pipeline Flow (End-to-End)

```
User triggers POST /api/projects/:id/analyze
         │
         ▼
┌─────────────────────────────────┐
│  API: Atomic job creation       │
│  (SELECT FOR UPDATE + INSERT)   │
└──────────────┬──────────────────┘
               │ BullMQ enqueue
               ▼
┌─────────────────────────────────┐
│  Analysis Worker                │
│                                 │
│  1. Load project + settings     │
│  2. Mint installation token     │
│  3. Get commit SHA              │
│  4. Download zipball            │
│  5. Extract archive             │
│  6. Run AST analysis            │
│     ├─ buildRepoIndex           │
│     ├─ createProgram            │
│     ├─ extractFileAnalysis ×N   │
│     ├─ annotateResolvedImports  │
│     └─ buildDependencyGraph     │
│  7. Count workflow files        │
│  8. Persist graph to DB         │
│  9. Detect entrypoints          │
│ 10. Detect side effects         │
│ 11. Extract workflows           │
│ 12. Rank critical files         │
│ 13. Mark job complete           │
│ 14. Enqueue summary job (if AI) │
└──────────────┬──────────────────┘
               │ BullMQ enqueue
               ▼
┌─────────────────────────────────┐
│  Summary Worker                 │
│                                 │
│  1. Build evidence bundle       │
│  2. Create onboarding package   │
│  3. Generate 9 sections via LLM │
│  4. Persist sections + receipts │
│  5. Embed sections (pgvector)   │
│  6. Mark package as 'draft'     │
└─────────────────────────────────┘
```

Each step updates `analysis_jobs.current_step` and `progress_pct` for real-time
UI feedback. The checkpoint column tracks progress for potential resume.
