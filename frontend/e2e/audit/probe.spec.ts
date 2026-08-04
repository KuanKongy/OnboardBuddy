import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { P, mockApi, setTheme } from "../fixtures";
import { installCensus, type Control, type Fingerprint } from "./census";
import { mockExtras, type Variant } from "./mocks";

/**
 * The exhaustive interaction probe.
 *
 * Contract: for every surface, every censused control is hovered AND activated,
 * or explicitly skipped with a reason from a closed set. Each act records a
 * before/after state fingerprint instead of a screenshot, so operating a
 * control costs ~600 bytes rather than a 200KB image. That cost ratio is the
 * whole reason the previous passes only ever operated ~5% of the product.
 */

const LEDGER = process.env.OB_LEDGER_DIR ?? path.join(process.cwd(), "e2e/audit/ledger");
const TIER = (process.env.OB_TIER ?? "owner") as "owner" | "admin" | "developer";
const VARIANT = (process.env.OB_VARIANT ?? "full") as Variant;
const THEME = (process.env.OB_THEME ?? "dark") as "dark" | "light";
const ONLY = process.env.OB_SURFACE;

/** Never activate these — they end the session or leave the app. */
const SKIP_NAME = /^(Sign Out|Sign out|Log out|Logout)$/i;
const SKIP_REASON = {
  external: "external-navigation",
  session: "ends-session",
  dup: "duplicate-of-cid",
} as const;

type Surface = { name: string; path: string; ready?: (p: Page) => Promise<void> };

const SURFACES: Surface[] = [
  { name: "landing", path: "/" },
  { name: "login", path: "/login" },
  { name: "signup", path: "/signup" },
  { name: "forgot-password", path: "/forgot-password" },
  { name: "reset-password", path: "/reset-password" },
  { name: "dashboard", path: "/dashboard" },
  { name: "list", path: "/list" },
  { name: "import", path: "/import" },
  { name: "invitations", path: "/invitations" },
  { name: "account-settings", path: "/settings" },
  { name: "help", path: "/help" },
  { name: "faq", path: "/faq" },
  { name: "overview", path: `/projects/${P}` },
  { name: "onboarding-cards", path: `/projects/${P}/onboarding` },
  { name: "onboarding-reader", path: `/projects/${P}/onboarding?view=reader&role=backend` },
  { name: "architecture", path: `/projects/${P}/architecture` },
  { name: "dependencies", path: `/projects/${P}/dependencies` },
  { name: "dependencies-classes", path: `/projects/${P}/dependencies?view=classes` },
  { name: "workflows", path: `/projects/${P}/workflows` },
  { name: "capabilities", path: `/projects/${P}/capabilities` },
  { name: "walkthrough", path: `/projects/${P}/walkthrough` },
  { name: "team", path: `/projects/${P}/team` },
  { name: "project-settings", path: `/projects/${P}/settings` },
  { name: "bad-project-id", path: "/projects/00000000-0000-0000-0000-000000000000" },
  { name: "unmatched-route", path: "/projects" },
];

const outDir = (s: string) => path.join(LEDGER, `${s}__${TIER}__${VARIANT}__${THEME}`);

function writeOut(surface: string, file: string, body: string) {
  const d = outDir(surface);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, file), body);
}

async function fp(page: Page): Promise<Fingerprint> {
  return page.evaluate(() => window.__ob.fp());
}

function deltaKeys(a: Fingerphrase, b: Fingerphrase): string[] {
  const keys: string[] = [];
  const walk = (pa: unknown, pb: unknown, prefix: string) => {
    if (typeof pa !== "object" || pa === null || typeof pb !== "object" || pb === null) {
      if (JSON.stringify(pa) !== JSON.stringify(pb)) keys.push(prefix);
      return;
    }
    const all = new Set([...Object.keys(pa as object), ...Object.keys(pb as object)]);
    for (const k of all) walk((pa as never)[k], (pb as never)[k], prefix ? `${prefix}.${k}` : k);
  };
  walk(a, b, "");
  return keys;
}
type Fingerphrase = Fingerprint;

/** The 14 auto-flags. Each maps to a failure class already seen in this product. */
function flagsFor(rec: {
  ctrl: Control;
  changed: boolean;
  net: string[];
  hit: string;
  reversible: string;
  focusAfter: string;
  alerts: string[];
  survivesReload: string;
  console: string[];
  menuItems: number | null;
  hoverChanged: boolean;
  navigated: boolean;
  failed: boolean;
}): string[] {
  const f: string[] = [];
  const mutating = rec.net.some((n) => /^(POST|PUT|PATCH|DELETE)/.test(n));
  if (!rec.changed && rec.net.length === 0 && !rec.failed) f.push("NOOP");
  if (rec.failed) f.push("UNCLICKABLE");
  if (mutating && rec.alerts.length === 0 && !rec.changed) f.push("SILENT-MUTATION");
  if (rec.reversible === "no" && !rec.navigated) f.push("IRREVERSIBLE");
  if (rec.hit === "occluded") f.push("OCCLUDED");
  if (rec.focusAfter === "BODY" || rec.focusAfter === "") f.push("FOCUS-LOST");
  if (rec.ctrl.labelSource === "none") f.push("UNLABELED");
  if (rec.ctrl.tip.kind === "title") f.push("TIP-NATIVE");
  if (rec.ctrl.tabPos === null && !rec.ctrl.disabled) f.push("UNREACHABLE");
  if (rec.console.length) f.push("CONSOLE");
  if (rec.survivesReload === "no" && rec.changed && !rec.navigated) f.push("STATE-LOST-ON-RELOAD");
  if (rec.ctrl.disabled && !rec.ctrl.tip.text) f.push("DISABLED-NO-REASON");
  if (rec.menuItems === 1) f.push("SINGLETON-MENU");
  if (rec.ctrl.truncated) f.push("TRUNCATED");
  if (!rec.hoverChanged && rec.ctrl.tip.kind === "none" && rec.ctrl.kind === "other" && !rec.ctrl.disabled) f.push("HOVER-DEAD");
  return f;
}

for (const surface of SURFACES) {
  if (ONLY && ONLY !== surface.name) continue;

  test(`probe ${surface.name} [${TIER}/${VARIANT}/${THEME}]`, async ({ page }) => {
    test.setTimeout(240_000);

    const consoleErrs: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text().slice(0, 120));
    });
    const netLog: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) netLog.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });

    await installCensus(page);
    // Dismiss ALL five tours. `mockApi` only clears two of them, and a live
    // tour renders `[data-tour-overlay]` as a full-viewport layer that
    // intercepts pointer events — every click then fails Playwright's
    // actionability check and is recorded as a dead control. (That the overlay
    // swallows clicks is a real product finding; here it has to be neutralised
    // so the probe measures the product rather than the tour.)
    await page.addInitScript(() => {
      // `lib/tourState.ts` keys dismissal as `${prefix}:${userId}` — the bare
      // prefix never matches, so setting it leaves the tour running and its
      // `fixed inset-0 z-[60]` overlay intercepts every click on the surface.
      for (const prefix of [
        "onboardbuddy:tour-dismissed",
        "onboardbuddy:project-tour-dismissed",
        "onboardbuddy:import-tour-dismissed",
        "onboardbuddy:onboarding-tour-dismissed",
        "onboardbuddy:reader-tour-dismissed",
      ]) {
        window.localStorage.setItem(prefix, "1");
        window.localStorage.setItem(`${prefix}:user-1`, "1");
        window.localStorage.setItem(`${prefix}:live`, "1");
      }
    });
    await setTheme(page, THEME);
    await mockApi(page, { tier: TIER });
    await mockExtras(page, VARIANT);

    await page.goto(surface.path);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (surface.ready) await surface.ready(page).catch(() => {});
    await page.waitForTimeout(1200);

    // Environment assertion: everything downstream assumes a foreground tab.
    // This is the constraint that invalidated a whole class of earlier findings.
    const env = await page.evaluate(() => ({ vis: document.visibilityState, focus: document.hasFocus() }));
    expect(env.vis, "audit requires a foreground tab").toBe("visible");

    // ── census, twice, to prove stability ─────────────────────────────────
    const c1 = await page.evaluate(() => window.__ob.census());
    await page.waitForTimeout(400);
    const c2 = await page.evaluate(() => window.__ob.census());
    const stable = c1.length === c2.length && c1.every((c, i) => c.cid === c2[i]?.cid);
    const controls = c2;

    writeOut(
      surface.name,
      "census.tsv",
      ["cid\trole\tname\tregion\tlabelSrc\ttip\tdisabled\ttabPos\ttrunc\tbbox"]
        .concat(
          controls.map((c) =>
            [c.cid, c.role, c.name.replace(/\t/g, " "), c.region, c.labelSource, c.tip.kind, c.disabled, c.tabPos, c.truncated, c.bbox.join(",")].join("\t"),
          ),
        )
        .join("\n"),
    );

    // ── tab-walk ──────────────────────────────────────────────────────────
    const tabSeq: string[] = [];
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < Math.min(120, controls.length + 20); i++) {
      await page.keyboard.press("Tab");
      const cur = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || a === document.body) return "BODY";
        const r = a.getBoundingClientRect();
        const off = r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight;
        return (
          (a.getAttribute("aria-label") || a.innerText || a.getAttribute("title") || a.tagName)
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 44) + (off ? " [OFFSCREEN]" : "")
        );
      });
      tabSeq.push(cur);
      if (tabSeq.length > 3 && cur === tabSeq[0] && tabSeq[tabSeq.length - 2] !== cur) break;
    }
    writeOut(surface.name, "taborder.txt", tabSeq.join("\n"));

    // ── operate every control ─────────────────────────────────────────────
    const ledger: string[] = [];

    for (const ctrl of controls) {
      const rec: Record<string, unknown> = { surface: surface.name, tier: TIER, variant: VARIANT, cid: ctrl.cid, name: ctrl.name, role: ctrl.role };

      // skip rules
      if (SKIP_NAME.test(ctrl.name)) {
        ledger.push(JSON.stringify({ ...rec, action: "skip", skipped: SKIP_REASON.session }));
        continue;
      }
      if (ctrl.kind === "nav-external") {
        ledger.push(JSON.stringify({ ...rec, action: "skip", skipped: SKIP_REASON.external, href: ctrl.href }));
        continue;
      }

      // Re-stamp before every control: `census()` sets `data-ob-cid` as a side
      // effect, and those attributes die with the DOM on any navigation. Without
      // this, the first control that navigates strands all the rest as
      // "not-found" — the pilot operated 1 of 31 for exactly this reason.
      const here = new URL(page.url()).pathname + new URL(page.url()).search;
      // Reset to a clean surface before each control. Without this, a dialog or
      // menu opened by the PREVIOUS control stays mounted and every later
      // hit-test reports `occluded` and every focus check reports BODY — which
      // is how a run produced 214 OCCLUDED and 201 FOCUS-LOST flags that were
      // instrument artefacts rather than product defects.
      const dirty = await page.evaluate(
        () => document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[data-tour-overlay]').length,
      );
      if (dirty > 0) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(250);
      }
      const stillDirty = await page.evaluate(
        () => document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[data-tour-overlay]').length,
      );
      if (here !== surface.path || stillDirty > 0) {
        await page.goto(surface.path);
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1400);
      }
      await page.evaluate(() => window.__ob.census());
      const target = page.locator(`[data-ob-cid="${ctrl.cid}"]`).first();
      if ((await target.count()) === 0) {
        ledger.push(JSON.stringify({ ...rec, action: "skip", skipped: "not-found-after-restamp" }));
        continue;
      }

      // hover
      const beforeHover = await fp(page);
      let hoverChanged = false;
      try {
        await target.hover({ timeout: 1500 });
        await page.waitForTimeout(220);
        const afterHover = await fp(page);
        hoverChanged = afterHover.txtHash !== beforeHover.txtHash || afterHover.n.dialog !== beforeHover.n.dialog;
      } catch {
        rec.hoverError = true;
      }

      // activate
      const before = await fp(page);
      const netBefore = netLog.length;
      const errBefore = consoleErrs.length;
      let acted = false;
      try {
        if (ctrl.disabled) {
          rec.action = "disabled-noop";
        } else if (ctrl.tag === "input" || ctrl.tag === "textarea") {
          await target.fill("audit-probe", { timeout: 2000 });
          rec.action = "type";
          acted = true;
        } else {
          await target.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          try {
            await target.click({ timeout: 4000 });
          } catch {
            // Actionability can fail on elements that are genuinely operable —
            // animating panels, or a parent that briefly owns pointer events.
            // Retry forced, and record which path succeeded so a forced click is
            // never silently equated with a clean one.
            await target.click({ timeout: 2500, force: true });
            rec.forced = true;
          }
          rec.action = "click";
          acted = true;
        }
      } catch (e) {
        rec.action = rec.action ?? "click";
        rec.actError = String(e).split("\n")[0]?.slice(0, 90);
      }
      await page.waitForTimeout(500);

      const after = await fp(page);
      const dk = deltaKeys(before, after);
      const changed = dk.length > 0;
      const menuItems = await page.evaluate(() => {
        const m = document.querySelectorAll('[role="menu"],[role="listbox"]');
        if (!m.length) return null;
        return m[m.length - 1]!.querySelectorAll('[role="menuitem"],[role="option"]').length;
      });
      const focusAfter = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        return !a || a === document.body ? "BODY" : (a.getAttribute("aria-label") || a.innerText || a.tagName).trim().slice(0, 40);
      });
      const hit = acted && after.url === before.url ? await page.evaluate((cid) => window.__ob.hit(cid), ctrl.cid) : "n/a";

      // reverse — the inverse of an action depends on its kind. Escape closes an
      // overlay but cannot undo a theme toggle or a navigation, and treating it
      // as universal produced false IRREVERSIBLE flags in the pilot.
      let reversible = "n/a";
      if (acted && changed) {
        try {
          if (after.n.dialog > before.n.dialog || after.n.menu > before.n.menu) {
            await page.keyboard.press("Escape");
          } else if (after.url !== before.url) {
            await page.goBack();
          } else if (ctrl.kind === "toggle" || ctrl.kind === "other") {
            await target.click({ timeout: 2000 });
          } else {
            await page.keyboard.press("Escape");
          }
          await page.waitForTimeout(400);
          const back = await fp(page);
          const residual = deltaKeys(before, back).filter((k) => k !== "scrollY" && !k.startsWith("sel"));
          reversible = residual.length === 0 ? "yes" : "no";
          if (residual.length) rec.residual = residual.slice(0, 5);
        } catch {
          reversible = "no";
        }
      }

      // reload-survive
      let survivesReload = "n/a";
      if (acted && changed) {
        const urlNow = page.url();
        await page.goto(urlNow);
        await page.waitForTimeout(900);
        const afterReload = await fp(page);
        survivesReload = deltaKeys(after, afterReload).length <= 2 ? "yes" : "no";
      }

      const net = netLog.slice(netBefore);
      const cons = consoleErrs.slice(errBefore);
      const flags = flagsFor({ ctrl, changed, net, hit, reversible, focusAfter, alerts: after.alerts, survivesReload, console: cons, menuItems, hoverChanged, navigated: after.url !== before.url, failed: Boolean(rec.actError) });

      let textDiff: unknown = null;
      if (changed && after.txtHash !== before.txtHash) {
        textDiff = await page.evaluate(() => ({ len: window.__ob.snapshotText().length }));
      }

      ledger.push(
        JSON.stringify({
          ...rec,
          changed,
          deltaKeys: dk.slice(0, 8),
          counts: `rfNode ${before.n.rfNode}→${after.n.rfNode} dialog ${before.n.dialog}→${after.n.dialog} menu ${before.n.menu}→${after.n.menu}`,
          urlAfter: after.url !== before.url ? after.url : null,
          menuItems,
          hit,
          reversible,
          survivesReload,
          focusAfter,
          alerts: after.alerts,
          net: net.slice(0, 4),
          console: cons.slice(0, 2),
          hoverChanged,
          textDiff,
          flags,
        }),
      );

      // return to a clean baseline for the next control
      if (after.url !== before.url || after.n.dialog > 0 || survivesReload !== "n/a") {
        await page.goto(surface.path);
        await page.waitForTimeout(800);
      }
    }

    writeOut(surface.name, "ledger.jsonl", ledger.join("\n"));

    // ── FLAGS.md — the only file a judging agent reads by default ─────────
    const rows = ledger.map((l) => JSON.parse(l) as Record<string, unknown>);
    const flagged = rows.filter((r) => Array.isArray(r.flags) && (r.flags as string[]).length > 0);
    const tally: Record<string, number> = {};
    for (const r of flagged) for (const f of r.flags as string[]) tally[f] = (tally[f] ?? 0) + 1;
    const md = [
      `# ${surface.name} — ${TIER}/${VARIANT}/${THEME}`,
      "",
      `- controls censused: **${controls.length}** (census stable across two runs: **${stable ? "yes" : "NO"}**)`,
      `- operated: **${rows.filter((r) => r.action === "click" || r.action === "type").length}**`,
      `- skipped: **${rows.filter((r) => r.action === "skip").length}**`,
      `- disabled: **${rows.filter((r) => r.action === "disabled-noop").length}**`,
      `- tab stops: **${tabSeq.length}**, offscreen: **${tabSeq.filter((t) => t.includes("OFFSCREEN")).length}**`,
      `- foreground tab: **${env.vis} / focus=${env.focus}**`,
      "",
      "## Flag tally",
      "",
      "| Flag | Count |",
      "|---|---|",
      ...Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| \`${k}\` | ${v} |`),
      "",
      "## Flagged controls",
      "",
      "| cid | control | region | flags | detail |",
      "|---|---|---|---|---|",
      ...flagged.map(
        (r) =>
          `| \`${r.cid}\` | ${String(r.name).slice(0, 34) || "*(unlabelled)*"} | ${String(controls.find((c) => c.cid === r.cid)?.region ?? "").slice(0, 22)} | ${(r.flags as string[]).join(" ")} | ${String(r.counts ?? "").slice(0, 40)}${r.urlAfter ? ` → ${r.urlAfter}` : ""} |`,
      ),
    ].join("\n");
    writeOut(surface.name, "FLAGS.md", md);

    expect(stable, `census must be stable across two runs on ${surface.name}`).toBe(true);
  });
}
