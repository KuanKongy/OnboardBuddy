import { test } from "@playwright/test";
import { installCensus } from "./census";

/** Are the console TypeErrors seen under mocks real, or mock-shape artifacts? */
const TOKEN = process.env.OB_TOKEN ?? "";
const PROJ = process.env.OB_PROJECT ?? "";

test("live console errors", async ({ page }) => {
  test.skip(!TOKEN, "OB_TOKEN not set");
  test.setTimeout(180_000);
  const errs: { where: string; msg: string }[] = [];
  let where = "";
  page.on("console", (m) => m.type() === "error" && errs.push({ where, msg: m.text().slice(0, 110) }));
  page.on("pageerror", (e) => errs.push({ where, msg: "PAGEERROR " + String(e).slice(0, 110) }));

  await installCensus(page);
  await page.addInitScript((tok) => {
    window.localStorage.setItem("sb-mdexrahwgznmhdicgtql-auth-token", JSON.stringify({
      access_token: tok, refresh_token: "live", expires_at: Math.floor(Date.now()/1000)+3600,
      expires_in: 3600, token_type: "bearer",
      user: { id: "live", email: "obb-ux-m4@example.com", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" },
    }));
    for (const p of ["onboardbuddy:tour-dismissed","onboardbuddy:project-tour-dismissed","onboardbuddy:import-tour-dismissed","onboardbuddy:onboarding-tour-dismissed","onboardbuddy:reader-tour-dismissed"]) {
      localStorage.setItem(p,"1"); localStorage.setItem(`${p}:live`,"1");
    }
  }, TOKEN);

  for (const [name, url] of [
    ["dashboard", "/dashboard"],
    ["list", "/list"],
    ["import", "/import"],
    ["account-settings", "/settings"],
    ["help", "/help"],
    ["overview", `/projects/${PROJ}`],
    ["architecture", `/projects/${PROJ}/architecture`],
    ["dependencies", `/projects/${PROJ}/dependencies`],
  ] as const) {
    where = name;
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2200);
    const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 60).replace(/\s+/g, " "));
    console.log(`LIVE ${name.padEnd(18)} errs=${errs.filter((e) => e.where === name).length}  body="${body}"`);
  }
  console.log("DISTINCT: " + JSON.stringify([...new Set(errs.map((e) => e.msg))], null, 1).slice(0, 900));
});
