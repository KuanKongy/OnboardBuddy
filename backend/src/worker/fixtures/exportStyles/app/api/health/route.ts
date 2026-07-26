/**
 * Negative case for `ui_route`: `app/**\/route.ts` is a Next API handler, not
 * a page. It has no JSX extension, so `isPageFile` rejects it.
 */
export function GET(): string {
  return 'ok';
}
