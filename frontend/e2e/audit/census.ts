import type { Page } from "@playwright/test";

/**
 * Page-side audit instrument. Injected via `addInitScript` so it exists before
 * React mounts and survives client-side navigation.
 *
 * Why this exists: the previous manual audits produced ~5% of their findings by
 * actually operating a control — everything else came from reading the database
 * or the source. Screenshotting every click is what made operation expensive, so
 * this replaces the screenshot with a ~220-byte state fingerprint. Operating a
 * control then costs one tool call instead of one image.
 */

export type Control = {
  cid: string;
  role: string;
  name: string;
  tag: string;
  type: string;
  region: string;
  bbox: [number, number, number, number];
  labelSource: "text" | "aria-label" | "title" | "placeholder" | "none";
  tip: { kind: "radix" | "title" | "none"; text: string };
  disabled: boolean;
  tabPos: number | null;
  truncated: boolean;
  /** Drives the correct inverse action. Escape only undoes overlays. */
  kind: "nav-internal" | "nav-external" | "toggle" | "input" | "opener" | "other";
  href: string;
};

export type Fingerprint = {
  url: string;
  h1: string;
  n: Record<string, number>;
  sel: string[];
  rf: string;
  scrollY: number;
  txtHash: string;
  txtLen: number;
  store: Record<string, string>;
  alerts: string[];
  overlays: number;
};

declare global {
  interface Window {
    __ob: {
      census: () => Control[];
      fp: () => Fingerprint;
      hit: (cid: string) => "ok" | "occluded" | "missing";
      find: (cid: string) => Element | null;
      textDiff: (a: string, b: string) => { added: string[]; removed: string[] };
      snapshotText: () => string;
    };
  }
}

/**
 * Selector set is deliberately wider than "buttons". This codebase labels
 * several real controls with a native `title` only (the graph LR/TB and
 * fullscreen toggles among them) and has almost no test ids, so a
 * button/a/input-only census silently omits exactly the controls the previous
 * pass missed.
 */
const SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="radio"]',
  '[tabindex]:not([tabindex="-1"])',
  "[onclick]",
  "[title]",
  '[data-slot="tooltip-trigger"]',
].join(",");

export async function installCensus(page: Page): Promise<void> {
  await page.addInitScript(
    ({ selector }) => {
      const hash = (s: string): string => {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36).padStart(7, "0").slice(0, 7);
      };

      const domPath = (el: Element): string => {
        const parts: string[] = [];
        let cur: Element | null = el;
        while (cur && parts.length < 6) {
          const parent: Element | null = cur.parentElement;
          const idx = parent ? Array.prototype.indexOf.call(parent.children, cur) : 0;
          parts.unshift(cur.tagName.toLowerCase() + "[" + idx + "]");
          cur = parent;
        }
        return parts.join("/");
      };

      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.01;
      };

      const accName = (el: Element): { name: string; src: Control["labelSource"] } => {
        const aria = el.getAttribute("aria-label");
        if (aria && aria.trim()) return { name: aria.trim(), src: "aria-label" };
        const labelledby = el.getAttribute("aria-labelledby");
        if (labelledby) {
          const t = labelledby
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
          if (t) return { name: t, src: "aria-label" };
        }
        const text = (el as HTMLElement).innerText?.trim();
        if (text) return { name: text.replace(/\s+/g, " ").slice(0, 80), src: "text" };
        const title = el.getAttribute("title");
        if (title && title.trim()) return { name: title.trim().slice(0, 80), src: "title" };
        const ph = el.getAttribute("placeholder");
        if (ph && ph.trim()) return { name: ph.trim().slice(0, 80), src: "placeholder" };
        return { name: "", src: "none" };
      };

      const region = (el: Element): string => {
        let cur: Element | null = el;
        while (cur) {
          const h = cur.querySelector?.("h1,h2,h3");
          if (h && h.textContent?.trim()) return h.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
          cur = cur.parentElement;
        }
        return "";
      };

      const tabOrder = (): Element[] =>
        Array.from(document.querySelectorAll<HTMLElement>(selector))
          .filter((e) => visible(e) && e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled)
          .sort((a, b) => {
            const ta = a.tabIndex || 0;
            const tb = b.tabIndex || 0;
            if (ta !== tb) return ta - tb;
            return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
          });

      const censusFn = (): Control[] => {
        const surface = location.pathname;
        const order = tabOrder();
        const seen = new Map<string, number>();
        const els = Array.from(document.querySelectorAll(selector)).filter(visible);
        return els.map((el) => {
          const { name, src } = accName(el);
          const roleAttr = el.getAttribute("role") ?? "";
          const role = roleAttr || el.tagName.toLowerCase();
          const key = surface + "|" + role + "|" + name + "|" + domPath(el);
          const ord = (seen.get(key) ?? 0) + 1;
          seen.set(key, ord);
          const r = el.getBoundingClientRect();
          const radixTip = el.getAttribute("data-slot") === "tooltip-trigger" || el.closest("[data-slot='tooltip-trigger']") !== null;
          const nativeTip = el.getAttribute("title");
          const labelNode = el.querySelector("span,div") ?? el;
          const cid = hash(key + "#" + ord);
          // Stamp the element so the driver can locate it exactly. Guessing an
          // ARIA role from the tag name produced 21 false "dead control" flags
          // in the pilot, because getByRole("a", …) simply throws.
          el.setAttribute("data-ob-cid", cid);
          const href = el.getAttribute("href") ?? "";
          const isSwitch =
            roleAttr === "switch" || roleAttr === "checkbox" || el.hasAttribute("aria-pressed") ||
            (el.getAttribute("type") ?? "") === "checkbox";
          const kind: Control["kind"] = href
            ? /^https?:/.test(href)
              ? "nav-external"
              : "nav-internal"
            : isSwitch
              ? "toggle"
              : el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"
                ? "input"
                : el.getAttribute("aria-haspopup") || roleAttr === "combobox"
                  ? "opener"
                  : "other";
          return {
            cid,
            kind,
            href,
            role,
            name,
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute("type") ?? "",
            region: region(el),
            bbox: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
            labelSource: src,
            tip: radixTip
              ? { kind: "radix" as const, text: "" }
              : nativeTip
                ? { kind: "title" as const, text: nativeTip.slice(0, 80) }
                : { kind: "none" as const, text: "" },
            disabled:
              (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
            tabPos: order.indexOf(el) >= 0 ? order.indexOf(el) : null,
            truncated: labelNode.scrollWidth > labelNode.clientWidth + 1,
          };
        });
      };

      const fpFn = (): Fingerprint => {
        const txt = (document.body.innerText ?? "").replace(/\s+/g, " ").trim();
        const vp = document.querySelector(".react-flow__viewport");
        const m = vp ? getComputedStyle(vp).transform.match(/matrix\(([-\d.]+),[^,]+,[^,]+,[^,]+,\s*([-\d.]+),\s*([-\d.]+)\)/) : null;
        const store: Record<string, string> = {};
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("onboardbuddy:") || k.startsWith("obb.")) store[k] = String(localStorage.getItem(k)).slice(0, 24);
        }
        return {
          url: location.pathname + location.search,
          h1: document.querySelector("h1")?.textContent?.trim().slice(0, 50) ?? "",
          n: {
            btn: document.querySelectorAll("button").length,
            a: document.querySelectorAll("a[href]").length,
            input: document.querySelectorAll("input,textarea,select").length,
            dialog: document.querySelectorAll('[role="dialog"]').length,
            menu: document.querySelectorAll('[role="menu"],[role="listbox"]').length,
            row: document.querySelectorAll("tr,li").length,
            rfNode: document.querySelectorAll(".react-flow__node").length,
            rfEdge: document.querySelectorAll(".react-flow__edge").length,
            // Disclosure state. Accordions here keep their panel in the DOM
            // (grid-rows-[0fr] + overflow-hidden + inert), so innerText does not
            // change when one opens — without these two counters the probe
            // reports every FAQ question as a dead control.
            expanded: document.querySelectorAll('[aria-expanded="true"]').length,
            inert: document.querySelectorAll("[inert]").length,
            checked: document.querySelectorAll('[aria-checked="true"],:checked').length,
          },
          sel: Array.from(document.querySelectorAll('.selected,[aria-selected="true"],[data-state="active"]'))
            .slice(0, 4)
            .map((e) => (e as HTMLElement).innerText?.trim().slice(0, 30) ?? ""),
          rf: m ? `${m[2]},${m[3]},${m[1]}` : "",
          scrollY: Math.round(window.scrollY + (document.querySelector("[class*=overflow-y-auto]")?.scrollTop ?? 0)),
          txtHash: hash(txt),
          txtLen: txt.length,
          store,
          alerts: Array.from(document.querySelectorAll('[role="alert"],[role="status"]'))
            .map((e) => (e as HTMLElement).innerText?.trim().slice(0, 60) ?? "")
            .filter(Boolean),
          overlays: document.querySelectorAll('[data-tour-overlay],[role="dialog"],.fixed.inset-0').length,
        };
      };

      const findFn = (cid: string): Element | null => {
        for (const c of censusFn()) {
          if (c.cid !== cid) continue;
          const [x, y, w, h] = c.bbox;
          return document.elementFromPoint(x + w / 2, y + h / 2);
        }
        return null;
      };

      window.__ob = {
        census: censusFn,
        fp: fpFn,
        /**
         * The empirical occlusion test. `elementFromPoint` at the control's own
         * centre must resolve to the control or a descendant of it. This is what
         * replaces "I read the CSS and concluded z-50 covers the header" —
         * which is how a P1 got filed without ever entering fullscreen.
         */
        hit: (cid: string) => {
          const self = document.querySelector(`[data-ob-cid="${cid}"]`);
          if (!self) return "missing";
          const r = self.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return "occluded";
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (!top) return "occluded";
          return self === top || self.contains(top) || top.contains(self) ? "ok" : "occluded";
        },
        find: findFn,
        snapshotText: () => (document.body.innerText ?? "").replace(/\s+/g, " ").trim(),
        textDiff: (a: string, b: string) => {
          const aw = new Set(a.split(" "));
          const bw = new Set(b.split(" "));
          const added: string[] = [];
          const removed: string[] = [];
          for (const w of bw) if (!aw.has(w) && added.length < 12) added.push(w);
          for (const w of aw) if (!bw.has(w) && removed.length < 12) removed.push(w);
          return { added, removed };
        },
      };
    },
    { selector: SELECTOR },
  );
}
