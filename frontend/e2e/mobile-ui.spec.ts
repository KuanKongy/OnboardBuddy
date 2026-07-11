import { expect, test } from "@playwright/test";
import { P, TABS, mockApi, setTheme } from "./fixtures";

/**
 * Phone-size regression: every project tab plus the dashboard renders at
 * 390x844 (iPhone-ish), the page never scrolls horizontally, and the
 * sidebar works as a drawer on mobile / collapses on desktop.
 *
 *   SCREENSHOT_DIR=/tmp/shots npx playwright test e2e/mobile-ui.spec.ts
 */

const OUT = process.env.SCREENSHOT_DIR ?? "e2e/screenshots-mobile";
const PHONE = { width: 390, height: 844 };

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, "page must not scroll horizontally on phones").toBeLessThanOrEqual(1);
}

const PAGES = [
  { name: "dashboard", path: "/dashboard", ready: async (p: import("@playwright/test").Page) => { await expect(p.getByText("auth-demo").first()).toBeVisible(); } },
  ...TABS,
];

for (const pageDef of PAGES) {
  test(`${pageDef.name} fits a phone screen`, async ({ page }) => {
    await mockApi(page);
    await setTheme(page, "dark");
    await page.setViewportSize(PHONE);
    await page.goto(pageDef.path);
    await pageDef.ready(page);
    await page.waitForTimeout(700);
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${OUT}/${pageDef.name}-phone.png`, fullPage: true });
  });
}

test("sidebar opens as a drawer on phones", async ({ page }) => {
  await mockApi(page);
  await setTheme(page, "dark");
  await page.setViewportSize(PHONE);
  await page.goto(`/projects/${P}`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  // Closed by default on mobile (translated off-screen); the toggle opens it.
  await expect(page.getByRole("link", { name: "Your Onboarding" })).not.toBeInViewport();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByRole("link", { name: "Your Onboarding" })).toBeInViewport();
  await page.screenshot({ path: `${OUT}/sidebar-drawer-phone.png` });
});

test("sidebar collapses and restores on desktop", async ({ page }) => {
  await mockApi(page);
  await setTheme(page, "dark");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${P}`);
  await expect(page.getByRole("link", { name: "Your Onboarding" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByRole("link", { name: "Your Onboarding" })).not.toBeVisible();
  // Collapse persists across reloads.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Your Onboarding" })).not.toBeVisible();
  await page.getByRole("button", { name: "Toggle sidebar" }).click();
  await expect(page.getByRole("link", { name: "Your Onboarding" })).toBeVisible();
});
