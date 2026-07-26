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

  const parts = text.split("/");
  if (parts.length > 2) {
    // Spend the whole budget on trailing segments, from the last one back.
    let kept = [parts[parts.length - 1]!];
    for (let i = parts.length - 2; i >= 0; i--) {
      const next = [parts[i]!, ...kept];
      if (`…/${next.join("/")}`.length > max) break;
      kept = next;
    }
    if (`…/${kept.join("/")}`.length <= max) {
      // The leading segment carries the HTTP method ("POST /api/…"), so keep
      // it when there is room. There usually is not, and it is the cheapest
      // thing to lose: the row and the node both print the trigger underneath.
      if (kept.length < parts.length) {
        const withHead = `${parts[0]}/…/${kept.join("/")}`;
        if (withHead.length <= max) return withHead;
      }
      return `…/${kept.join("/")}`;
    }
  }

  // Character fallback — a single segment longer than the whole budget, or a
  // label with no path structure. Two thirds of the budget goes to the tail.
  const tail = Math.max(1, Math.floor((max - 1) * 0.65));
  const head = Math.max(0, max - 1 - tail);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
