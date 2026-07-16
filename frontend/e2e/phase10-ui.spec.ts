import { expect, test } from "@playwright/test";

/**
 * Phase 10 UI verification: renders every project tab against realistic
 * mocked API data (no backend needed) in both themes, asserts the key
 * content is visible, and captures full-page screenshots for design review.
 *
 *   SCREENSHOT_DIR=/tmp/shots npx playwright test e2e/phase10-ui.spec.ts
 */

const OUT = process.env.SCREENSHOT_DIR ?? "e2e/screenshots";
import { P, TABS, mockApi, setTheme } from "./fixtures";


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

test("running analysis shows a stage-labeled, monotonic progress bar with live activity", async ({ page }) => {
  await mockApi(page);
  await setTheme(page, "dark");
  // Override analysis-status with an in-flight generation job (registered
  // after mockApi so it wins route matching).
  await page.route(/\/api\/projects\/[^/]+\/analysis-status/, (route) =>
    route.fulfill({
      json: {
        jobs: [{
          id: "job-2", job_type: "generate_package", status: "running", progress_pct: 40,
          current_step: "Generating: architecture",
          checkpoint: {},
          step_log: [
            { step: "Loading snapshot", pct: 5, ts: "2026-07-10T10:00:01Z" },
            { step: "Generating request-flow tutorials", pct: 12, ts: "2026-07-10T10:00:40Z" },
            { step: "Generating: start_here", pct: 22, ts: "2026-07-10T10:01:30Z" },
            { step: "Generating: architecture", pct: 40, ts: "2026-07-10T10:02:10Z" },
          ],
          error_message: null, created_at: "2026-07-10T10:00:00Z", started_at: "2026-07-10T10:00:01Z",
          finished_at: null, file_count: 8, symbol_count: 42, workflow_count: 2, commit_hash: "abc1234def",
        }],
        latestSnapshot: { id: "snap-1", file_count: 8, symbol_count: 42, workflow_count: 2, commit_hash: "abc1234def", created_at: "2026-07-08T10:20:00Z" },
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${P}`);
  await expect(page.getByText("Generating onboarding — Generating: architecture")).toBeVisible();
  // 70 + 40*0.3 = 82% — generation never restarts the bar at zero. The Radix
  // indicator encodes value as translateX(-(100-value)%).
  await expect(page.locator('[data-slot="progress-indicator"]')).toHaveAttribute(
    "style",
    /translateX\(-18%\)/,
  );
  // The unified run panel lists pipeline steps with the current step inline
  // on the running phase, and the spend line from the snapshot budget.
  await expect(page.getByText("Generate onboarding")).toBeVisible();
  await expect(page.getByText(/Spend: 63 AI calls/)).toBeVisible();
  // Earlier job steps stay available in the raw step log.
  await page.getByText(/Raw step log/).click();
  await expect(page.getByText("Generating request-flow tutorials").first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/overview-running-dark.png`, fullPage: true });
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
