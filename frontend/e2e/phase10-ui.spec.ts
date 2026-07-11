import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 10 UI verification: renders every project tab against realistic
 * mocked API data (no backend needed) in both themes, asserts the key
 * content is visible, and captures full-page screenshots for design review.
 *
 *   SCREENSHOT_DIR=/tmp/shots npx playwright test e2e/phase10-ui.spec.ts
 */

const OUT = process.env.SCREENSHOT_DIR ?? "e2e/screenshots";
const P = "11111111-1111-1111-1111-111111111111";

// ── fixture data (mirrors the simple auth-demo fixture repo) ─────────────────

const project = {
  id: P,
  repo_owner: "acme",
  repo_name: "auth-demo",
  branch: "main",
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
    { id: "cluster:api", label: "API routes", kind: "api_layer", criticalScore: 0.92, summarySource: "semantic", confidence: "high", summary: "Express routes that receive login and session requests, validate input, and delegate to the auth service.", members: files.slice(0, 2).map((f) => ({ key: f, name: f, filePath: f })), metadata: {} },
    { id: "cluster:auth", label: "Auth services", kind: "auth_layer", criticalScore: 0.88, summarySource: "semantic", confidence: "high", summary: "Credential validation, JWT signing and verification, and session persistence.", members: files.slice(2, 5).map((f) => ({ key: f, name: f, filePath: f })), metadata: {} },
    { id: "cluster:data", label: "Database layer", kind: "database_layer", criticalScore: 0.61, summarySource: "deterministic", confidence: null, summary: "Session table migrations and data access.", members: [{ key: files[6]!, name: files[6]!, filePath: files[6]! }], metadata: {} },
    { id: "cluster:config", label: "Configuration", kind: "devops_layer", criticalScore: 0.35, summarySource: "deterministic", confidence: null, summary: "Environment configuration read at boot.", members: [{ key: files[7]!, name: files[7]!, filePath: files[7]! }], metadata: {} },
    { id: "cluster:shared", label: "Shared utilities", kind: "shared_module", criticalScore: 0.22, summarySource: "deterministic", confidence: null, summary: "Pure text formatting helpers.", members: [{ key: files[5]!, name: files[5]!, filePath: files[5]! }], metadata: {} },
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
      id: "cap-1", stableKey: "capability:user-authentication", name: "User authentication",
      description: "Users sign in with email and password and receive a session token.",
      confidence: "high", summary: "Login and session handling across routes, service, and store.",
      workflows: [{ id: "wf-1", title: "User login", triggerType: "http_route" }],
      modules: [{ id: "m1", label: "Auth services", stableKey: "cluster:auth", kind: "auth_layer" }, { id: "m2", label: "API routes", stableKey: "cluster:api", kind: "api_layer" }],
    },
    {
      id: "cap-2", stableKey: "capability:session-management", name: "Session management",
      description: "Sessions are persisted and can be verified or revoked.",
      confidence: "medium", summary: null,
      workflows: [{ id: "wf-2", title: "Verify session", triggerType: "http_route" }],
      modules: [{ id: "m3", label: "Database layer", stableKey: "cluster:data", kind: "database_layer" }],
    },
  ],
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
      body: "This repository implements **email/password authentication** with JWT sessions.\n\n- `routes/authRoutes.ts` receives login requests\n- `services/authService.ts` validates credentials and signs tokens\n- `services/sessionStore.ts` persists sessions\n\nStart by reading the login flow end to end — it touches every layer.",
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
      body: "`services/authService.ts` sits on every authenticated request path. Change it carefully — 4 workflows depend on it.",
      receipts: [{ filePath: "services/authService.ts", lineStart: 1, lineEnd: 33, staleness: "stale", confidence: "medium", ageLabel: "3 commits ago" }],
    }],
  },
];

const packages = {
  packages: [
    { id: "pkg-1", role: "backend", status: "draft", analyzed_commit: "abc1234def", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-08T10:00:00Z", scope_name: "Whole repository", path_prefix: "", scope_kind: "whole_repo", semantic_depth: "standard", privacy_mode: "full_ai", section_count: 11, stale_sections: 1, approved_sections: 4, low_confidence_sections: 0, tutorial_count: 2, is_latest_commit: true },
    { id: "pkg-2", role: "frontend", status: "approved", analyzed_commit: "abc1234def", created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-06T10:00:00Z", scope_name: "Whole repository", path_prefix: "", scope_kind: "whole_repo", semantic_depth: "standard", privacy_mode: "full_ai", section_count: 11, stale_sections: 0, approved_sections: 11, low_confidence_sections: 0, tutorial_count: 2, is_latest_commit: true },
    { id: "pkg-3", role: "qa", status: "stale", analyzed_commit: "9998887earlier", created_at: "2026-06-20T10:00:00Z", updated_at: "2026-06-22T10:00:00Z", scope_name: "Whole repository", path_prefix: "", scope_kind: "whole_repo", semantic_depth: "standard", privacy_mode: "full_ai", section_count: 11, stale_sections: 5, approved_sections: 2, low_confidence_sections: 1, tutorial_count: 1, is_latest_commit: false },
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

async function mockApi(page: Page) {
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
    [/\/api\/projects\/[^/]+\/workflows/, { workflows: [{ id: "wf-1", title: "User login", trigger_type: "http_route", purpose: "auth", importance_score: 0.9, confidence: "high", composite_score: 0.9, step_count: 6 }, { id: "wf-2", title: "Verify session", trigger_type: "http_route", purpose: "auth", importance_score: 0.7, confidence: "medium", composite_score: 0.7, step_count: 3 }], snapshotId: "snap-1" }],
    [/\/api\/projects\/[^/]+\/capabilities/, capabilities],
    [/\/api\/projects\/[^/]+\/tutorials\/[^/]+/, tutorialDetail],
    [/\/api\/projects\/[^/]+\/tutorials/, tutorials],
    [/\/api\/projects\/[^/]+\/onboarding\/packages/, packages],
    [/\/api\/projects\/[^/]+\/onboarding\/staleness/, { staleFlags: [] }],
    [/\/api\/projects\/[^/]+\/onboarding\/export/, {}],
    [/\/api\/projects\/[^/]+\/onboarding/, { package: { projectId: P, role: "backend", status: "draft", analyzedCommit: "abc1234def", generatedAt: "2026-07-08T10:00:00Z", updatedAt: "2026-07-08T10:00:00Z", sections } }],
    [/\/api\/projects\/[^/]+\/llm-key/, { key: { exists: true, provider: "openrouter", created_by: "sam@acme.dev", created_at: "2026-07-01", updated_at: "2026-07-01" }, models: {}, usage_by_key_source: [] }],
    [/\/api\/projects\/[^/]+\/ranking-weights/, { views: ["runtime", "business", "onboarding", "change_risk", "architecture", "workflow"], roles: ["backend", "frontend", "devops", "qa", "general"].map((role) => ({ role, defaults: { runtime: 0.25, business: 0.15, onboarding: 0.2, change_risk: 0.15, architecture: 0.15, workflow: 0.1 }, weights: { runtime: 0.25, business: 0.15, onboarding: 0.2, change_risk: 0.15, architecture: 0.15, workflow: 0.1 }, customized: false })) }],
    [/\/api\/projects\/[^/]+\/scopes/, { scopes: [{ id: "scope-1", path_prefix: "", display_name: "Whole repository", kind: "whole_repo", detected_from: "default", created_at: "2026-07-01" }] }],
    [/\/api\/projects\/[^/]+\/members/, { members: [] }],
    [/\/api\/projects\/[^/]+$/, { project }],
    [/\/api\/invitations/, { invitations: [] }],
    [/\/api\/projects$/, { projects: [project] }],
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
      window.localStorage.setItem("onboardbuddy:project-tour-dismissed", "1");
      window.localStorage.setItem("onboardbuddy:tour-dismissed", "1");
    },
    [fakeToken],
  );
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.addInitScript((t) => {
    window.localStorage.setItem("onboardbuddy:theme", t as string);
  }, theme);
}

const TABS: Array<{ name: string; path: string; ready: (page: Page) => Promise<void> }> = [
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

for (const theme of ["dark", "light"] as const) {
  test.describe(`phase 10 tabs (${theme})`, () => {
    for (const tab of TABS) {
      test(`${tab.name} renders`, async ({ page }) => {
        await mockApi(page);
        await setTheme(page, theme);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(tab.path);
        await tab.ready(page);
        // Let graphs fit-view and mermaid render before the shot.
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${OUT}/${tab.name}-${theme}.png`, fullPage: true });
      });
    }
  });
}

test("project tour spotlights the nav for first-timers", async ({ page }) => {
  await mockApi(page);
  await setTheme(page, "dark");
  await page.addInitScript(() => {
    window.localStorage.removeItem("onboardbuddy:project-tour-dismissed");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${P}`);
  await expect(page.getByText("Start at the overview")).toBeVisible();
  await page.screenshot({ path: `${OUT}/tour-dark.png` });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Every claim carries receipts")).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
});

test("interacting with a dependency node opens the symbol doc panel", async ({ page }) => {
  await mockApi(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${P}/dependencies`);
  await page.getByText("authService", { exact: true }).first().click();
  await expect(page.getByText("Handles user authentication and session management.")).toBeVisible();
  await expect(page.getByText("Example usage")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/dependencies-selected-dark.png`, fullPage: true });
});
