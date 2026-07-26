/**
 * Negative case: the SAME `routes/` directory, but a server handler. Without
 * the JSX-extension requirement this became a `ui_route`; it must stay an
 * HTTP route so the two never blur together in a full-stack repo.
 */
export function registerAuthRoutes(): string {
  return 'auth';
}
