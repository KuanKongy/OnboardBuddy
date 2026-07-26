import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "@playwright/test";

// The XSS payloads set this global if they execute; declaring it here (not
// casting inline at each read site) keeps every `window.__xss` access
// genuinely typed instead of trusting an unchecked shape.
declare global {
  interface Window {
    __xss?: string;
  }
}

/**
 * Live form-post XSS test round (doc/plans/xss-injection-test-round-plan.md §4).
 *
 * Types every payload from backend/test/security/xssPayloads.json into a real
 * DOM form in a real browser, submits it, reloads where applicable, and
 * asserts the plan's three-property contract:
 *   1. window.__xss stays undefined (no execution)
 *   2. the payload/marker round-trips as inert text (proves it wasn't silently
 *      dropped — a field that strips input looks identical to one that
 *      escapes it unless we check this)
 *   3. zero live `script:has-text("__xss")`, `img[onerror]`, `svg[onload]`
 *      elements exist (proves it became text, not markup)
 * F6 (avatar URL) and F10 (`?next=`) swap #2 for "value rejected /
 * navigation blocked" per the plan's explicit override.
 *
 * Run: cd frontend && set USE_DOCKER_STACK=1 && npx playwright test
 * e2e/xss-forms.spec.ts --workers=1 --reporter=list
 * (playwright.config.ts skips its own webServer when USE_DOCKER_STACK=1 and
 * hits the already-running native dev servers instead; --workers=1 keeps
 * cases from racing on the one shared real account/project without using
 * describe.serial, which would skip-cascade every case after a failure.)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Payload catalogue (single source of truth, shared with the backend probe) ──
interface XssPayload {
  xid: string;
  label: string;
  payload: string;
}
const catalogue = JSON.parse(
  readFileSync(path.join(__dirname, "../../backend/test/security/xssPayloads.json"), "utf8"),
) as { xss: XssPayload[] };
const XSS: Record<string, string> = Object.fromEntries(catalogue.xss.map((p) => [p.xid, p.payload]));

// ── .env loading (same pattern as backend/_scratch_token.mjs) ──
function loadEnv(absPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(absPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — run \`npm run security:probe:seed -w backend\` and eval its export lines first.`);
  }
  return value;
}
const backendEnv = loadEnv(path.join(__dirname, "../../backend/.env"));
const frontendEnv = loadEnv(path.join(__dirname, "../.env"));

const SUPABASE_URL = backendEnv.SUPABASE_URL!;
const SERVICE_ROLE_KEY = backendEnv.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = frontendEnv.VITE_SUPABASE_ANON_KEY!;
const TEST_EMAIL = "ng.eugene2004@gmail.com";
const TEST_USER_ID = "0a7802aa-b006-4b42-ab04-a2f7cbb2f4a0";

// Matches supabase-js's own default: `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
// (node_modules/@supabase/supabase-js/dist/index.mjs — defaultStorageKey).
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

// Fixture project ids come from `backend/scripts/security-probe-seed.ts`
// (`npm run security:probe:seed -w backend`), which prints them as shell
// `export` lines — eval those before running this spec. The seed/teardown
// scripts are the single source of truth for these fixtures (see
// doc/SECURITY_XSS_TEST_REPORT.md "Reproducing this"); hardcoding ids here
// would silently break the moment `security:probe:teardown` runs.
//
// Owner-tier throwaway project — used for every field/probe test that needs
// an owned, writable project (settings, ignored_paths, avatar/profile,
// invite, custom scope path, project-search). Status "idle": never
// analyzed, no GitHub App installation, so anything requiring a completed
// analysis (the Ask box, F4) cannot be driven end-to-end on it — see F4.
const OWNER_PROJECT_ID = requireEnv("OB_PROJECT_ID");
// Developer-tier READ-ONLY grant on an already-analyzed "complete" project —
// used ONLY for F2/F3 graph/architecture search-box rendering. Never written
// to: POST /ask writes an ai_generation_runs audit row and burns AI budget,
// so it is deliberately not reused for F4 even though it is the only
// project this account can reach with a working Ask flow.
const READONLY_COMPLETE_PROJECT_ID = requireEnv("OB_ASK_PROJECT_ID");

const AVATAR_HELP_TEXT =
  "Avatar URL must be an https link on githubusercontent.com, gravatar.com, or supabase.co.";

let sessionJson: string;
let sessionAccessToken: string;
let originalFullName: string;
let originalAvatarUrl: string;
let createdInvitationId: string | null = null;

test.beforeAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Snapshot current profile so we can restore it after F5/F6 mutate it —
  // full_name/avatar_url are global account metadata, not project-scoped.
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(TEST_USER_ID);
  if (userErr) throw new Error(`getUserById failed: ${userErr.message}`);
  originalFullName = typeof userData.user.user_metadata?.full_name === "string" ? userData.user.user_metadata.full_name : "";
  originalAvatarUrl = typeof userData.user.user_metadata?.avatar_url === "string" ? userData.user.user_metadata.avatar_url : "";

  // Mint one real session (magic-link tokens are single-use; the resulting
  // access/refresh tokens are not, so one mint covers the whole run).
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);

  sessionJson = JSON.stringify(verifyData.session);
  sessionAccessToken = verifyData.session.access_token;
});

test.afterAll(async () => {
  // Test-artifact hygiene (plan "Assumptions & contingencies"): revert
  // anything written into the real test account/project during the round.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: restoreErr } = await admin.auth.admin.updateUserById(TEST_USER_ID, {
    user_metadata: { full_name: originalFullName, avatar_url: originalAvatarUrl },
  });
  if (restoreErr) console.error(`Profile restore failed: ${restoreErr.message}`);

  const apiUrl = frontendEnv.VITE_API_URL || "http://localhost:3000/api";
  const res = await fetch(`${apiUrl}/projects/${OWNER_PROJECT_ID}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionAccessToken}` },
    body: JSON.stringify({ ignored_paths: [] }),
  });
  if (!res.ok) console.error(`ignored_paths restore failed: ${res.status} ${await res.text()}`);

  if (createdInvitationId) {
    const revokeRes = await fetch(
      `${apiUrl}/projects/${OWNER_PROJECT_ID}/members/invitations/${createdInvitationId}`,
      { method: "PATCH", headers: { Authorization: `Bearer ${sessionAccessToken}` } },
    );
    if (!revokeRes.ok) console.error(`Invitation revoke failed: ${revokeRes.status}`);
  }
});

// AppTour auto-opens on first visit to several pages and its full-screen
// overlay intercepts pointer events until dismissed. Seeding these
// dismissal flags (frontend/src/lib/tourState.ts key format) alongside the
// session is deterministic — unlike pressing Escape per-navigation, it
// survives F7's mid-test reload and ProjectLayout re-mounting the tour.
const TOUR_DISMISSED_KEYS = [
  `onboardbuddy:tour-dismissed:${TEST_USER_ID}`,
  `onboardbuddy:project-tour-dismissed:${TEST_USER_ID}`,
  `onboardbuddy:onboarding-tour-dismissed:${TEST_USER_ID}`,
  `onboardbuddy:reader-tour-dismissed:${TEST_USER_ID}`,
];

async function loginAs(page: Page) {
  await page.addInitScript(
    ([storageKey, session, tourKeys]) => {
      window.localStorage.setItem(storageKey, session);
      for (const tourKey of tourKeys) window.localStorage.setItem(tourKey, "1");
    },
    [STORAGE_KEY, sessionJson, TOUR_DISMISSED_KEYS] as [string, string, string[]],
  );
}

function attachDiagnostics(page: Page, sink: string[]) {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") sink.push(`console.${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => sink.push(`pageerror: ${err.message}`));
}

function reportDiagnostics(label: string, sink: string[]) {
  console.log(`[${label}] console/pageerror events: ${sink.length === 0 ? "none" : JSON.stringify(sink)}`);
}

const INJECTED_ELEMENTS_SELECTOR = 'script:has-text("__xss"), img[onerror], svg[onload]';

async function assertNoExecution(page: Page, label: string) {
  // onerror/onload fire asynchronously after the browser attempts to load
  // the (bogus) image/svg resource — give that a moment to settle before
  // declaring window.__xss clean, or a live payload could false-PASS.
  await page.waitForTimeout(200);
  const xss = await page.evaluate(() => window.__xss);
  expect(xss, `${label}: window.__xss must stay undefined`).toBeUndefined();
}

async function assertNoInjectedElements(page: Page, label: string) {
  await expect(page.locator(INJECTED_ELEMENTS_SELECTOR), `${label}: no live injected element`).toHaveCount(0);
}

/** Narrows an unknown POST /members/invitations response body without an inline cast (F8 cleanup). */
function extractInvitationId(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("invitation" in body)) return null;
  const invitation = body.invitation;
  if (!invitation || typeof invitation !== "object" || !("id" in invitation)) return null;
  return typeof invitation.id === "string" ? invitation.id : null;
}

test.describe("XSS form-post live tests (plan §4)", () => {
  // ── F1: project search — ProjectListPage.tsx:107-113 ──
  // DISCREPANCY vs plan: the empty state is "No projects match your
  // {search ? "search" : "filter"}." — it never interpolates the actual
  // query text, only the literal word "search"/"filter". There is no page
  // text anywhere that echoes the query, so property #2 (marker present as
  // inert page text) cannot be checked there. The controlled input's own
  // value is the only round-trip evidence available; using that instead,
  // documented here rather than silently dropped.
  for (const xid of ["X-01", "X-02", "X-03", "X-04"]) {
    test(`F1 project search round-trip (${xid})`, async ({ page }) => {
      const diag: string[] = [];
      attachDiagnostics(page, diag);
      await loginAs(page);
      const payload = XSS[xid]!;
      await page.goto("/list");
      const input = page.locator("#project-search");
      await expect(input).toBeVisible();
      await input.fill(payload);
      await assertNoExecution(page, `F1 ${xid}`);
      await expect(input, `F1 ${xid}: round-trips byte-identical in the controlled input`).toHaveValue(payload);
      await assertNoInjectedElements(page, `F1 ${xid}`);
      await expect(
        page.getByText(/No projects match your (search|filter)\./),
        `F1 ${xid}: generic empty-state text (query itself is never interpolated — plan assumption is stale here)`,
      ).toBeVisible();
      reportDiagnostics(`F1 ${xid}`, diag);
    });
  }

  // ── F2: graph search — GraphToolbar.tsx:28-33, via cea4614a (read-only, complete) ──
  for (const xid of ["X-01", "X-02"]) {
    test(`F2 graph search round-trip (${xid})`, async ({ page }) => {
      test.setTimeout(60_000);
      const diag: string[] = [];
      attachDiagnostics(page, diag);
      await loginAs(page);
      const payload = XSS[xid]!;
      await page.goto(`/projects/${READONLY_COMPLETE_PROJECT_ID}/dependencies`);
      const input = page.getByPlaceholder("Search files, classes or methods...");
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(payload);
      await assertNoExecution(page, `F2 ${xid}`);
      const bodyText = await page.locator("body").innerText();
      expect(bodyText, `F2 ${xid}: "No matches for" echoes the full query as inert text`).toContain(
        `No matches for "${payload}"`,
      );
      await assertNoInjectedElements(page, `F2 ${xid}`);
      reportDiagnostics(`F2 ${xid}`, diag);
    });
  }

  // ── F3: architecture search — ArchitecturePage.tsx:223-226, via cea4614a ──
  // DISCREPANCY vs plan: this surface renders only a numeric count
  // ("{visible} / {total}") — it never echoes the query text either. Same
  // adaptation as F1: input value is the round-trip proof, documented.
  for (const xid of ["X-01", "X-02"]) {
    test(`F3 architecture search round-trip (${xid})`, async ({ page }) => {
      test.setTimeout(60_000);
      const diag: string[] = [];
      attachDiagnostics(page, diag);
      await loginAs(page);
      const payload = XSS[xid]!;
      await page.goto(`/projects/${READONLY_COMPLETE_PROJECT_ID}/architecture`);
      const input = page.getByPlaceholder("Search components or files…");
      await expect(input).toBeVisible({ timeout: 30_000 });
      await input.fill(payload);
      await assertNoExecution(page, `F3 ${xid}`);
      await expect(input, `F3 ${xid}: round-trips byte-identical in the controlled input`).toHaveValue(payload);
      await assertNoInjectedElements(page, `F3 ${xid}`);
      reportDiagnostics(`F3 ${xid}`, diag);
    });
  }

  // ── F4: Ask question box — AskPanel.tsx:108-113 — BLOCKED, see below ──
  // The Ask button/dialog only render when `!isMissing` (OnboardingPage.tsx
  // ~682, ~1162): a package must already exist. OWNER_PROJECT_ID is status
  // "idle" with no github_installation_id, so it can never reach a
  // completed analysis in this environment (verified: POST /analyze on it
  // fails immediately with "No GitHub App installation linked"). The only
  // project this account can reach with a real completed analysis is
  // READONLY_COMPLETE_PROJECT_ID, which is off-limits: POST /ask writes an
  // ai_generation_runs audit row and consumes real AI budget on every call
  // (confirmed by reading backend/src/api/routes/ask.ts), and the parent
  // session is concurrently exercising a shared per-user ask-route rate
  // limit against this same account. Given both constraints, F4's "echoed
  // question + markdown answer" render path could not be exercised through
  // a real form submission for any payload (X-01, X-02, X-06). This test
  // still executes live against the app to record the structural blocker
  // rather than being skipped.
  for (const xid of ["X-01", "X-02", "X-06"]) {
    test(`F4 ask box - BLOCKED, structural check only (${xid})`, async ({ page }) => {
      const diag: string[] = [];
      attachDiagnostics(page, diag);
      await loginAs(page);
      await page.goto(`/projects/${OWNER_PROJECT_ID}/onboarding`);
      await expect(
        page.getByRole("button", { name: "Ask" }),
        "F4: Ask button must not render — no completed analysis exists for this project (isMissing===true)",
      ).toHaveCount(0);
      await assertNoExecution(page, `F4 ${xid} (blocked)`);
      console.log(
        `[F4 ${xid}] BLOCKED: payload "${XSS[xid]}" could not be submitted through the real Ask form — ` +
          "no project reachable by this account offers both a completed analysis and write permission. " +
          'Direct API check (informational, not asserted here): POST /api/projects/{OWNER_PROJECT_ID}/ask ' +
          'returns 404 {"error":"No analyzed snapshot found for this project/scope"}.',
      );
      reportDiagnostics(`F4 ${xid}`, diag);
    });
  }

  // ── F5: profile display name — AccountSettingsPage.tsx ~313-320 ──
  for (const xid of ["X-01", "X-02"]) {
    test(`F5 profile display name round-trip (${xid})`, async ({ page }) => {
      const diag: string[] = [];
      attachDiagnostics(page, diag);
      await loginAs(page);
      const payload = XSS[xid]!;
      await page.goto("/settings");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator("#profile-name").fill(payload);
      await page.getByRole("button", { name: "Save profile" }).click();
      // Leaves edit mode on success, rendering `{fullName}` as plain JSX text
      // in the sidebar/account card — this IS a genuine text echo.
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible({ timeout: 10_000 });
      await assertNoExecution(page, `F5 ${xid}`);
      const bodyText = await page.locator("body").innerText();
      expect(bodyText, `F5 ${xid}: saved name echoes as inert text in the profile card`).toContain(payload);
      await assertNoInjectedElements(page, `F5 ${xid}`);
      reportDiagnostics(`F5 ${xid}`, diag);
    });
  }

  // ── F6: avatar URL — AccountSettingsPage.tsx:324-330 — rejection, not round-trip ──
  test("F6 avatar URL rejected by allowlist (X-05)", async ({ page }) => {
    const diag: string[] = [];
    attachDiagnostics(page, diag);
    await loginAs(page);
    const payload = XSS["X-05"]!;
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.locator("#profile-avatar").fill(payload);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(
      page.locator("p.text-destructive", { hasText: AVATAR_HELP_TEXT }),
      "F6: save is blocked client-side with the allowlist help text",
    ).toBeVisible();
    // Still in edit mode: save must not have gone through.
    await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
    await assertNoExecution(page, "F6");
    await expect(
      page.locator('img[src^="javascript:"]'),
      "F6: no <img> ever gets a javascript: src — safeAvatarSrc() withholds it",
    ).toHaveCount(0);
    reportDiagnostics("F6", diag);
  });

  // ── F7: ignored paths textarea — ProjectSettingsPage.tsx:333-340 ──
  test("F7 ignored paths round-trip after reload (X-02)", async ({ page }) => {
    const diag: string[] = [];
    attachDiagnostics(page, diag);
    await loginAs(page);
    const payload = XSS["X-02"]!;
    await page.goto(`/projects/${OWNER_PROJECT_ID}/settings`);
    const textarea = page.locator("textarea");
    await expect(textarea).toBeVisible();
    await textarea.fill(payload);
    const saveResponse = page.waitForResponse(
      (res) => res.url().includes(`/projects/${OWNER_PROJECT_ID}/settings`) && res.request().method() === "PUT",
    );
    await page.getByRole("button", { name: /Save changes|Saved!/ }).click();
    const res = await saveResponse;
    expect(res.status(), "F7: PUT /settings must succeed (200), not be rejected by the new validation").toBe(200);
    await page.reload();
    const reloadedTextarea = page.locator("textarea");
    await expect(
      reloadedTextarea,
      "F7: value persists byte-identical through a full reload (proves server round-trip, not just client state)",
    ).toHaveValue(payload);
    await assertNoExecution(page, "F7");
    await assertNoInjectedElements(page, "F7");
    reportDiagnostics("F7", diag);
  });

  // ── F8: team invite email — TeamPage.tsx:253-259 ──
  test("F8 team invite email field (X-02)", async ({ page }) => {
    const diag: string[] = [];
    attachDiagnostics(page, diag);
    await loginAs(page);
    const payload = XSS["X-02"]!;
    await page.goto(`/projects/${OWNER_PROJECT_ID}/team`);
    await page.getByRole("button", { name: "Invite" }).click();
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
    await emailInput.fill(payload);

    let requestFired = false;
    let responseStatus: number | null = null;
    page.on("requestfinished", (req) => {
      if (req.url().includes("/members/invitations") && req.method() === "POST") requestFired = true;
    });
    page.on("response", (res) => {
      if (res.url().includes("/members/invitations") && res.request().method() === "POST") {
        responseStatus = res.status();
        void res
          .json()
          .then((body: unknown) => {
            const id = extractInvitationId(body);
            if (id) createdInvitationId = id;
          })
          .catch(() => {});
      }
    });

    const isNativelyValid = await emailInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForTimeout(1500);

    await assertNoExecution(page, "F8");
    await assertNoInjectedElements(page, "F8");

    if (!isNativelyValid && !requestFired) {
      console.log(
        `[F8] Browser-level control: input[type="email"] rejects "${payload}" via HTML5 constraint ` +
          "validation, so the form submit event never fires and the payload never reaches the server " +
          "through this UI path — a legitimate defense-in-depth negative result, not a skipped case.",
      );
    } else {
      // Native validation let it through (unexpected) — the payload did
      // reach the server; check what came back and, if accepted, that it
      // renders inertly in the pending-invitations list.
      console.log(`[F8] Native email validation did NOT block submission; response status=${responseStatus}`);
      if (responseStatus === 201 || responseStatus === 200) {
        const bodyText = await page.locator("body").innerText();
        expect(bodyText, "F8: invite email echoes as inert text in the pending list").toContain(payload);
      }
    }
    reportDiagnostics("F8", diag);
  });

  // ── F9: custom scope path — AnalyzeConfigForm.tsx:203-209 ──
  test("F9 custom scope path round-trip in run history (X-02)", async ({ page }) => {
    test.setTimeout(45_000);
    const diag: string[] = [];
    attachDiagnostics(page, diag);
    await loginAs(page);
    const payload = XSS["X-02"]!;
    await page.goto(`/projects/${OWNER_PROJECT_ID}`);
    await page.locator('[data-tour="analyze-button"]').click();
    await page.locator("#analyze-scope").click();
    await page.getByRole("option", { name: "Custom path…" }).click();
    const scopePathInput = page.locator("#analyze-scope-path");
    await expect(scopePathInput).toBeVisible();
    await scopePathInput.fill(payload);
    await page.getByRole("button", { name: "Start analysis" }).click();
    // Job creation is synchronous (INSERT inside the POST /analyze
    // transaction); it fails fast in the worker for this project (no GitHub
    // App installation — confirmed independently). Reload to force a clean
    // refetch of /runs rather than trusting in-page state timing.
    await page.waitForTimeout(1500);
    await page.reload();
    const runHistory = page.locator('[data-tour="run-history"]');
    await expect(runHistory).toBeVisible({ timeout: 20_000 });
    const summaries = runHistory.locator("details summary");
    const count = await summaries.count();
    for (let i = 0; i < count; i++) {
      await summaries.nth(i).click();
    }
    await assertNoExecution(page, "F9");
    await expect(
      runHistory,
      `F9: run history badge renders "scope ${payload}/" as inert JSX text`,
    ).toContainText(`scope ${payload}/`);
    await assertNoInjectedElements(page, "F9");
    reportDiagnostics("F9", diag);
  });

  // ── F10: ?next= param — AuthCallbackPage.tsx:27-30 — rejection, not round-trip ──
  test("F10 ?next= navigation guard rejects javascript: URL (X-05)", async ({ page }) => {
    const diag: string[] = [];
    attachDiagnostics(page, diag);
    await loginAs(page);
    const payload = XSS["X-05"]!;
    await page.goto(`/auth/callback?next=${encodeURIComponent(payload)}`);
    await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
    expect(new URL(page.url()).pathname, "F10: guard falls back to /dashboard, never the payload").toBe(
      "/dashboard",
    );
    await assertNoExecution(page, "F10");
    reportDiagnostics("F10", diag);
  });

  // ── F11: error_description param — AuthCallbackPage.tsx:13-19 ──
  test("F11 error_description reflected text (X-01)", async ({ page }) => {
    const diag: string[] = [];
    attachDiagnostics(page, diag);
    await loginAs(page);
    const payload = XSS["X-01"]!;
    await page.goto(`/auth/callback?error=access_denied&error_description=${encodeURIComponent(payload)}`);
    await expect(page.getByText("Sign in failed")).toBeVisible();
    await assertNoExecution(page, "F11");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText, "F11: error_description echoes as inert text").toContain(payload);
    await assertNoInjectedElements(page, "F11");
    reportDiagnostics("F11", diag);
  });
});
