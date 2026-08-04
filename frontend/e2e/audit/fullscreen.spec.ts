import { test } from "@playwright/test";
import { P, mockApi, setTheme } from "../fixtures";
import { installCensus } from "./census";

/** Isolates the fullscreen trap: is there any way out, and is it discoverable? */
test("fullscreen exit", async ({ page }) => {
  test.setTimeout(120_000);
  await installCensus(page);
  await page.addInitScript(() => {
    for (const p of ["onboardbuddy:tour-dismissed","onboardbuddy:project-tour-dismissed","onboardbuddy:import-tour-dismissed","onboardbuddy:onboarding-tour-dismissed","onboardbuddy:reader-tour-dismissed"]) { localStorage.setItem(p,"1"); localStorage.setItem(`${p}:user-1`,"1"); }
  });
  await setTheme(page, "dark");
  await mockApi(page);
  await page.goto(`/projects/${P}/architecture`);
  await page.waitForTimeout(2500);

  const probe = () => page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /fullscreen/i.test(x.getAttribute("title") ?? ""));
    if (!b) return { present: false as const };
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      present: true as const,
      title: b.getAttribute("title"),
      rect: [r.left, r.top, r.width, r.height].map(Math.round),
      covered: !(b === top || b.contains(top as Node) || (top as Node)?.contains(b)),
      coveredBy: (top as HTMLElement | null)?.className?.toString().slice(0, 70) ?? null,
    };
  });

  const btn = page.getByRole("button", { name: /fullscreen/i }).first();
  const before = await page.evaluate(() => window.__ob.fp());
  console.log("BEFORE-CLICK " + JSON.stringify(await probe()));
  await btn.click({ force: true });
  await page.waitForTimeout(900);
  console.log("AFTER-CLICK  " + JSON.stringify(await probe()));

  const inFs = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /fullscreen/i.test(x.getAttribute("title") ?? ""));
    if (!b) return { btn: "gone" };
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      title: b.getAttribute("title"),
      visibleInDom: true,
      covered: !(b === top || b.contains(top!) || top!.contains(b)),
      coveredBy: (top as HTMLElement)?.className?.toString().slice(0, 80),
      overlays: document.querySelectorAll(".fixed.inset-0").length,
      // is ANY control rendered inside the fullscreen overlay that could exit?
      controlsInsideOverlay: Array.from(document.querySelectorAll(".fixed.inset-0 button")).map(
        (x) => (x.getAttribute("title") || x.getAttribute("aria-label") || (x as HTMLElement).innerText || "").trim().slice(0, 30),
      ),
      hintText: /esc/i.test(document.body.innerText) ? "mentions Esc" : "no Esc hint on screen",
    };
  });
  console.log("IN-FULLSCREEN " + JSON.stringify(inFs, null, 1));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.__ob.fp());
  console.log("ESCAPE restored overlays: " + before.overlays + " -> " + after.overlays + " (rf " + before.rf + " -> " + after.rf + ")");
  console.log("ESCAPE WORKS: " + (after.overlays === before.overlays));
});
