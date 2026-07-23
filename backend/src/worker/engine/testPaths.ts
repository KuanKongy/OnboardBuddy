/**
 * Shared test/fixture path classification. One definition — the entrypoint
 * detector, ranker and extractors must agree on what "not product code" is.
 */

/** Test files: `test/…`, `__tests__/…`, `*.spec.ts`, `*.test.tsx`, e2e/cypress. */
export const TEST_FILE_RE = /(^|\/)(tests?|__tests__|spec|e2e|cypress)\/|\.(spec|test)\.[cm]?[jt]sx?$/i;

/** Fixture trees: embedded sample apps / test data, never product code. */
export const FIXTURE_FILE_RE = /(^|\/)(fixtures?|__fixtures__|__mocks__|testdata)\//i;

export function isTestOrFixturePath(relativePath: string): boolean {
  return TEST_FILE_RE.test(relativePath) || FIXTURE_FILE_RE.test(relativePath);
}
