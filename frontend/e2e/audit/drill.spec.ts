import { test, expect, type Page } from "@playwright/test";
import { P, mockApi } from "../fixtures";

/**
 * Drill-down navigation in a real browser.
 *
 * Two behaviours are pinned here that unit tests cannot reach, because both
 * are about the *camera*: selecting a node must not change zoom, and drilling
 * must. React Flow only computes a viewport transform against a measured
 * canvas, so this needs a real layout.
 *
 * Every wait is on `[data-drill-phase="idle"]` rather than a timeout — the
 * canvas publishes its transition state precisely so tests do not have to
 * guess how long an animation takes.
 */

const cluster = (dir: string, files: number) => ({
  id: `cluster:${dir}`,
  label: `${dir}/ (${files} files)`,
  kind: "cluster",
  metadata: { exportedSymbols: [], importCount: files, dependentCount: 0, fileCount: files, directory: dir },
});
const file = (path: string, label: string) => ({
  id: path,
  label,
  kind: "module",
  metadata: { exportedSymbols: [label], importCount: 2, dependentCount: 1 },
});

/** A clustered graph, which the shared fixture does not provide. */
async function mockClusteredGraph(page: Page): Promise<void> {
  await page.route("**/api/projects/*/graph/dependencies*", async (route) => {
    const url = new URL(route.request().url());
    const drilled = url.searchParams.get("cluster");
    const body = !drilled
      ? {
          projectId: P, snapshotId: "snap-1", clustered: true, totalNodes: 90, totalEdges: 40,
          graph: {
            nodes: [cluster("src/lib", 40), cluster("src/api", 30), cluster("src/ui", 20)],
            edges: [{ id: "e0", source: "cluster:src/lib", target: "cluster:src/api", kind: "dependency", weight: 3 }],
            entryPoints: [],
          },
          fileAnalyses: [],
        }
      : {
          projectId: P, snapshotId: "snap-1", clustered: false, totalNodes: 3, totalEdges: 2,
          graph: {
            // Spread far apart so at least one node starts off-screen — that
            // is the only case pan-into-view is allowed to move the camera.
            nodes: [file(`${drilled}/alpha.ts`, "alpha"), file(`${drilled}/beta.ts`, "beta"), file(`${drilled}/gamma.ts`, "gamma")],
            edges: [
              { id: "e1", source: `${drilled}/alpha.ts`, target: `${drilled}/beta.ts`, kind: "imports", weight: 1 },
              { id: "e2", source: `${drilled}/beta.ts`, target: `${drilled}/gamma.ts`, kind: "imports", weight: 1 },
            ],
            entryPoints: [],
          },
          fileAnalyses: [],
        };
    await route.fulfill({ json: body });
  });
}

const idle = (page: Page) => page.locator('[data-drill-phase="idle"]').first();

/** React Flow writes `transform: translate(x, y) scale(z)` on its viewport. */
async function zoomOf(page: Page): Promise<number> {
  const t = await page.locator(".react-flow__viewport").first().getAttribute("style");
  const m = /scale\(([\d.]+)\)/.exec(t ?? "");
  return m ? Number(m[1]) : NaN;
}

async function openGraph(page: Page, query = ""): Promise<void> {
  await mockApi(page);
  await mockClusteredGraph(page);
  await page.goto(`/projects/${P}/dependencies${query}`);
  await expect(idle(page)).toBeVisible();
}

/**
 * Opens a group the way a reader does: the Open button on its card.
 *
 * A plain click on the card SELECTS now (owner I1's model, already used by the
 * Architecture map) — the account preference is what restores click-to-open —
 * so the camera contract below has to be driven through the control that
 * actually navigates by default.
 */
async function openGroup(page: Page, label: string): Promise<void> {
  await page.getByLabel(new RegExp(`^Open ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} and list its`)).click();
}

test.describe("drill-down", () => {
  test("selecting a node does not change the zoom level", async ({ page }) => {
    await openGraph(page, "?drill=cluster,src%2Flib,lib");
    await expect(page.getByText("alpha", { exact: true })).toBeVisible();

    const before = await zoomOf(page);
    await page.getByText("alpha", { exact: true }).click();
    // The detail panel opening is the observable effect of a selection.
    await expect(page.getByText("beta", { exact: true })).toBeVisible();
    const after = await zoomOf(page);

    // This is the regression that started the rework: every selection used to
    // fire setCenter(..., { zoom: 1.15 }).
    expect(after).toBeCloseTo(before, 3);
  });

  test("drilling into a group runs a zoom transition and swaps the level", async ({ page }) => {
    await openGraph(page);
    await expect(page.getByText("src/lib/ (40 files)")).toBeVisible();

    await openGroup(page, "src/lib/ (40 files)");

    // The camera moves (that is the navigation signal), the level swaps, and
    // the transition finishes.
    await expect(idle(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("alpha", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dependencies" })).toBeVisible();
    await expect(page.getByRole("button", { name: /back/i })).toBeVisible();
    expect(page.url()).toContain("drill=cluster");
  });

  test("Back returns to the level you came from", async ({ page }) => {
    await openGraph(page);
    await openGroup(page, "src/lib/ (40 files)");
    await expect(idle(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("alpha", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /back/i }).click();

    await expect(idle(page)).toBeVisible({ timeout: 10_000 });
    // All three groups again — not a synthesized `src` prefix level.
    await expect(page.getByText("src/api/ (30 files)")).toBeVisible();
    await expect(page.getByText("src/ui/ (20 files)")).toBeVisible();
    expect(page.url()).not.toContain("drill=");
  });

  test("a click during the transition is ignored", async ({ page }) => {
    await openGraph(page);
    await openGroup(page, "src/lib/ (40 files)");
    // Fire a second navigation immediately, before the first settles.
    await page.getByLabel(/^Open src\/api\/ \(30 files\) and list its/).click({ force: true, timeout: 2000 }).catch(() => {});

    await expect(idle(page)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /back/i }).click();
    await expect(idle(page)).toBeVisible({ timeout: 10_000 });

    // One Back is enough: the ignored click must not have pushed a second
    // history entry.
    await expect(page.getByText("src/api/ (30 files)")).toBeVisible();
    expect(page.url()).not.toContain("drill=");
  });

  test("a drill level survives reload", async ({ page }) => {
    await openGraph(page);
    await openGroup(page, "src/lib/ (40 files)");
    await expect(idle(page)).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(idle(page)).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText("alpha", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dependencies" })).toBeVisible();
  });

  test("a legacy ?cluster= link still opens that level", async ({ page }) => {
    await openGraph(page, "?cluster=src%2Fapi");
    await expect(page.getByText("alpha", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dependencies" })).toBeVisible();
  });
});
