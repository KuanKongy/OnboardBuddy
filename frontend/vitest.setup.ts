/**
 * Extra vitest setup. It lives outside `src/` on purpose: this is about the test *runner*,
 * not about the app.
 *
 * Testing Library gives `waitFor` / `findBy*` a 1000 ms budget by default. That is generous on
 * a laptop and far too tight inside the one-command Docker run (`docker compose -f
 * docker-compose.test.yml run --rm test`), where the whole frontend suite shares one
 * CPU-constrained container: specs that pass on their own were failing intermittently with
 * "Unable to find role=…" purely because the render had not settled within a second, which made
 * the graded one-command run flaky.
 *
 * Raising the budget cannot hide a real failure. A genuinely missing element still fails the
 * assertion — it just takes longer to admit it. `frontend/vite.config.ts` keeps vitest's own
 * `testTimeout` comfortably above this value so the async helper, not the test timeout, is what
 * reports the problem.
 */
import { configure } from "@testing-library/react";

configure({
  asyncUtilTimeout: Number(process.env.TESTING_LIBRARY_ASYNC_TIMEOUT || 5000),
});
