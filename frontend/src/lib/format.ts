/** Compact relative time, e.g. "3h ago". Returns "—" for null/invalid input. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const sec = Math.floor((Date.now() - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/**
 * Shorten a label from the MIDDLE, so the END of it survives.
 *
 * A right-hand ellipsis is the wrong tool for route- and path-shaped labels.
 * Five sibling flows called `GET /api/projects/:id/onboarding-package`,
 * `…/onboarding-package/sections` and `…/onboarding/packages` all clip to the
 * byte-identical string "GET /api/projects/:id/onboar…", and a canvas of five
 * nodes carrying the same words is worse than a canvas with no labels at all:
 * it looks like a rendering bug and gives a reader nothing to click towards.
 * What distinguishes paths is their tail, so the tail is what is kept.
 *
 * Whole segments are dropped rather than characters, because "GET /…/:id/
 * onboarding-package" reads as a route and "GET /api/proje…g-package" does not.
 * Non-path labels fall back to a character rule with the same bias.
 */
export function middleTruncate(label: string, max: number): string {
  const text = label.trim();
  if (max <= 1 || text.length <= max) return text;

  const first = text.indexOf("/");
  if (first > 0 && text.lastIndexOf("/") > first) {
    const parts = text.split("/");
    const head = parts[0]!;
    // Grow the tail one segment at a time while it still fits; always keep at
    // least one, even when that one segment alone overruns the budget.
    let kept: string[] = [];
    for (let i = parts.length - 1; i >= 1; i--) {
      const next = [parts[i]!, ...kept];
      const candidate = `${head}/…/${next.join("/")}`;
      if (kept.length > 0 && candidate.length > max) break;
      kept = next;
      if (candidate.length >= max) break;
    }
    const out = `${head}/…/${kept.join("/")}`;
    if (out.length <= max) return out;
  }

  // Character fallback: two thirds of the budget goes to the tail.
  const tail = Math.max(1, Math.floor((max - 1) * 0.65));
  const head = Math.max(0, max - 1 - tail);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
