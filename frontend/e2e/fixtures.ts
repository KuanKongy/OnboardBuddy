import { expect, type Page } from "@playwright/test";

/**
 * Shared mocked-API fixtures for the UI regression specs (desktop and
 * mobile): realistic project data, route mocks, a fake Supabase session,
 * and the tab catalog with per-tab readiness assertions.
 */

export const P = "11111111-1111-1111-1111-111111111111";

// ── fixture data (mirrors the simple auth-demo fixture repo) ─────────────────

export const project = {
  id: P,
  repo_owner: "acme",
  repo_name: "auth-demo",
  branch: "main",
  default_branch: "main",
  github_installation_id: "123",
  status: "complete",
  developer_role: "backend",
  permission_tier: "owner",
  settings: {
    ignored_paths: ["node_modules/", "dist/"],
    default_developer_role: "backend",
    privacy_mode: "full_ai",
    analysis_depth: "standard",
    file_limit: 5000,
    loc_limit: 250000,
    budget_overrides: { max_llm_calls: 400 },
    budget_stop_behavior: "pause",
  },
};

const files = [
  "index.ts", "routes/authRoutes.ts", "services/authService.ts", "services/sessionStore.ts",
  "utils/jwtUtil.ts", "utils/textUtil.ts", "db/migrations.ts", "config/env.ts",
];
const depNodes = files.map((f, i) => ({
  id: f,
  label: f.split("/").pop()!.replace(".ts", ""),
  kind: "module",
  metadata: { exportedSymbols: [`sym${i}A`, `sym${i}B`], importCount: (i % 4) + 1, dependentCount: (7 - i) % 5 },
}));
const depEdges = [
  ["index.ts", "routes/authRoutes.ts"], ["routes/authRoutes.ts", "services/authService.ts"],
  ["routes/authRoutes.ts", "utils/textUtil.ts"], ["services/authService.ts", "utils/jwtUtil.ts"],
  ["services/authService.ts", "services/sessionStore.ts"], ["services/sessionStore.ts", "db/migrations.ts"],
  ["index.ts", "config/env.ts"], ["services/sessionStore.ts", "config/env.ts"],
].map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, kind: "imports" }));

const architecture = {
  projectId: P,
  snapshotId: "snap-1",
  clusters: [
    { id: "cluster:api", label: "API routes", kind: "api_layer", criticalScore: 0.92, summarySource: "semantic", confidence: "high", summary: "Express routes that receive login and session requests, validate input, and delegate to the auth service.", members: files.slice(0, 2).map((f) => ({ key: f, name: f, filePath: f })), metadata: {}, provenance: {"available":true,"method":"member_mean","label":"Criticality","score":0.92,"formula":"component score = mean of its 2 scored files","inputs":[{"key":"routes/authRoutes.ts","label":"routes/authRoutes.ts","weight":null,"value":0.98,"contribution":0.49,"measured":"routes/authRoutes.ts"},{"key":"routes/userRoutes.ts","label":"routes/userRoutes.ts","weight":null,"value":0.86,"contribution":0.43,"measured":"routes/userRoutes.ts"}],"reasons":["Averages 2 member files","Top member routes/authRoutes.ts scores 98","Lowest scored member routes/userRoutes.ts scores 86"],"lever":"It is a mean, not a maximum: one critical file cannot lift a large component, and splitting or merging components moves the number without any code changing. Judge a component by its top members, listed above.","scaleNote":"Each member's own score comes from the 9-signal candidate ranking. Every signal is divided by the highest value any file reaches in THIS snapshot, so 100 would mean leading every signal at once. The scale is relative to this repository. It is not comparable across projects.","caveat":null} },
    { id: "cluster:auth", label: "Auth services", kind: "auth_layer", criticalScore: 0.88, summarySource: "semantic", confidence: "high", summary: "Credential validation, JWT signing and verification, and session persistence.", members: files.slice(2, 5).map((f) => ({ key: f, name: f, filePath: f })), metadata: {}, provenance: {"available":true,"method":"member_mean","label":"Criticality","score":0.88,"formula":"component score = mean of its 3 scored files","inputs":[{"key":"services/authService.ts","label":"services/authService.ts","weight":null,"value":0.96,"contribution":0.32,"measured":"services/authService.ts"},{"key":"services/sessionStore.ts","label":"services/sessionStore.ts","weight":null,"value":0.88,"contribution":0.29333333333333333,"measured":"services/sessionStore.ts"},{"key":"utils/jwtUtil.ts","label":"utils/jwtUtil.ts","weight":null,"value":0.8,"contribution":0.26666666666666666,"measured":"utils/jwtUtil.ts"}],"reasons":["Averages 3 member files","Top member services/authService.ts scores 96","Lowest scored member utils/jwtUtil.ts scores 80"],"lever":"It is a mean, not a maximum: one critical file cannot lift a large component, and splitting or merging components moves the number without any code changing. Judge a component by its top members, listed above.","scaleNote":"Each member's own score comes from the 9-signal candidate ranking. Every signal is divided by the highest value any file reaches in THIS snapshot, so 100 would mean leading every signal at once. The scale is relative to this repository. It is not comparable across projects.","caveat":null} },
    { id: "cluster:data", label: "Database layer", kind: "database_layer", criticalScore: 0.61, summarySource: "deterministic", confidence: null, summary: "Session table migrations and data access.", members: [{ key: files[6]!, name: files[6]!, filePath: files[6]! }], metadata: {}, provenance: {"available":true,"method":"member_mean","label":"Criticality","score":0.61,"formula":"component score = mean of its 1 scored file","inputs":[{"key":"db/sessionTable.ts","label":"db/sessionTable.ts","weight":null,"value":0.61,"contribution":0.61,"measured":"db/sessionTable.ts"}],"reasons":["Averages 1 member file","Top member db/sessionTable.ts scores 61"],"lever":"It is a mean, not a maximum: one critical file cannot lift a large component, and splitting or merging components moves the number without any code changing. Judge a component by its top members, listed above.","scaleNote":"Each member's own score comes from the 9-signal candidate ranking. Every signal is divided by the highest value any file reaches in THIS snapshot, so 100 would mean leading every signal at once. The scale is relative to this repository. It is not comparable across projects.","caveat":null} },
    { id: "cluster:config", label: "Configuration", kind: "devops_layer", criticalScore: 0.35, summarySource: "deterministic", confidence: null, summary: "Environment configuration read at boot.", members: [{ key: files[7]!, name: files[7]!, filePath: files[7]! }], metadata: {}, provenance: {"available":true,"method":"member_mean","label":"Criticality","score":0.35,"formula":"component score = mean of its 1 scored file","inputs":[{"key":"config/env.ts","label":"config/env.ts","weight":null,"value":0.35,"contribution":0.35,"measured":"config/env.ts"}],"reasons":["Averages 1 member file","Top member config/env.ts scores 35"],"lever":"It is a mean, not a maximum: one critical file cannot lift a large component, and splitting or merging components moves the number without any code changing. Judge a component by its top members, listed above.","scaleNote":"Each member's own score comes from the 9-signal candidate ranking. Every signal is divided by the highest value any file reaches in THIS snapshot, so 100 would mean leading every signal at once. The scale is relative to this repository. It is not comparable across projects.","caveat":null} },
    { id: "cluster:shared", label: "Shared utilities", kind: "shared_module", criticalScore: 0.22, summarySource: "deterministic", confidence: null, summary: "Pure text formatting helpers.", members: [{ key: files[5]!, name: files[5]!, filePath: files[5]! }], metadata: {}, provenance: {"available":true,"method":"member_mean","label":"Criticality","score":0.22,"formula":"component score = mean of its 1 scored file","inputs":[{"key":"utils/format.ts","label":"utils/format.ts","weight":null,"value":0.22,"contribution":0.22,"measured":"utils/format.ts"}],"reasons":["Averages 1 member file","Top member utils/format.ts scores 22"],"lever":"It is a mean, not a maximum: one critical file cannot lift a large component, and splitting or merging components moves the number without any code changing. Judge a component by its top members, listed above.","scaleNote":"Each member's own score comes from the 9-signal candidate ranking. Every signal is divided by the highest value any file reaches in THIS snapshot, so 100 would mean leading every signal at once. The scale is relative to this repository. It is not comparable across projects.","caveat":null} },
  ],
  edges: [
    { id: "ae1", source: "cluster:api", target: "cluster:auth", kind: "calls", weight: 9 },
    { id: "ae2", source: "cluster:auth", target: "cluster:data", kind: "reads_writes_data", weight: 4 },
    { id: "ae3", source: "cluster:api", target: "cluster:shared", kind: "imports", weight: 2 },
    { id: "ae4", source: "cluster:auth", target: "cluster:config", kind: "uses_config", weight: 1 },
  ],
};

const workflowSteps = [
  { stepOrder: 1, filePath: "routes/authRoutes.ts", symbolName: "loginHandler", lineStart: 10, lineEnd: 24, stepKind: "trigger", description: "HTTP POST /login received; body parsed.", nodeId: "routes/authRoutes.ts#loginHandler" },
  { stepOrder: 2, filePath: "routes/authRoutes.ts", symbolName: "validateBody", lineStart: 30, lineEnd: 41, stepKind: "validation", description: "Request body checked for email and password.", nodeId: "routes/authRoutes.ts#validateBody" },
  { stepOrder: 3, filePath: "services/authService.ts", symbolName: "AuthService.login", lineStart: 17, lineEnd: 27, stepKind: "auth_guard", description: "Credentials validated; short passwords rejected.", nodeId: "services/authService.ts#AuthService.login" },
  { stepOrder: 4, filePath: "utils/jwtUtil.ts", symbolName: "signToken", lineStart: 8, lineEnd: 15, stepKind: "transform", description: "JWT signed with the user payload.", nodeId: "utils/jwtUtil.ts#signToken" },
  { stepOrder: 5, filePath: "services/sessionStore.ts", symbolName: "saveSession", lineStart: 12, lineEnd: 20, stepKind: "data_write", description: "Session row written to the sessions table.", nodeId: "services/sessionStore.ts#saveSession" },
  { stepOrder: 6, filePath: "routes/authRoutes.ts", symbolName: "loginHandler", lineStart: 22, lineEnd: 24, stepKind: "response", description: "Session token returned as JSON.", nodeId: "routes/authRoutes.ts#loginHandler2" },
];
const workflowGraph = {
  projectId: P,
  workflow: { id: "wf-1", title: "User login", trigger_type: "http_route", purpose: "auth", confidence: "high" },
  steps: workflowSteps,
  graph: {
    nodes: [...new Map(workflowSteps.map((s) => [s.nodeId, { id: s.nodeId, label: s.symbolName ?? s.filePath, kind: s.stepKind, filePath: s.filePath, metadata: { exportedSymbols: [], importCount: 0, dependentCount: 0 } }])).values()],
    edges: workflowSteps.slice(1).map((s, i) => ({ id: `we${i}`, source: workflowSteps[i]!.nodeId, target: s.nodeId, kind: "step" })),
    entryPoints: [workflowSteps[0]!.nodeId],
  },
};

const capabilities = {
  capabilities: [
    {
      id: "cap-1", stableKey: "capability:session", name: "User authentication",
      description: "Users sign in with email and password and receive a session token.",
      confidence: "high", summary: "Login and session handling across routes, service, and store.",
      userValue: "Any bug or change around login, tokens, or session expiry lands here.",
      tier: "core", score: 0.82, realizesUserAction: true, namedBy: "model",
      derivation: [
        "Grouped on the `sessions` table these flows write.",
        "2 traced flows from 2 entry points.",
        "Touches 1 schema table: sessions.",
      ],
      binding: {
        key: "session", keySource: "schema",
        entrypoints: [{ kind: "http_route", route: "/api/auth/login", filePath: "routes/authRoutes.ts", symbol: "login" }],
        schemas: ["sessions"], services: ["bcrypt"],
      },
      whereToStart: [
        { stable_key: "routes/authRoutes.ts", reason: "Every auth request enters through this router. Read it first." },
      ],
      workflows: [{
        id: "wf-1", stableKey: "wf:login", title: "User login", triggerType: "http_route", purpose: "auth",
        tier: "core", stepCount: 4, score: 0.9, reason: "Core flow, 4 traced steps from /api/auth/login",
        tutorials: [{ id: "tut-1", title: "User login, end to end" }],
      }],
      nodes: [{ stableKey: "services/authService.ts#createSession", name: "createSession", filePath: "services/authService.ts", reason: "entry point or effect site this capability binds to" }],
      modules: [
        { id: "m1", label: "Auth services", stableKey: "cluster:auth", kind: "auth_layer", reason: "Credential checks and token signing." },
        { id: "m2", label: "API routes", stableKey: "cluster:api", kind: "api_layer", reason: "HTTP entry points." },
      ],
    },
    {
      id: "cap-2", stableKey: "capability:token", name: "Session verification",
      description: "Sessions are persisted and can be verified or revoked.",
      confidence: "medium", summary: null,
      userValue: "Touch this when sessions outlive logout or verification misbehaves.",
      tier: "supporting", score: 0.4, realizesUserAction: false, namedBy: "deterministic",
      derivation: ["Grouped on the `sessions` table this flow writes.", "1 traced flow from 1 entry point."],
      binding: {
        key: "token", keySource: "schema",
        entrypoints: [{ kind: "http_route", route: "/api/auth/verify", filePath: "routes/authRoutes.ts", symbol: "verify" }],
        schemas: ["sessions"], services: [],
      },
      whereToStart: [],
      workflows: [{
        id: "wf-2", stableKey: "wf:verify", title: "Verify session", triggerType: "http_route", purpose: "auth",
        tier: "supporting", stepCount: 2, score: 0.7, reason: "Supporting flow, 2 traced steps from /api/auth/verify",
        tutorials: [],
      }],
      nodes: [],
      modules: [{ id: "m3", label: "Database layer", stableKey: "cluster:data", kind: "database_layer", reason: "Session rows live here." }],
    },
  ],
  ordering: {
    summary: "Tier first, then whether a person triggers it, then the flow score behind it.",
    steps: ["Tier", "User-triggered first", "Flow importance score", "Ties break on flow count, then alphabetically"],
  },
  bindingRule: {
    summary: "A capability is derived from evidence and then named, never named and then justified.",
    legs: ["At least one entry point.", "At least one traced flow past its trigger.", "At least one schema table or named external service."],
  },
  derivation: {
    tracedFlows: 2, consideredFlows: 2, boundFlows: 2, entrypoints: 2, schemaTables: 1,
    unbound: [], reportStored: true,
  },
  snapshotId: "snap-1",
};

const mermaidArch = `flowchart TD\n  api["API routes"] --> auth["Auth services"]\n  auth --> data[("Database layer")]\n  api --> shared["Shared utilities"]`;

const sections = [
  {
    id: "start-here", sectionId: "sec-1", label: "Start here", type: "start_here", status: "complete",
    reviewStatus: "draft", confidence: "high", reviewedBy: null, reviewedAt: null,
    diagrams: [], unknowns: [], analyzedCommit: "abc1234",
    blocks: [{
      title: "What this service does",
      body: "This repository implements **email/password authentication** with JWT sessions.\n\n- `routes/authRoutes.ts` receives login requests\n- `services/authService.ts` validates credentials and signs tokens\n- `services/sessionStore.ts` persists sessions\n\nStart by reading the login flow end to end. It touches every layer.",
      receipts: [
        { filePath: "services/authService.ts", lineStart: 17, lineEnd: 27, snippet: "async login(credentials) { … }", staleness: "fresh", confidence: "high", ageLabel: "recent" },
        { filePath: "routes/authRoutes.ts", lineStart: 10, lineEnd: 24, snippet: "router.post('/login', …)", staleness: "fresh", confidence: "high", ageLabel: "recent" },
      ],
    }],
  },
  {
    id: "architecture", sectionId: "sec-2", label: "Architecture", type: "architecture", status: "complete",
    reviewStatus: "approved", confidence: "high", reviewedBy: "sam", reviewedAt: null,
    diagrams: [{ kind: "architecture", mermaid: mermaidArch }],
    unknowns: [], analyzedCommit: "abc1234",
    blocks: [{
      title: "Layered request path",
      body: "Requests flow from the **API routes** cluster through the **auth services** into the **database layer**. Configuration is read once at boot.",
      receipts: [{ filePath: "index.ts", lineStart: 1, lineEnd: 12, staleness: "fresh", confidence: "high", ageLabel: "recent" }],
    }],
  },
  {
    id: "critical-25", sectionId: "sec-3", label: "Critical 25%", type: "critical_25", status: "stale",
    reviewStatus: "stale", confidence: "medium", reviewedBy: null, reviewedAt: null,
    diagrams: [],
    unknowns: [{ kind: "uncited_claim", detail: "one claim about rate limiting could not be verified" }],
    analyzedCommit: "abc1234",
    blocks: [{
      title: "The files that matter most",
      body: "`services/authService.ts` sits on every authenticated request path. Change it carefully: 4 workflows depend on it.",
      receipts: [{ filePath: "services/authService.ts", lineStart: 1, lineEnd: 33, staleness: "stale", confidence: "medium", ageLabel: "3 commits ago" }],
    }],
  },
];

const packages = {
  packages: [
    { id: "pkg-1", role: "backend", status: "draft", analyzed_commit: "abc1234def", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-08T10:00:00Z", scope_name: "Whole repository", path_prefix: "", scope_kind: "whole_repo", semantic_depth: "standard", privacy_mode: "full_ai", section_count: 11, stale_sections: 1, approved_sections: 4, low_confidence_sections: 0, tutorial_count: 2, stale_tutorials: 0, is_latest_commit: true },
    { id: "pkg-2", role: "frontend", status: "approved", analyzed_commit: "abc1234def", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-06T10:00:00Z", scope_name: "Whole repository", path_prefix: "", scope_kind: "whole_repo", semantic_depth: "standard", privacy_mode: "full_ai", section_count: 11, stale_sections: 0, approved_sections: 11, low_confidence_sections: 0, tutorial_count: 2, stale_tutorials: 0, is_latest_commit: true },
    { id: "pkg-3", role: "qa", status: "stale", analyzed_commit: "9998887earlier", created_at: "2026-06-20T10:00:00Z", updated_at: "2026-06-22T10:00:00Z", scope_name: "Whole repository", path_prefix: "", scope_kind: "whole_repo", semantic_depth: "standard", privacy_mode: "full_ai", section_count: 11, stale_sections: 5, approved_sections: 2, low_confidence_sections: 1, tutorial_count: 1, stale_tutorials: 0, is_latest_commit: false },
  ],
};

const tutorials = {
  tutorials: [
    { id: "tut-1", title: "User login, end to end", summary: "Follows a POST /login request through validation, signing, and persistence.", status: "draft", confidence: "high", trigger_type: "http_route", package_role: "backend", step_count: 4 },
    { id: "tut-2", title: "Session verification", summary: "How an existing token is verified on each request.", status: "stale", confidence: "medium", trigger_type: "http_route", package_role: "backend", step_count: 3 },
  ],
};
const tutorialDetail = {
  tutorial: { id: "tut-1", title: "User login, end to end", summary: "Follows a POST /login request through validation, signing, and persistence.", status: "draft", confidence: "high", trigger_type: "http_route", package_role: "backend", step_count: 4, unknowns: [] },
  steps: workflowSteps.slice(0, 4).map((s, i) => ({
    id: `ts-${i}`, step_order: s.stepOrder, file_path: s.filePath, symbol_name: s.symbolName,
    line_start: s.lineStart, line_end: s.lineEnd,
    snippet: `export async function ${s.symbolName?.split(".").pop() ?? "step"}(input: Input) {\n  // …\n  return next(input);\n}`,
    explanation: `${s.description} This is where you'd put a breakpoint to inspect the ${s.stepKind.replace(/_/g, " ")} stage.`,
    receipts: [{ id: `r-${i}`, trust_level: "code", file_path: s.filePath, line_start: s.lineStart, line_end: s.lineEnd }],
  })),
};

const nodeDetail = {
  node: {
    id: "n-1", stable_key: "services/authService.ts", type: "module", name: "authService",
    file_path: "services/authService.ts", line_start: 1, line_end: 33,
    composite_score: 0.82,
    ranking_reasons: ["Called by 4 symbols", "On the login workflow path", "Writes sessions table"],
    connected_workflows: [{ id: "wf-1", title: "User login", trigger_type: "http_route" }],
    doc: {
      summary: "Handles user authentication and session management.",
      summaryConfidence: "high", factsOnly: false,
      signature: "class AuthService { login(credentials: ICredentials): Promise<ISession> }",
      params: [], returns: "Promise<ISession>",
      exampleUsage: { caller: "loginHandler", filePath: "routes/authRoutes.ts", lineStart: 14, snippet: "const session = await authService.login({ email, password });\nres.json({ session });" },
      receipts: [
        { id: "r1", receipt_kind: "code_snippet", trust_level: "code", file_path: "services/authService.ts", symbol_name: "AuthService.login", line_start: 17, line_end: 27, snippet: null },
        { id: "r2", receipt_kind: "graph_edge", trust_level: "code", file_path: "routes/authRoutes.ts", symbol_name: null, line_start: 14, line_end: 14, snippet: null },
      ],
    },
  },
};

// ── route mocking ─────────────────────────────────────────────────────────────

/**
 * `tier` rewrites `permission_tier` on the project payload. The live DB has no
 * admin rows at all, so this is the only way to audit the admin view — the five
 * files that branch on tier (ProjectCard, ProjectOverviewPage, OnboardingPage,
 * TeamPage, ProjectSettingsPage) all read it from here.
 */
export async function mockApi(page: Page, opts: { tier?: "owner" | "admin" | "developer" } = {}) {
  const proj = opts.tier ? { ...project, permission_tier: opts.tier } : project;
  const routes: Array<[RegExp, unknown]> = [
    [/\/api\/projects\/[^/]+\/analysis-status/, { jobs: [{ id: "job-1", job_type: "analyze_scope", status: "complete", progress_pct: 100, current_step: "Complete", checkpoint: {}, step_log: [], error_message: null, created_at: "2026-07-08T10:00:00Z", started_at: null, finished_at: "2026-07-08T10:20:00Z", file_count: 8, symbol_count: 42, workflow_count: 2, commit_hash: "abc1234def" }], latestSnapshot: { id: "snap-1", file_count: 8, symbol_count: 42, workflow_count: 2, commit_hash: "abc1234def", created_at: "2026-07-08T10:20:00Z" } }],
    [/\/api\/projects\/[^/]+\/snapshots\/[^/]+\/metrics/, { snapshot: { id: "snap-1", status: "complete", budget_usage: { llm_calls: 63, input_tokens: 91240, estimated_cost_usd: 0.0214 } }, phases: [
      { phase: "ingest", status: "complete", started_at: null, finished_at: null, error_message: null, metrics: { files: 8 } },
      { phase: "parse", status: "complete", started_at: null, finished_at: null, error_message: null, metrics: { symbols: 42 } },
      { phase: "graph", status: "complete", started_at: null, finished_at: null, error_message: null, metrics: { nodes: 61, edges: 118 } },
      { phase: "workflows", status: "complete", started_at: null, finished_at: null, error_message: null, metrics: { workflows: 2 } },
      { phase: "semantic_symbols", status: "complete", started_at: null, finished_at: null, error_message: null, metrics: { llmCalls: 4, cacheHits: 18 } },
      { phase: "embeddings", status: "complete", started_at: null, finished_at: null, error_message: null, metrics: { embedded: 96 } },
      { phase: "generation", status: "complete", started_at: null, finished_at: null, error_message: null, metrics: { sections: 11, estimatedCostUsd: 0.014 } },
      { phase: "incremental_diff", status: "skipped", started_at: null, finished_at: null, error_message: null, metrics: { reason: "no_previous_snapshot" } },
    ], llm: [] }],
    [/\/api\/projects\/[^/]+\/graph\/dependencies/, { projectId: P, snapshotId: "snap-1", clustered: false, totalNodes: depNodes.length, totalEdges: depEdges.length, graph: { nodes: depNodes, edges: depEdges, entryPoints: ["index.ts"] }, fileAnalyses: [] }],
    [/\/api\/projects\/[^/]+\/graph\/architecture/, architecture],
    [/\/api\/projects\/[^/]+\/graph\/classes/, { projectId: P, snapshotId: "snap-1", clustered: false, totalNodes: 2, totalEdges: 1, graph: { nodes: [{ id: "services/authService.ts#AuthService", label: "AuthService", kind: "class", metadata: { exportedSymbols: [], importCount: 1, dependentCount: 2 } }, { id: "types.ts#IAuth", label: "IAuth", kind: "interface", metadata: { exportedSymbols: [], importCount: 0, dependentCount: 1 } }], edges: [{ id: "ce1", source: "services/authService.ts#AuthService", target: "types.ts#IAuth", kind: "implements" }], entryPoints: [] }, fileAnalyses: [] }],
    [/\/api\/projects\/[^/]+\/graph\/workflows\/[^/]+/, workflowGraph],
    [/\/api\/projects\/[^/]+\/graph\/nodes\/.+/, nodeDetail],
    [/\/api\/projects\/[^/]+\/workflows\/[^/]+\/walkthrough/, { workflow: workflowGraph.workflow, steps: workflowSteps.map((s, i) => ({ id: `ws-${i}`, step_order: s.stepOrder, file_path: s.filePath, symbol_name: s.symbolName, line_start: s.lineStart, line_end: s.lineEnd, explanation: null, step_kind: s.stepKind, deterministic_description: s.description, role_relevance: {} })) }],
    [/\/api\/projects\/[^/]+\/workflows/, { workflows: [{ id: "wf-1", title: "User login", trigger_type: "http_route", purpose: "auth", importance_score: 0.9, confidence: "high", composite_score: 0.45, step_count: 6, tier: "core", realizes_capability: true, reasons: ["Core user flow (http_route)", "Writes to the sessions table"], provenance: {"available":true,"method":"weighted_signals","label":"Criticality","score":0.45,"formula":"score = Σ (signal ÷ snapshot maximum) × weight, over 9 signals","inputs":[{"key":"workflowParticipation","label":"Flow importance (tier + trigger)","weight":0.2,"value":1,"contribution":0.2,"measured":"importance 0.9"},{"key":"sideEffects","label":"Side-effect breadth","weight":0.15,"value":1,"contribution":0.15,"measured":"2 kinds of side effect"},{"key":"entrypointParticipation","label":"Starts at an entry point","weight":0.1,"value":1,"contribution":0.1,"measured":"entry point"},{"key":"routeSchemaOwnership","label":"Reads or writes data","weight":0.1,"value":1,"contribution":0.1,"measured":"reads or writes data"},{"key":"fanCentrality","label":"Fan-in / fan-out centrality","weight":0.15,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"exportedSurface","label":"Exported surface","weight":0.15,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"testProximity","label":"Test coverage","weight":0.05,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"configRelevance","label":"Config & environment","weight":0.05,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"churn","label":"Churn (last 90 days)","weight":0.05,"value":0,"contribution":0,"measured":"not measured for flows"}],"reasons":["Core user flow (http_route)","Writes to the sessions table","Signs a session token"],"lever":"Every signal a flow can earn is already at this snapshot's maximum. 55 points is as high as a flow goes.","scaleNote":"Every signal is divided by the highest value any flow reaches in THIS snapshot, so 55 points would mean leading every signal a flow can earn. The scale is relative to this repository. It is not comparable across projects.","caveat":"5 of the 9 signals only apply to files and symbols, so a flow tops out at 55 points. Compare flows with other flows: a flow's 45 and a file's 45 are not the same claim."} }, { id: "wf-2", title: "Verify session", trigger_type: "http_route", purpose: "auth", importance_score: 0.7, confidence: "medium", composite_score: 0.3306, step_count: 3, tier: "core", reasons: ["Core user flow (http_route)", "Reads the sessions table"], provenance: {"available":true,"method":"weighted_signals","label":"Criticality","score":0.3306,"formula":"score = Σ (signal ÷ snapshot maximum) × weight, over 9 signals","inputs":[{"key":"workflowParticipation","label":"Flow importance (tier + trigger)","weight":0.2,"value":0.778,"contribution":0.15560000000000002,"measured":"importance 0.7"},{"key":"entrypointParticipation","label":"Starts at an entry point","weight":0.1,"value":1,"contribution":0.1,"measured":"entry point"},{"key":"routeSchemaOwnership","label":"Reads or writes data","weight":0.1,"value":1,"contribution":0.1,"measured":"reads or writes data"},{"key":"sideEffects","label":"Side-effect breadth","weight":0.15,"value":0.5,"contribution":0.075,"measured":"1 kind of side effect"},{"key":"fanCentrality","label":"Fan-in / fan-out centrality","weight":0.15,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"exportedSurface","label":"Exported surface","weight":0.15,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"testProximity","label":"Test coverage","weight":0.05,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"configRelevance","label":"Config & environment","weight":0.05,"value":0,"contribution":0,"measured":"not measured for flows"},{"key":"churn","label":"Churn (last 90 days)","weight":0.05,"value":0,"contribution":0,"measured":"not measured for flows"}],"reasons":["Core user flow (http_route)","Reads the sessions table"],"lever":"Biggest lever: side-effect breadth is at 50% of the snapshot's highest flow; closing that gap is worth up to 7.5 points.","scaleNote":"Every signal is divided by the highest value any flow reaches in THIS snapshot, so 55 points would mean leading every signal a flow can earn. The scale is relative to this repository. It is not comparable across projects.","caveat":"5 of the 9 signals only apply to files and symbols, so a flow tops out at 55 points. Compare flows with other flows: a flow's 45 and a file's 45 are not the same claim."} }], ordering: { summary: "Tier first, then business capability, then the flow's own importance score.", steps: ["Tier: core user flows, then supporting (jobs, admin, dev), then untraced endpoints & pages", "Within a tier: flows that realize a named business capability come first", "Then the flow's importance score (trigger type and traced effects, not step count)", "Ties break alphabetically by title"] }, snapshotId: "snap-1" }],
    [/\/api\/projects\/[^/]+\/capabilities/, capabilities],
    [/\/api\/projects\/[^/]+\/tutorials\/[^/]+/, tutorialDetail],
    [/\/api\/projects\/[^/]+\/tutorials/, tutorials],
    [/\/api\/projects\/[^/]+\/onboarding\/packages/, packages],
    [/\/api\/projects\/[^/]+\/onboarding\/staleness/, { staleFlags: [] }],
    [/\/api\/projects\/[^/]+\/onboarding\/export/, {}],
    [/\/api\/projects\/[^/]+\/onboarding/, { package: { projectId: P, role: "backend", status: "draft", analyzedCommit: "abc1234def", generatedAt: "2026-07-08T10:00:00Z", updatedAt: "2026-07-08T10:00:00Z", sections } }],
    [/\/api\/projects\/[^/]+\/llm-key/, { key: { exists: true, provider: "openrouter", created_by: "sam@acme.dev", created_at: "2026-07-01", updated_at: "2026-07-01" }, models: {}, usage_by_key_source: [] }],
    [/\/api\/projects\/[^/]+\/ranking-weights/, { views: ["critical_for_runtime", "critical_for_business", "critical_for_onboarding", "critical_for_role", "critical_for_change_risk", "critical_for_architecture", "critical_for_workflow"], roles: ["backend", "frontend", "devops", "qa", "general"].map((role) => ({ role, defaults: { critical_for_runtime: 0.2, critical_for_business: 0.1, critical_for_onboarding: 0.15, critical_for_role: 0.25, critical_for_change_risk: 0.1, critical_for_architecture: 0.1, critical_for_workflow: 0.1 }, weights: { critical_for_runtime: 0.2, critical_for_business: 0.1, critical_for_onboarding: 0.15, critical_for_role: 0.25, critical_for_change_risk: 0.1, critical_for_architecture: 0.1, critical_for_workflow: 0.1 }, customized: false })) }],
    [/\/api\/projects\/[^/]+\/scopes/, { scopes: [{ id: "scope-1", path_prefix: "", display_name: "Whole repository", kind: "whole_repo", detected_from: "default", created_at: "2026-07-01" }] }],
    // Before the broader /members pattern, which would otherwise swallow it.
    [/\/api\/projects\/[^/]+\/members\/invitations/, { invitations: [] }],
    [/\/api\/projects\/[^/]+\/members/, { members: [] }],
    // Before the /:id pattern, which would otherwise treat "activity" as an id
    // and serve { project } — DashboardPage then crashes on data.activity.
    [/\/api\/projects\/activity$/, { activity: [] }],
    [/\/api\/projects\/[^/]+$/, { project: proj }],
    [/\/api\/invitations/, { invitations: [] }],
    [/\/api\/projects$/, { projects: [proj] }],
  ];

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    for (const [re, body] of routes) {
      if (re.test(url)) {
        await route.fulfill({ json: body as object });
        return;
      }
    }
    await route.fulfill({ json: {} });
  });

  // Supabase session stub: ProtectedRoute only needs a stored, unexpired
  // session; no network auth happens in this spec.
  const fakeJwtBody = Buffer.from(JSON.stringify({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const fakeToken = `header.${fakeJwtBody}.sig`;
  await page.addInitScript(
    ([token]) => {
      const session = {
        access_token: token,
        refresh_token: "fake-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "user-1", email: "dev@acme.dev", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
      };
      window.localStorage.setItem("sb-mdexrahwgznmhdicgtql-auth-token", JSON.stringify(session));
      // The project tour is verified by its own test; keep it out of tab shots.
      // Keys are USER-SUFFIXED (`lib/tourState.ts` -> `${prefix}:${userId}`);
      // the bare prefixes never match, so tours used to run in every spec and
      // their `fixed inset-0 z-[60]` overlay silently swallowed clicks.
      for (const prefix of [
        "onboardbuddy:tour-dismissed",
        "onboardbuddy:project-tour-dismissed",
        "onboardbuddy:onboarding-tour-dismissed",
        "onboardbuddy:reader-tour-dismissed",
        "onboardbuddy:import-tour-dismissed",
      ]) {
        window.localStorage.setItem(prefix, "1");
        window.localStorage.setItem(`${prefix}:user-1`, "1");
      }
    },
    [fakeToken],
  );
}

export async function setTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript((t) => {
    window.localStorage.setItem("onboardbuddy:theme", t as string);
  }, theme);
}

export const TABS: Array<{ name: string; path: string; ready: (page: Page) => Promise<void> }> = [
  { name: "overview", path: `/projects/${P}`, ready: async (p) => { await expect(p.getByRole("heading", { name: "Overview" })).toBeVisible(); } },
  { name: "onboarding-cards", path: `/projects/${P}/onboarding`, ready: async (p) => { await expect(p.getByText("Whole repository").first()).toBeVisible(); } },
  { name: "onboarding-reader", path: `/projects/${P}/onboarding?view=reader&role=backend`, ready: async (p) => { await expect(p.getByText("What this service does")).toBeVisible(); } },
  { name: "architecture", path: `/projects/${P}/architecture`, ready: async (p) => { await expect(p.getByText("Auth services").first()).toBeVisible(); } },
  { name: "dependencies", path: `/projects/${P}/dependencies`, ready: async (p) => { await expect(p.getByText("authService").first()).toBeVisible(); } },
  { name: "workflows", path: `/projects/${P}/workflows`, ready: async (p) => { await expect(p.getByText("User login").first()).toBeVisible(); } },
  { name: "capabilities", path: `/projects/${P}/capabilities`, ready: async (p) => { await expect(p.getByText("User authentication").first()).toBeVisible(); } },
  { name: "tutorials", path: `/projects/${P}/walkthrough`, ready: async (p) => { await expect(p.getByText("Step 1 of 4")).toBeVisible(); } },
  { name: "settings", path: `/projects/${P}/settings`, ready: async (p) => { await expect(p.getByText("AI & privacy")).toBeVisible(); } },
];
