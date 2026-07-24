# Detection coverage — taxonomy, gaps, and the honesty rule

The evidence layer is the product: whatever the detectors miss, every downstream stage (workflows → journeys → sections → tutorials) is confidently wrong about. This file is the standing checklist of what a repo can contain vs what we detect, audited 2026-07-24 (current lists from `entrypointDetector.ts`, `sideEffectDetector.ts`, `001_initial_schema.sql`).

> **Implementation status (2026-07-24, step 0 of the redesign plan):** the P0 set + the DevOps layer shipped — consumer handler-reference seeding, auth/identity + external-service + process-exec sinks, enqueue queue-hints, the unknown_external fallback, trace-dead-end recording, config-as-flow (`configFlowExtractor.ts`), journey composition (`journeyComposer.ts`), and the golden-journey gate (`journeyGate.ts`), all wired in `worker/index.ts` and unit-tested (fixtures extended). Table cells below marked ✅(new) landed in that pass. `unknown_external` persists as `external_integration` + `metadata.detectorKind` — no schema change needed. Framing cross-checked against security-tooling taxonomies (taint **sources** ≈ our entrypoints, **sinks** ≈ our side effects — [CodeQL](https://codeql.github.com/docs/codeql-language-guides/customizing-library-models-for-javascript/), [Semgrep taint mode](https://semgrep.dev/docs/writing-rules/data-flow/taint-mode/overview)) and IaC-diagramming practice ([iac-diagram-generator](https://github.com/johnpsasser/iac-diagram-generator), [InfraSketch](https://infrasketch.cloud/), [Architext](https://architext.ai/)).

## The honesty rule (user, 2026-07-24)

The AST gives us every symbol; *understanding what a symbol does* is pattern knowledge. Today an unrecognized pattern is silently ignored — which reads downstream as "this does nothing." That's the definitively-wrong failure mode. Rule going forward:

> **No silent drops.** A symbol that is graph-connected to entrypoints/effects but matches no pattern gets `side_effect: unknown_external` (low confidence) instead of nothing; a workflow trace that ends nowhere records `trace_dead_end` in metadata; the counts surface in snapshot `unknowns` and the trust panel. Unknowns are findable work, not invisible holes.

## 1. Entrypoints (taint sources) — where execution begins

Schema types: `http_route, ui_route, event_listener, worker_job, scheduled_job, serverless_handler, cli, package_export`.

| Pattern family | Examples | Status |
| --- | --- | --- |
| Express-style HTTP routes | `router.get/post/…`, app.use mounts | ✅ detected (route tables even reconstruct full paths) |
| UI routes/pages | React Router route table | ✅ detected |
| Queue consumers | BullMQ `new Worker(...)` | ✅(new) unified. Root cause was **handler references**: `new Worker(Q, processJob)` passes a bare identifier, the Worker const has no call edges, so the trace died at 1 step. The detector now resolves the referenced handler as the seed; inline closures unchanged. Both consumers get the "Queue consumer:" treatment. |
| Webhooks | HMAC-verified POST handlers | ✅ as http_route; ❌ not *flagged* as webhook (external-trigger semantics lost for journeys) |
| Scheduled jobs | `node-cron`, `setInterval` long-period, BullMQ repeatable | ⚠️ type exists; verify patterns actually match (we have none in-repo to prove it) |
| CLI commands | commander/yargs, `bin` in package.json, `process.argv` mains | ⚠️ type exists; scripts/*.cjs (our own benchmark/ops scripts!) not surfaced |
| Event listeners | `emitter.on`, `process.on`, socket handlers | ⚠️ type exists; coverage of socket.io/ws unproven |
| Other frameworks (for multi-framework repos, M4 line 66) | Fastify/Koa/Nest decorators, Next.js file-routes + API routes, tRPC procedures, GraphQL resolvers, WebSocket/SSE endpoints, Electron IPC, Lambda/Vercel/Cloudflare handlers, Kafka/SQS/RabbitMQ consumers, gRPC services | ❌ not detected — acceptable *only if* declared: language/framework inventory must state "framework X present, entrypoint extraction not supported" as an unknown instead of silently emitting nothing |
| **Config-defined entrypoints** | compose `command:`/`entrypoint:`, Dockerfile `CMD/ENTRYPOINT`, package.json `scripts`, CI workflow triggers (`on: push/schedule/workflow_dispatch`), Procfile | ✅(new) compose/CI/scripts/env via `configFlowExtractor.ts` (§3): topology + dev journeys as workflow rows (`dev_command`, `ci_pipeline`). Dockerfile CMD/Procfile parsing still pending (P2) |

## 2. Side effects (taint sinks) — what execution does

Schema types: `database_read/write, http_request, queue_enqueue/consume, filesystem_read/write, auth_check, env_read, response_output, external_integration`. The schema is RICHER than the detector: `external_integration` and `auth_check` exist as types but almost nothing maps to them.

| Pattern family | Examples | Status |
| --- | --- | --- |
| SQL via client | `query(...)`, pool.query, template SQL | ✅ (incl. bare-query patterns, Phase A) |
| ORMs | Prisma/TypeORM/Drizzle/Knex/Sequelize/Mongoose | ❌ — required for other repos (M4 accuracy line 68) |
| HTTP out | `fetch(`, `axios.` | ✅ minimal; ❌ got/undici/superagent/graphql-request |
| Queue publish | BullMQ `queue.add` | ✅ |
| **Auth/identity SDKs** | `supabase.auth.*`, firebase auth, Auth0, Clerk, passport, jwt sign/verify | ✅(new) `auth_call` → `auth_check`, target names the provider; auth handlers keep their workflows and the seed's own auth call surfaces as an `auth_guard` step |
| Managed-service SDKs | Supabase client CRUD, S3/GCS, Stripe-alikes, SendGrid/Resend/nodemailer (partial: 'email_send' exists), Twilio, analytics | ✅(new) `external_service` → `external_integration` with `target` (octokit, storage, s3, stripe, email, twilio); breadth grows via the pattern table |
| LLM/API providers | OpenAI/OpenRouter/Anthropic calls | ✅(new) named as `external_service` targets (openai/openrouter/anthropic) |
| Cache | redis get/set (beyond BullMQ) | ⚠️ `cache_write` emitted by detector; breadth unproven |
| Filesystem | fs read/write, tmp dirs, zip extraction | ⚠️ types exist; verify coverage of fs/promises + streams |
| Process/exec | `child_process`, spawn/exec | ✅(new) `process_exec` → `external_integration` (`.exec(` deliberately excluded — regex.exec) |
| WebSocket/SSE emit | socket.emit, res.write(SSE) | ❌ (P2) |
| Env/config read | `process.env.X` | ⚠️ type exists — guardrails_ops env reference now comes from `.env.example` names via config-as-flow instead |
| Response output | res.json/send/render | ✅ (workflow step kind 'response'); bare `.send(` no longer misclassifies responses as queue publishes |
| **Fallback** | anything call-shaped crossing a module boundary into an unmatched import | ✅(new) `unknown_external` (low confidence, one per file×package, pure-package blocklist); packages roll up into snapshot `unknowns` |

## 3. Config-as-flow — the DevOps layer (currently inert)

Today: compose services drive scope proposals, config files become inert graph nodes, `.github/` is bucketed into a "Configuration & Deployment" cluster. **No flows are extracted.** But these files ARE the DevOps journeys — deterministic to parse (standard practice per the IaC-diagram tools above), no LLM needed:

| Source | Extract | Feeds |
| --- | --- | --- |
| `docker-compose*.yml` | services, images/build contexts, `depends_on`, ports, env files, volumes, `command` | **Runtime topology diagram** (big_picture anchor!), "Local dev up" journey, setup_run truth, guardrails_ops env story. Test-compose (`docker-compose.test.yml`) → "Run the tests" journey |
| `Dockerfile*` | base image, build steps, CMD/ENTRYPOINT, exposed ports | per-service build/run facts; entrypoint nodes for the runtime processes |
| `package.json` scripts (per workspace) | script name → command → what it invokes (tsc/vitest/mocha/node dist/…) | **Dev-workflow journeys**: build, test, start, lint — the commands a new dev actually types; first_change verification steps |
| `.github/workflows/*.yml` | triggers (`on:`), jobs, steps, needs-graph, deploy targets | **"What happens on push" journey** (CI/CD); doc_health cross-check (badges/claims vs real pipelines). Absent CI = an explicit honest statement, not silence |
| `supabase/migrations/*.sql` | tables, constraints, functions (we already read 001 for data facts) | data_model reference backbone; "how schema changes ship" how-to |
| Terraform/K8s/Procfile/serverless.yml | resources, services, manifests | Same treatment when present; inventory declares them when unsupported |
| `.env.example` | variable names + comments (never values) | guardrails_ops env reference; setup_run prerequisites |

Journey composition (ONBOARDING_UX_GOALS.md) then treats config-defined edges as first-class hops: compose `depends_on` links services; CI `needs:` links jobs; `scripts` link dev intent to code entrypoints.

## 4. Graph edges — connections we trace along

19 edge types exist (calls, imports, handles_route, writes_database, enqueues_job, tests, …). Gaps that block journeys: **frontend→API call edges** (page → `apiFetch('/projects/…')` → route — needed to stitch UI into journeys, J2), **enqueues_job → consumer** resolution as a traversable hop (exists as edge, unused by workflow tracing), **route → middleware chain** (auth_check visibility per route feeds routes_jobs' auth column).

## 5. Priorities

- **P0 (correctness of current repo's journeys)**: unify consumer detection; auth/identity SDK sinks; queue-boundary stitching; the honesty rule (unknown_external + trace_dead_end + unknowns surfacing).
- **P1 (DevOps + dev-workflow)**: compose/Dockerfile/package-scripts/CI extraction as flows + topology diagram; env reference from `.env.example`; frontend→API edges.
- **P2 (breadth for other repos)**: ORM sinks, more HTTP clients, process/exec, websocket, framework inventory declarations (Next/Nest/Fastify/GraphQL/tRPC…), Terraform/K8s.
- Every P2 non-support must still satisfy the honesty rule: detected-but-unsupported ⇒ declared unknown, never silence.

Sources: [CodeQL JS library models](https://codeql.github.com/docs/codeql-language-guides/customizing-library-models-for-javascript/) · [Semgrep taint overview](https://semgrep.dev/docs/writing-rules/data-flow/taint-mode/overview) · [iac-diagram-generator](https://github.com/johnpsasser/iac-diagram-generator) · [InfraSketch](https://infrasketch.cloud/) · [Architext](https://architext.ai/)
