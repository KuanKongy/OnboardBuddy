import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { installCensus } from "./census";

/**
 * Live-data walk of the Import wizard and Invitations — the two surfaces that
 * were unreachable in every previous pass because `github_installations` was
 * empty. Nothing is mocked here: this runs against the real API with a real
 * Supabase session, so findings are `src:live`.
 *
 * Requires OB_TOKEN (a real access_token) — obtain with:
 *   curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
 *     -d '{"email":"…","password":"…"}'
 */

const TOKEN = process.env.OB_TOKEN ?? "";
const LEDGER = process.env.OB_LEDGER_DIR ?? path.join(process.cwd(), "e2e/audit/ledger-live");

test.describe("live import", () => {
  test.skip(!TOKEN, "OB_TOKEN not set");

  test("walk the import wizard on live data", async ({ page }) => {
    test.setTimeout(180_000);
    const consoleErrs: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrs.push(m.text().slice(0, 140)));

    await installCensus(page);
    await page.addInitScript((tok) => {
      const session = {
        access_token: tok,
        refresh_token: "live",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "live", email: "obb-ux-m4@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
      };
      window.localStorage.setItem("sb-mdexrahwgznmhdicgtql-auth-token", JSON.stringify(session));
      for (const k of [
        "onboardbuddy:tour-dismissed",
        "onboardbuddy:project-tour-dismissed",
        "onboardbuddy:import-tour-dismissed",
        "onboardbuddy:onboarding-tour-dismissed",
        "onboardbuddy:reader-tour-dismissed",
      ]) window.localStorage.setItem(k, "1");
    }, TOKEN);

    await page.goto("/import");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2500);

    const env = await page.evaluate(() => ({ vis: document.visibilityState, focus: document.hasFocus() }));
    expect(env.vis).toBe("visible");

    const out: string[] = [];
    const snap = async (label: string) => {
      const s = await page.evaluate(() => {
        const txt = (document.body.innerText ?? "").replace(/\s+/g, " ").trim();
        return {
          url: location.pathname + location.search,
          heading: document.querySelector("h1")?.textContent?.trim() ?? "",
          controls: window.__ob.census().map((c) => ({ n: c.name.slice(0, 46), role: c.role, disabled: c.disabled, tip: c.tip.kind, label: c.labelSource, tab: c.tabPos })),
          comboboxes: Array.from(document.querySelectorAll('[role="combobox"]')).map((e) => (e as HTMLElement).innerText.trim().slice(0, 40)),
          alerts: Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map((e) => (e as HTMLElement).innerText.trim().slice(0, 90)),
          bodyLen: txt.length,
          text: txt.slice(0, 900),
        };
      });
      out.push(`### ${label}\n` + JSON.stringify(s, null, 1));
      return s;
    };

    const step1 = await snap("step1-initial");
    console.log("STEP1 heading=" + step1.heading + " controls=" + step1.controls.length + " comboboxes=" + step1.comboboxes.length);
    console.log("STEP1 text: " + step1.text.slice(0, 320));

    // Open each Radix combobox in turn and record its options. These are the
    // controls no previous pass could operate — synthetic clicks never opened
    // them, and the account had no installation to populate them.
    const combos = page.locator('[role="combobox"]');
    const n = await combos.count();
    for (let i = 0; i < n; i++) {
      const c = combos.nth(i);
      const label = (await c.innerText().catch(() => "")).slice(0, 40);
      await c.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700);
      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="option"]')).map((e) => (e as HTMLElement).innerText.trim().slice(0, 60)),
      );
      out.push(`### combobox[${i}] "${label}" options=${JSON.stringify(opts)}`);
      console.log(`COMBO[${i}] "${label}" -> ${opts.length} options: ${JSON.stringify(opts).slice(0, 200)}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    // Progressive walk: a single installation auto-selects (no account
    // combobox exists then — pick() returns null and moves on), Repository
    // reveals Role beside it once chosen; there is no Branch step. Each stage
    // is censused so the controls that only exist mid-flow are recorded too.
    const pick = async (comboLabel: RegExp, optionText?: RegExp) => {
      const c = page.locator('[role="combobox"]').filter({ hasText: comboLabel }).first();
      if ((await c.count()) === 0) return null;
      await c.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700);
      const opt = optionText
        ? page.locator('[role="option"]').filter({ hasText: optionText }).first()
        : page.locator('[role="option"]').first();
      const label = await opt.innerText().catch(() => "");
      await opt.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1400);
      return label.trim();
    };

    const acct = await pick(/Select account|OnboardBuddy455/);
    const s2 = await snap("step1-after-account");
    console.log(`PICKED account="${acct}" -> controls=${s2.controls.length} comboboxes=${s2.comboboxes.length} :: ${JSON.stringify(s2.comboboxes)}`);

    const repo = await pick(/Select repository/, /StudyFlow/);
    const s3 = await snap("step1-after-repo");
    console.log(`PICKED repo="${repo}" -> controls=${s3.controls.length} comboboxes=${JSON.stringify(s3.comboboxes)}`);

    // ignored-paths sub-form
    const toggle = page.getByRole("button", { name: /ignored paths/i }).first();
    if (await toggle.count()) {
      await toggle.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      const s4 = await snap("step1-ignored-paths-open");
      console.log(`IGNORED-PATHS opened -> controls=${s4.controls.length}`);
    }

    const importBtn = page.getByRole("button", { name: /Import repository/i }).first();
    const canImport = (await importBtn.count()) ? await importBtn.isEnabled() : null;
    console.log(`IMPORT button present=${(await importBtn.count()) > 0} enabled=${canImport}`);
    out.push(`### import-button enabled=${canImport}`);

    out.push("### console\n" + JSON.stringify(consoleErrs, null, 1));
    fs.mkdirSync(LEDGER, { recursive: true });
    fs.writeFileSync(path.join(LEDGER, "import-live.md"), out.join("\n\n"));
    console.log("CONSOLE ERRORS: " + consoleErrs.length);
  });
});
