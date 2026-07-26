import type { Page } from "@playwright/test";
import { P } from "../fixtures";

/**
 * Endpoints `mockApi` does not cover. Their absence is why Dashboard, Account
 * Settings, Help, Import and the Ask/provenance overlays were never walkable in
 * the earlier passes — the base mock's catch-all returns `{}`, so those pages
 * rendered as permanently-empty rather than as themselves.
 *
 * Registered AFTER `mockApi` so these handlers match first (Playwright matches
 * route handlers in reverse registration order); anything not listed here calls
 * `route.fallback()` and lands on the base mock.
 */

export type Variant = "full" | "empty" | "error403" | "error500" | "huge";

const big = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
const pad = (s: string, n = 400) => s + " " + "lorem ipsum dolor sit amet".repeat(Math.ceil(n / 26)).slice(0, n);

function bodies(v: Variant): Array<[RegExp, unknown]> {
  const empty = v === "empty";
  const huge = v === "huge";

  const installations = empty
    ? { installations: [] }
    : {
        installations: [
          { id: 123, account_login: "acme", account_type: "Organization", app_id: 4053634 },
          ...(huge ? big(40, (i) => ({ id: 900 + i, account_login: `org-${i}`, account_type: "Organization", app_id: 4053634 })) : []),
        ],
      };

  const repos = empty
    ? { repositories: [] }
    : {
        repositories: [
          { id: 1, name: "auth-demo", full_name: "acme/auth-demo", default_branch: "main", private: false, language: "TypeScript", description: "Demo auth service" },
          ...(huge ? big(60, (i) => ({ id: 100 + i, name: `repo-${i}`, full_name: `acme/repo-${i}`, default_branch: "main", private: false, language: "TypeScript", description: pad(`Repo ${i}`) })) : []),
        ],
      };

  return [
    // ── account / auth ──────────────────────────────────────────────────────
    [/\/api\/auth\/me/, {
      user: { id: "user-1", email: "dev@acme.dev", user_metadata: { full_name: "Dev Example", avatar_url: null }, created_at: "2026-06-01T00:00:00Z",
        identities: [{ provider: "email" }, { provider: "github", identity_data: { user_name: "devexample" } }] },
      github_app: empty ? { connected: false } : { connected: true, username: "devexample" },
    }],

    // ── dashboard ───────────────────────────────────────────────────────────
    [/\/api\/projects\/activity/, empty ? { activity: [] } : {
      activity: big(huge ? 60 : 4, (i) => ({
        // DashboardPage.tsx:343 reads repo_owner/repo_name separately, as the API
        // returns them (projects.ts:68). Supplying repo_full_name rendered
        // "undefined/undefined" in the activity feed — a mock bug, not a defect.
        id: `act-${i}`, project_id: P, repo_owner: "acme", repo_name: "auth-demo", kind: i % 2 ? "analysis_complete" : "package_generated",
        message: huge ? pad(`Activity ${i}`) : `Analysis completed for auth-demo`, created_at: "2026-07-20T10:00:00Z",
      })),
    }],

    // ── overview: run history ───────────────────────────────────────────────
    // Shape mirrors the mapper at backend/src/api/routes/projects.ts:708 — every
    // field is built with `Number(x ?? 0)` / `?? null` there, so `cost` and
    // `config` are always objects. An earlier version of this mock used a
    // `budget_usage` key instead and produced a TypeError that looked like a
    // product crash; it was the mock.
    [/\/api\/projects\/[^/]+\/runs/, empty ? { runs: [] } : {
      runs: big(huge ? 40 : 3, (i) => ({
        id: `run-${i}`, job_type: "analyze_scope", status: i === 0 ? "complete" : i === 1 ? "failed" : "paused",
        progress_pct: 100, current_step: "Complete", error_message: i === 1 ? "canceling statement due to statement timeout" : null,
        snapshot_id: "snap-1", section_type: null,
        config: { branch: "main", commit: "abc1234def", scope_path: "", scope_name: "Whole repository", depth: "standard", role: "general" },
        requested_by_email: "owner@acme.dev",
        created_at: "2026-07-20T10:00:00Z", started_at: "2026-07-20T10:00:00Z", finished_at: "2026-07-20T10:20:00Z",
        duration_ms: 1_200_000, attempt: 1, step_log: [],
        package: { id: "pkg-1", role: "backend", branch: "main", status: "draft" },
        cost: { estimated_cost_usd: 0.0214, llm_calls: 63, cached_calls: 18, input_tokens: 91_240, output_tokens: 12_400 },
        sections: { generated_sections: [], cached_sections: [] },
      })),
    }],

    // ── reader: progress, provenance, ask ───────────────────────────────────
    [/\/api\/projects\/[^/]+\/progress/, { progress: empty ? [] : [{ section_id: "sec-1", status: "read", updated_at: "2026-07-20T10:00:00Z" }] }],
    [/\/api\/projects\/[^/]+\/onboarding\/provenance/, empty ? { provenance: null } : {
      provenance: {
        snapshotId: "snap-1", commitHash: "abc1234def", generatedAt: "2026-07-08T10:00:00Z",
        model: "google/gemini-2.5-flash-lite", llmCalls: 528, estimatedCostUsd: 0.9985,
        rankedBySignals: 9, knownUnknowns: 3,
        sections: big(12, (i) => ({ type: `section-${i}`, confidence: i % 3 === 0 ? "low" : "medium", receipts: i * 2 })),
      },
    }],
    [/\/api\/projects\/[^/]+\/ask/, empty
      ? { answer: "", verdict: "not_answerable", confidence: "low", receipts: [] }
      : {
          answer: "The login route delegates to AuthService.login, which signs a JWT and writes a session row.",
          verdict: "answerable", confidence: "medium",
          // 14 resolvable + 26 bare references reproduces the blank-chip case
          receipts: [
            ...big(14, (i) => ({ index: i + 1, file_path: `services/authService.ts`, line_start: 10 + i, line_end: 20 + i, snippet: "return signToken(user)" })),
            ...big(26, (i) => ({ index: 15 + i, file_path: null, line_start: null, line_end: null, snippet: null })),
          ],
        }],

    // ── team ────────────────────────────────────────────────────────────────
    [/\/api\/projects\/[^/]+\/members\/invitations/, empty ? { invitations: [] } : {
      invitations: big(huge ? 25 : 2, (i) => ({
        id: `inv-${i}`, email: `teammate${i}@acme.dev`, permission_tier: i ? "developer" : "admin",
        developer_role: "backend", status: "pending", invited_by_email: "owner@acme.dev", created_at: "2026-07-20T10:00:00Z",
      })),
    }],

    // ── settings write + preflight ──────────────────────────────────────────
    [/\/api\/projects\/[^/]+\/settings/, { ok: true }],
    [/\/api\/projects\/[^/]+\/preflight/, empty ? { preview: null } : {
      preview: {
        fileCount: 8, locCount: 1240, symbolEstimate: 42,
        languageInventory: { supported: { typescript: 8 }, unsupported: { css: 2, python: 49 }, supportedFileCount: 8, unsupportedFileCount: 51 },
        estimatedLlmCalls: 63, estimatedCostUsd: 0.0214, ignoredPaths: ["node_modules/", "dist/"],
      },
    }],

    // ── github (import wizard) ──────────────────────────────────────────────
    [/\/api\/github\/app/, { app: { name: "OnboardBuddy", slug: "onboardbuddy", html_url: "https://github.com/apps/onboardbuddy" } }],
    [/\/api\/github\/installations/, installations],
    [/\/api\/github\/repos\/[^/]+\/[^/]+\/branches/, { branches: [{ name: "main", commit: { sha: "abc1234def" } }, { name: "dev", commit: { sha: "def5678abc" } }] }],
    [/\/api\/github\/repos\/[^/]+\/[^/]+\/commits/, { commits: big(5, (i) => ({ sha: `c${i}0000000`, message: `commit ${i}`, author: "dev", date: "2026-07-20T10:00:00Z" })) }],
    [/\/api\/github\/repos/, repos],
  ];
}

export async function mockExtras(page: Page, variant: Variant = "full"): Promise<void> {
  const table = bodies(variant);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    for (const [re, body] of table) {
      if (!re.test(url)) continue;
      if (variant === "error403") {
        await route.fulfill({ status: 403, json: { error: "Insufficient permissions" } });
        return;
      }
      if (variant === "error500") {
        await route.fulfill({ status: 500, json: { error: "Internal server error" } });
        return;
      }
      await route.fulfill({ json: body as object });
      return;
    }
    await route.fallback();
  });
}
