import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api";
import type { ProjectData } from "@/contexts/ProjectContext";
import { AnalyzeDialog } from "./AnalyzeDialog";

/**
 * When the analyze route rejects with a recognised credit code, the dialog must
 * turn it into a friendly, specific box rather than a raw message. This pins the
 * monthly-credit case end to end: the real ApiError class flows through (the
 * dialog branches on `instanceof` and on body.code), and the box names the
 * reset date and links to /pricing.
 */

// Partial mock: keep the REAL ApiError so the dialog's instanceof check holds.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApi = vi.mocked(apiFetch);

const MONTH_RESET_AT = new Date("2026-10-01T00:00:00.000Z").toISOString();

const PROJECT = {
  id: "proj-1",
  repo_owner: "acme",
  repo_name: "rocket",
  repo_description: null,
  branch: "main",
  default_branch: "main",
  github_installation_id: "42",
  status: "idle",
  created_at: "2026-01-01T00:00:00.000Z",
  last_analyzed_at: null,
  permission_tier: "admin",
  developer_role: "general",
  default_package_id: null,
  settings: {
    ignored_paths: [],
    privacy_mode: "full_ai",
    analysis_depth: "standard",
    default_developer_role: "general",
    file_limit: 1000,
    loc_limit: 100000,
  },
} satisfies ProjectData;

/**
 * What POST /analyze rejects with for the case under test. Each test sets this
 * before rendering; the default is the monthly-credit case.
 */
let analyzeRejection: ApiError;

beforeEach(() => {
  analyzeRejection = new ApiError("Monthly analysis credits exhausted", 429, {
    code: "monthly_exhausted",
    monthResetAt: MONTH_RESET_AT,
  });
  mockApi.mockReset();
  mockApi.mockImplementation(async (path: string) => {
    // The one call under test: the run is refused.
    if (path.includes("/analyze")) {
      throw analyzeRejection;
    }
    // Everything the dialog and its form load on open, answered quietly with the
    // GET /me/credit contract the CreditMeter reads.
    if (path === "/me/credit") {
      return {
        tier: "free",
        monthlyCredits: 5,
        monthlyUsed: 5,
        monthlyRemaining: 0,
        monthResetAt: MONTH_RESET_AT,
        rateCredits: 1,
        rateWindowHours: 120,
        rateUsed: 1,
        rateResetAt: null,
        inFlight: 0,
        allowed: false,
        reason: "monthly_exhausted",
      };
    }
    if (path.includes("/branches") || path.includes("/commits")) return {};
    if (path.endsWith("/scopes")) return { scopes: [] };
    return {};
  });
});

function renderAndStart() {
  render(
    <MemoryRouter>
      <AnalyzeDialog project={PROJECT} open onOpenChange={() => {}} onStarted={() => {}} />
    </MemoryRouter>,
  );
  return screen.findByRole("button", { name: /start analysis/i });
}

describe("AnalyzeDialog — credit rejections", () => {
  it("shows a friendly monthly-credit box, with a /pricing link, on monthly_exhausted", async () => {
    fireEvent.click(await renderAndStart());

    expect(await screen.findByText(/used all of this month's analysis credits/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/pricing");
  });

  /**
   * The abuse detector's 403 is the one rejection a falsely-flagged user has to
   * be able to act on, so the box must route them to a human rather than read
   * as a dead end. An unrecognised code would fall through to the raw-error
   * path, which says nothing about what to do next.
   */
  it("offers a contact route, not a dead end, on abuse_detected", async () => {
    analyzeRejection = new ApiError("Free usage on this device is paused", 403, {
      code: "abuse_detected",
    });

    fireEvent.click(await renderAndStart());

    expect(await screen.findByText(/free usage on this device is paused/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /contact us for review/i })).toHaveAttribute("href", "/contact");
  });

  it("tells a stale tab to reload on client_required", async () => {
    analyzeRejection = new ApiError("Please use the OnboardBuddy app", 403, {
      code: "client_required",
    });

    fireEvent.click(await renderAndStart());

    expect(await screen.findByText(/reload the page/i)).toBeInTheDocument();
  });
});
