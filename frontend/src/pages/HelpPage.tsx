import { ExternalLink, HelpCircle, Route, Shield, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FAQ_ITEMS, FaqSection } from "@/components/FaqContent";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { activityTime } from "@/pages/DashboardPage";
import { PRIVACY_MODES } from "@/lib/privacyModes";
import { scrollBehavior } from "@/lib/motion";
import { requestTour, type TourName } from "@/lib/tourState";
import { useProjects } from "@/lib/useProjects";

interface TourRow {
  name: TourName;
  title: string;
  description: string;
  hint?: string;
  /** The dashboard and import tours need no project; the other three do. */
  projectScoped: boolean;
  path: (projectId: string) => string;
}

const TOUR_ROWS: TourRow[] = [
  {
    name: "dashboard",
    title: "Dashboard tour",
    description: "Where to find your projects, stats, and how to import a new repo.",
    projectScoped: false,
    path: () => "/dashboard",
  },
  {
    name: "project",
    title: "Project tour",
    description: "What each project tab does: overview, onboarding, architecture, dependencies, workflows.",
    projectScoped: true,
    path: (id) => `/projects/${id}`,
  },
  {
    name: "import",
    title: "Import tour",
    description: "Configuring the first analysis: branch, commit, scope, and the cost preview.",
    hint: "Starts on step 2, once a repository has been imported.",
    projectScoped: false,
    path: () => "/import",
  },
  {
    name: "onboardingLifecycle",
    title: "Package lifecycle tour",
    description: "How packages, regeneration, and stale badges work.",
    projectScoped: true,
    path: (id) => `/projects/${id}/onboarding`,
  },
  {
    name: "onboardingReader",
    title: "Reader tour",
    description: "How to read a generated package: sections, receipts, and review status.",
    hint: "Starts when you open a generated package's reader.",
    projectScoped: true,
    path: (id) => `/projects/${id}/onboarding`,
  },
];

function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
}

/**
 * The signed-in Help tab: tours plus the shared FAQ answers. A signed-out
 * visitor never reaches this component (`HelpRoute` in App.tsx sends them to
 * /faq), which is what lets it fetch `/projects` unconditionally: with no
 * session that request is a guaranteed 401 whose only effect is a red line in
 * a visitor's console.
 */
export function HelpPage() {
  const { projects } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => activityTime(b) - activityTime(a)),
    [projects],
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  useEffect(() => {
    if (!selectedProjectId && sortedProjects.length > 0) setSelectedProjectId(sortedProjects[0]!.id);
  }, [sortedProjects, selectedProjectId]);

  // Deep link support: /help#faq, /help#privacy, /help#tours.
  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if (hash) scrollToAnchor(hash);
  }, [location.hash]);

  function startTour(row: TourRow) {
    if (row.projectScoped && !selectedProjectId) return;
    requestTour(row.name);
    navigate(row.projectScoped ? row.path(selectedProjectId) : row.path(""));
  }

  return (
    <>
      {/* The header spans the full main width like every other tab,
          left-aligned, while only the cards column below is centered. */}
      <PageHeader
        title="Help & FAQ"
        subtitle="Tours, frequently asked questions, and what OnboardBuddy sends to the AI."
      />

      <div className="mx-auto max-w-3xl space-y-4">
        <Card id="tours">
          <CardContent className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Route className="h-4 w-4 text-primary" /> Tours
            </h2>
            <p className="mb-3 text-[0.78125rem] text-muted-foreground">
              Re-run any guided tour any time; starting one doesn't affect whether it auto-starts
              again on its own.
            </p>

            {sortedProjects.length === 0 && (
              <p className="mb-3 text-[0.71875rem] text-muted-foreground/80">
                Project-scoped tours need a project to open, so import one first.
              </p>
            )}
            {sortedProjects.length > 0 && (
              <div className="mb-3">
                <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                  <SelectTrigger className="h-8 w-full text-[0.8125rem] sm:w-72" aria-label="Project for project-scoped tours">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedProjects.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-[0.8125rem]">
                        {p.repo_owner}/{p.repo_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              {TOUR_ROWS.map((row) => {
                const disabled = row.projectScoped && sortedProjects.length === 0;
                return (
                  <div key={row.name} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] font-medium text-foreground">{row.title}</p>
                      <p className="text-[0.71875rem] text-muted-foreground">{row.description}</p>
                      {row.hint && <p className="mt-0.5 text-[0.65625rem] text-muted-foreground">{row.hint}</p>}
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      disabled={disabled}
                      title={disabled ? "Import a project first" : undefined}
                      onClick={() => startTour(row)}
                    >
                      <HelpCircle className="mr-1 h-3 w-3" />
                      Start
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card id="faq">
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Frequently asked questions</h2>
            <FaqSection items={FAQ_ITEMS} />
          </CardContent>
        </Card>

        <Card id="privacy">
          <CardContent className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Shield className="h-4 w-4 text-primary" /> Privacy &amp; AI transparency
            </h2>
            <p className="mb-3 text-[0.78125rem] text-muted-foreground">
              Exactly what leaves the system, by privacy mode. Each project picks its own mode in
              Project Settings.
            </p>

            <div className="mb-3 overflow-hidden rounded-md border border-border">
              <table className="w-full text-left text-[0.75rem]">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-[0.6875rem] uppercase text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">Mode</th>
                    <th className="px-3 py-1.5 font-medium">What leaves the system</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-1.5 font-medium text-foreground">{PRIVACY_MODES[0]!.label}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">Extracted facts + code snippets</td>
                  </tr>
                  <tr className="border-b border-border/60">
                    <td className="px-3 py-1.5 font-medium text-foreground">{PRIVACY_MODES[1]!.label}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">Facts and structure only, no code</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 font-medium text-foreground">{PRIVACY_MODES[2]!.label}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">Nothing: zero LLM calls, deterministic outputs only</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mb-3 text-[0.78125rem] leading-relaxed text-muted-foreground">
              <Sparkles className="mr-1 inline h-3 w-3 text-primary" />
              AI calls go through OpenRouter; models are configurable per project. Embeddings use an
              OpenAI-compatible endpoint. Provider data handling is governed by{" "}
              <a href="https://openrouter.ai/docs/features/privacy-and-logging" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                OpenRouter's policy <ExternalLink className="inline h-2.5 w-2.5" />
              </a>
              . With a project-level API key, calls run under your own account instead of the shared one.
            </p>

            <p className="mb-1 text-[0.78125rem] font-medium text-foreground">How to limit exposure</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[0.78125rem] text-muted-foreground">
              <li>
                Switch to Facts-only or AI-disabled privacy mode
                {selectedProjectId && (
                  <>
                    {": "}
                    <Link to={`/projects/${selectedProjectId}/settings`} className="text-primary hover:underline">
                      open Project Settings
                    </Link>
                  </>
                )}
                .
              </li>
              <li>Exclude paths from analysis with <code className="rounded bg-muted px-1 py-0.5 text-[0.6875rem]">ignored_paths</code> in Project Settings.</li>
              <li>Bring your own OpenRouter API key so calls run under your account, not the shared one.</li>
            </ul>
            <Link
              to="/privacy"
              className="mt-3 inline-flex items-center gap-1 text-[0.78125rem] font-medium text-primary hover:underline"
            >
              Full privacy policy
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
