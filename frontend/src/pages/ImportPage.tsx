import {
  ExternalLink,
  GitBranch,
  Loader2,
  Rocket,
  Search,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AnalyzeConfigForm,
  DEFAULT_ANALYZE_CONFIG,
  analyzeRequestBody,
  type AnalyzeConfig,
} from "@/components/AnalyzeConfigForm";
import { AppTour, type TourStep } from "@/components/AppTour";
import { BackLink } from "@/components/BackLink";
import { PageHeader } from "@/components/PageHeader";
import { PreflightPreviewCard, usePreflight } from "@/components/PreflightPreview";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, apiFetch } from "@/lib/api";
import { consumeTourRequest, dismissTour, tourDismissed } from "@/lib/tourState";
import { FALLBACK_ROLE, ROLE_OPTIONS } from "@/lib/roles";
import { useProjects } from "@/lib/useProjects";

interface Installation {
  id: number;
  account: { login: string };
}

interface Repo {
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
}

interface Branch {
  name: string;
}

/**
 * Everything step 2 needs to configure the first run. Held as one object
 * (rather than reading step 1's picker state) so a step 2 restored from the URL
 * after a refresh does not have to fake its way back through the pickers —
 * setting `selectedInstallation` alone would trip the repos effect and blank the
 * branch it just restored (#74/F5).
 */
interface ConfigureContext {
  projectId: string;
  repo: Repo;
  installationId: string;
  branch: string;
}

/**
 * Above this many options the picker gets a type-to-filter box. Below it the
 * list already fits on screen and a search field is just chrome.
 */
const TYPEAHEAD_MIN_OPTIONS = 8;

/** Case-insensitive substring match — the same rule the graph search uses. */
function matchesFilter(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}

/** First-visit walkthrough of the configure step (wizard step 2). */
const IMPORT_TOUR_STEPS: TourStep[] = [
  {
    target: "import-config-form",
    title: "Configure the first analysis",
    body: "Nothing runs yet. Pick the branch and commit to analyze (no SHA hunting — recent commits are listed), narrow the scope to a directory like backend/, and choose depth and the first package's role.",
  },
  {
    target: "import-preview",
    title: "Preview before you spend",
    body: "The preview scans the repo and shows file counts, estimated AI calls, cost tier, and exactly what would be sent to the AI provider — before any tokens are used.",
  },
  {
    target: "import-start",
    title: "Start when you're ready",
    body: "Analysis only starts when you click this. You can also skip and run it later from the project's Analyze button.",
  },
];

export function ImportPage() {
  const navigate = useNavigate();
  const { connectGithub, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Wizard: step 1 imports the repo (creates the project, nothing analyzed);
  // step 2 configures and explicitly starts the first analysis.
  const [configure, setConfigure] = useState<ConfigureContext | null>(null);
  const createdProjectId = configure?.projectId ?? null;
  const [restoring, setRestoring] = useState(() => searchParams.has("project"));
  const [analyzeConfig, setAnalyzeConfig] = useState<AnalyzeConfig>(DEFAULT_ANALYZE_CONFIG);
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const { preview, previewing, error: previewError, run: runPreflight, reset: resetPreflight } = usePreflight(createdProjectId ?? "");
  /**
   * Bug #67(1): the oversized-repo acknowledgment.
   *
   * `PreflightPreviewCard` renders a CONTROLLED checkbox — with no `acknowledged`
   * / `onAcknowledgedChange` passed, `checked` was pinned to false and the
   * onChange handler was `undefined`, so the box could not be ticked at all.
   * Start analysis was gated only on `startingAnalysis`, so the warning was
   * silently bypassed on the one flow where oversized-repo costs matter most:
   * a new user's very first run. AnalyzeDialog does this correctly and is the
   * reference; this now matches it.
   */
  const [confirmed, setConfirmed] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const [installUrl, setInstallUrl] = useState("");
  const [appName, setAppName] = useState("GitHub App");
  const [refreshKey, setRefreshKey] = useState(0);
  const [githubAppConnected, setGithubAppConnected] = useState(false);
  const [githubAppUsername, setGithubAppUsername] = useState<string | null>(null);

  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationsLoading, setInstallationsLoading] = useState(true);
  const [selectedInstallation, setSelectedInstallation] = useState<string>("");

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>("");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");

  const [strandedProjectId, setStrandedProjectId] = useState<string | null>(null);
  /** Set from a 409's `project_id`: the repo is already imported, over there. */
  const [existingProjectId, setExistingProjectId] = useState<string | null>(null);
  const [developerRole, setDeveloperRole] = useState<string>(FALLBACK_ROLE);

  /**
   * #74/F4: the picker offered repositories the user had already imported, and
   * the only feedback was a bare 409 after the click. Owner rows only — the
   * backend's UNIQUE (user_id, repo_owner, repo_name) is per owner, so a repo
   * you can see through *someone else's* project is still yours to import and
   * must stay selectable.
   */
  const { projects: ownProjects } = useProjects();
  const importedRepoKeys = new Set(
    ownProjects
      .filter((p) => p.permission_tier === "owner")
      .map((p) => `${p.repo_owner}/${p.repo_name}`.toLowerCase()),
  );

  /**
   * Bug #67(2), the client half. Pagination (lib/github.ts) makes every repo
   * and branch REACH the picker; a 250-item dropdown then makes them
   * unfindable a second way. These filter the options as you type.
   *
   * Shown only above `TYPEAHEAD_MIN_OPTIONS`, so the common case — a personal
   * account with four repositories — is not given a search box for a list that
   * fits on screen.
   */
  const [repoFilter, setRepoFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [ignoreInput, setIgnoreInput] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);

  /**
   * #74/F5: step 2 lived only in React state, so a refresh (or landing on the
   * URL again) dropped the user back to the picker with the project already
   * created — the exact situation that produced the bare 409 above. The created
   * id now lives in the URL and the repo context is rebuilt from the project
   * row, which is the only place it survives a reload.
   *
   * `handledProjectId` keeps this to one fetch per id: the create path claims
   * the id before it writes the param, so writing the URL cannot re-enter here
   * and reset an `analyzeConfig` the user has already started editing.
   */
  const restoreProjectId = searchParams.get("project");
  const handledProjectId = useRef<string | null>(null);
  useEffect(() => {
    if (!restoreProjectId || handledProjectId.current === restoreProjectId) return;
    handledProjectId.current = restoreProjectId;
    let cancelled = false;
    apiFetch(`/projects/${restoreProjectId}`)
      .then(({ project }: { project: {
        id: string; repo_owner: string; repo_name: string; branch: string;
        github_installation_id: number | string | null;
      } }) => {
        if (cancelled) return;
        setConfigure({
          projectId: project.id,
          repo: {
            full_name: `${project.repo_owner}/${project.repo_name}`,
            owner: project.repo_owner,
            name: project.repo_name,
            default_branch: project.branch,
          },
          installationId: String(project.github_installation_id ?? ""),
          branch: project.branch,
        });
        setAnalyzeConfig({ ...DEFAULT_ANALYZE_CONFIG, branch: project.branch });
      })
      .catch(() => {
        // A stale or foreign id is not an error worth blocking on: fall back to
        // step 1 rather than stranding the page on a project we can't read.
        if (cancelled) return;
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete("project");
          return next;
        }, { replace: true });
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restoreProjectId, setSearchParams]);

  useEffect(() => {
    setInstallationsLoading(true);
    setError("");
    Promise.all([
      apiFetch("/github/app").catch(() => null),
      apiFetch("/github/installations"),
    ])
      .then(([appInfo, instData]: [
        { name: string; install_url: string } | null,
        { github_connected?: boolean; installations: Installation[] },
      ]) => {
        if (appInfo) {
          setAppName(appInfo.name);
          setInstallUrl(appInfo.install_url);
        }
        setGithubAppConnected(Boolean(instData.github_connected));
        setGithubAppUsername((instData as { github_username?: string }).github_username ?? null);
        setInstallations(instData.installations);
      })
      .catch((err) => {
        setGithubAppConnected(false);
        setInstallations([]);
        setSelectedInstallation("");
        setRepos([]);
        setSelectedRepo("");
        setBranches([]);
        setSelectedBranch("");
        setError(err.message);
      })
      .finally(() => setInstallationsLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedInstallation) return;
    setReposLoading(true);
    setSelectedRepo("");
    setSelectedBranch("");
    // A filter from the previous account would hide the new one's repos.
    setRepoFilter("");
    setBranchFilter("");
    apiFetch(`/github/repos?installation_id=${selectedInstallation}`)
      .then((data: { repos: Repo[] }) => setRepos(data.repos))
      .catch((err) => {
        setRepos([]);
        setSelectedRepo("");
        setBranches([]);
        setSelectedBranch("");
        setError(err.message);
      })
      .finally(() => setReposLoading(false));
  }, [selectedInstallation]);

  useEffect(() => {
    const repo = repos.find((r) => r.full_name === selectedRepo);
    if (!repo || !selectedInstallation) return;
    setBranchesLoading(true);
    setSelectedBranch("");
    setBranchFilter("");
    apiFetch(
      `/github/repos/${repo.owner}/${repo.name}/branches?installation_id=${selectedInstallation}`,
    )
      .then((data: { branches: Branch[] }) => {
        setBranches(data.branches);
        const defaultBranch = data.branches.find((b) => b.name === repo.default_branch);
        if (defaultBranch) setSelectedBranch(defaultBranch.name);
      })
      .catch((err) => {
        setBranches([]);
        setSelectedBranch("");
        setError(err.message);
      })
      .finally(() => setBranchesLoading(false));
  }, [selectedRepo, selectedInstallation, repos]);

  function addIgnoredPath() {
    const path = ignoreInput.trim();
    if (path && !ignoredPaths.includes(path)) {
      setIgnoredPaths((prev) => [...prev, path]);
    }
    setIgnoreInput("");
  }

  async function handleAuthorizeGitHubApp() {
    setError("");
    try {
      if (githubAppConnected && installUrl) {
        window.location.href = installUrl;
        return;
      }

      sessionStorage.setItem("onboardbuddy.github.after_oauth", "install");
      await connectGithub(true);
    } catch (err: unknown) {
      sessionStorage.removeItem("onboardbuddy.github.after_oauth");
      setError(err instanceof Error ? err.message : "Failed to connect GitHub App");
    }
  }

  const repo = repos.find((r) => r.full_name === selectedRepo);
  const canCreate = selectedInstallation && selectedRepo && selectedBranch;

  // The selected option always stays in its own list: filtering it out would
  // leave the trigger showing a value the dropdown claims does not exist.
  const visibleRepos = repos.filter(
    (r) => r.full_name === selectedRepo || matchesFilter(r.full_name, repoFilter),
  );
  const visibleBranches = branches.filter(
    (b) => b.name === selectedBranch || matchesFilter(b.name, branchFilter),
  );

  async function handleCreate() {
    if (!repo) return;
    setCreating(true);
    setError("");
    setStrandedProjectId(null);
    setExistingProjectId(null);
    let createdProject: { id: string } | undefined;
    try {
      const { project } = await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({
          repo_owner: repo.owner,
          repo_name: repo.name,
          branch: selectedBranch,
          github_installation_id: selectedInstallation,
          default_developer_role: developerRole,
        }),
      }) as { project: { id: string } };
      createdProject = project;

      // Persist privacy choices. Only send ignored_paths when the user added
      // some, so we don't overwrite the backend's sensible default ignore list.
      const settings: { privacy_mode: string; ignored_paths?: string[] } = {
        privacy_mode: "full_ai",
      };
      if (ignoredPaths.length > 0) settings.ignored_paths = ignoredPaths;
      await apiFetch(`/projects/${project.id}/settings`, {
        method: "PUT",
        body: JSON.stringify(settings),
      });

      // Import ≠ analyze: move to the configuration step, where the first
      // run is configured (branch/commit/scope/depth/role), optionally
      // previewed, and only starts on an explicit click.
      handledProjectId.current = project.id;
      setConfigure({
        projectId: project.id,
        repo,
        installationId: selectedInstallation,
        branch: selectedBranch,
      });
      setAnalyzeConfig({ ...DEFAULT_ANALYZE_CONFIG, branch: selectedBranch });
      // `replace`: the project exists now, so the picker is no longer a state
      // worth going back to — Back there would only invite a duplicate import.
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("project", project.id);
        return next;
      }, { replace: true });
      // Same rule as the other four tours: dismissal is per account, and the
      // Help page's picker can request this one explicitly.
      if (consumeTourRequest("import")) setTourOpen(true);
      else if (user && !tourDismissed("import", user.id)) setTourOpen(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      // The project row can exist even though settings failed to save right
      // after — point the user at it instead of stranding them with only an
      // error message and no way back to what was already created.
      if (createdProject) setStrandedProjectId(createdProject.id);
      // #74/F4: "Project already exists for this repo" with nowhere to go was
      // the whole complaint. The 409 now carries the existing project's id
      // (null only if the lookup behind it failed), so say where it went.
      if (err instanceof ApiError && err.status === 409 && typeof err.body?.project_id === "string") {
        setExistingProjectId(err.body.project_id);
      }
    } finally {
      setCreating(false);
    }
  }

  function dismissImportTour() {
    setTourOpen(false);
    if (user) dismissTour("import", user.id);
  }

  /** Invalidate the preview AND the acknowledgment it belonged to. */
  function setAnalyzeConfigChanged() {
    resetPreflight();
    setConfirmed(false);
  }

  /**
   * Bug #67(1): the gate itself, matching AnalyzeDialog. Only bites once a
   * preview exists and says confirmations are required — the preview is what
   * computes the thresholds, so there is nothing to acknowledge before one.
   */
  const needsAcknowledgment = preview !== null && preview.confirmationsRequired.length > 0;
  const startBlocked = startingAnalysis || (needsAcknowledgment && !confirmed);

  async function handleStartAnalysis() {
    if (!createdProjectId) return;
    // Defence in depth: the button is disabled, but a keyboard/programmatic
    // activation must not be able to slip past a gate about spending money.
    if (needsAcknowledgment && !confirmed) return;
    setStartingAnalysis(true);
    setError("");
    try {
      await apiFetch(`/projects/${createdProjectId}/analyze`, {
        method: "POST",
        body: JSON.stringify(analyzeRequestBody(analyzeConfig)),
      });
      navigate(`/projects/${createdProjectId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start analysis");
      setStartingAnalysis(false);
    }
  }

  // Restoring step 2 from ?project=: showing the picker first and swapping it
  // out mid-read would be its own bug (a click could land on the wrong step).
  if (restoring) {
    return (
      <>
        <PageHeader title="Configure the first analysis" subtitle="Step 2 of 2" actions={<BackLink />} />
        <div className="mx-auto flex max-w-lg items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Reopening the repository you imported…
        </div>
      </>
    );
  }

  // ── Step 2: configure + explicitly start the first analysis ───────────────
  if (configure) {
    const { repo: configuredRepo, installationId: configuredInstallationId } = configure;
    return (
      <>
        <PageHeader
          title="Configure the first analysis"
          subtitle={`Step 2 of 2 — ${configuredRepo.full_name} is imported; nothing runs until you press Start.`}
          actions={<BackLink />}
        />
        <div className="mx-auto max-w-lg">
          <Card>
            <CardContent className="space-y-3 p-4">
              {(error || previewError) && (
                <ErrorBanner>{error || previewError}</ErrorBanner>
              )}

              <div data-tour="import-config-form">
                <AnalyzeConfigForm
                  projectId={configure.projectId}
                  repoOwner={configuredRepo.owner}
                  repoName={configuredRepo.name}
                  installationId={configuredInstallationId}
                  defaultBranch={configure.branch}
                  config={analyzeConfig}
                  onChange={(c) => {
                    setAnalyzeConfig(c);
                    // The preview describes ONE exact configuration, so the
                    // acknowledgment does too. Carrying a tick from a cheap
                    // `backend/` scope over to a whole-repo full-depth run
                    // would be the same bypass by another route.
                    setAnalyzeConfigChanged();
                  }}
                />
              </div>

              {previewing && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                  Building the analysis preview — scanning files and estimating cost…
                </div>
              )}
              {/*
                * Always-visible scope notice. The preflight card below states the
                * real per-repository numbers, but it only appears after the user
                * presses "Preview first" — and the person most likely to skip it is
                * exactly the one who needs to know we parse two languages. Stating
                * the limit before analysis starts is the honest default.
                */}
              {!preview && (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">What gets analysed</p>
                  <p className="mt-1 leading-relaxed">
                    TypeScript and JavaScript are parsed all the way down — symbols, call graph,
                    entry points, side effects. Everything else in the repository (other languages,
                    docs, config, SQL, scripts) is read and cited as evidence, but is not parsed into
                    a call graph, so a repository whose core logic is in another language produces a
                    thinner handbook and says so.
                  </p>
                  <p className="mt-1.5 leading-relaxed">
                    <span className="font-medium text-foreground">Preview first</span> reports this
                    repository&rsquo;s actual numbers — how many files we cannot parse, and the
                    estimated cost — before anything runs.
                  </p>
                </div>
              )}
              {preview && (
                <PreflightPreviewCard
                  preview={preview}
                  acknowledged={confirmed}
                  onAcknowledgedChange={setConfirmed}
                />
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="ghost" size="sm" onClick={() => navigate(`/projects/${createdProjectId}`)}>
                  Skip for now
                </Button>
                {!preview && (
                  <Button
                    variant="outline"
                    size="sm"
                    data-tour="import-preview"
                    onClick={() => runPreflight(analyzeRequestBody(analyzeConfig))}
                    disabled={previewing}
                  >
                    {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Preview first
                  </Button>
                )}
                <Button size="sm" data-tour="import-start" onClick={handleStartAnalysis} disabled={startBlocked}>
                  {startingAnalysis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Start analysis
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        {tourOpen && <AppTour steps={IMPORT_TOUR_STEPS} onDone={dismissImportTour} />}
      </>
    );
  }

  // ── Step 1: pick the repository (creates the project, analyzes nothing) ───
  return (
    <>
      <PageHeader
        title="Import a repository"
        subtitle="Step 1 of 2 — connect a GitHub repository. The analysis is configured in the next step."
        actions={<BackLink />}
      />
      <div className="mx-auto max-w-lg">
        <Card>
          <CardContent className="p-4">
          {error && (
            <ErrorBanner className="mt-3">
              {error}
              {error.includes("reconnect") && (
                <Button
                  variant="link"
                  size="xs"
                  className="ml-2 h-auto p-0 text-destructive underline"
                  onClick={() => connectGithub()}
                >
                  Reconnect GitHub
                </Button>
              )}
              {strandedProjectId && (
                <div className="mt-1.5">
                  <Button variant="link" size="xs" className="h-auto p-0 text-destructive underline" asChild>
                    <Link to={`/projects/${strandedProjectId}`}>
                      The project was created — open it to finish setting it up
                    </Link>
                  </Button>
                </div>
              )}
              {existingProjectId && (
                <div className="mt-1.5">
                  <Button variant="link" size="xs" className="h-auto p-0 text-destructive underline" asChild>
                    <Link to={`/projects/${existingProjectId}`}>
                      Open the project you already imported for this repository
                    </Link>
                  </Button>
                </div>
              )}
            </ErrorBanner>
          )}

          {githubAppConnected && githubAppUsername && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Shield className="h-3 w-3" />
              GitHub App linked to <span className="font-medium text-foreground">@{githubAppUsername}</span>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {/* GitHub Installation */}
            <div className="space-y-1">
              <Label className="text-xs">GitHub Account</Label>
              {installationsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                </div>
              ) : installations.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">No installations found.</p>
                  <div className="mt-2 flex justify-center gap-2">
                    <Button size="xs" onClick={handleAuthorizeGitHubApp}>
                      {githubAppConnected ? `Install ${appName}` : `Connect ${appName}`}
                    </Button>
                    <Button variant="outline" size="xs" onClick={() => setRefreshKey((k) => k + 1)}>
                      Refresh
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Select value={selectedInstallation} onValueChange={setSelectedInstallation}>
                    <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="GitHub account">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {installations.map((inst) => (
                        <SelectItem key={inst.id} value={String(inst.id)}>
                          {inst.account.login}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center justify-between">
                    {installUrl && (
                      <a
                        href={installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Configure repositories <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={handleAuthorizeGitHubApp}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Authorize GitHub App
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setRefreshKey((k) => k + 1)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      Refresh
                    </Button>
                  </div>
                </>
              )}
            </div>

            {/* Repository */}
            {selectedInstallation && (
              <div className="space-y-1">
                <Label className="text-xs">Repository</Label>
                {reposLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                  </div>
                ) : (
                  <>
                    {repos.length >= TYPEAHEAD_MIN_OPTIONS && (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={repoFilter}
                          onChange={(e) => setRepoFilter(e.target.value)}
                          placeholder={`Filter ${repos.length} repositories…`}
                          aria-label="Filter repositories"
                          className="h-8 pl-8 text-[0.8125rem]"
                        />
                      </div>
                    )}
                    <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                      <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Repository">
                        <SelectValue placeholder="Select repository" />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleRepos.map((r) => {
                          const alreadyImported = importedRepoKeys.has(r.full_name.toLowerCase());
                          return (
                            <SelectItem key={r.full_name} value={r.full_name} disabled={alreadyImported}>
                              {r.full_name}
                              {alreadyImported && (
                                <span className="text-muted-foreground"> (already imported)</span>
                              )}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {repos.length >= TYPEAHEAD_MIN_OPTIONS && (
                      <p className="text-[0.6875rem] text-muted-foreground">
                        {repoFilter.trim()
                          ? `${visibleRepos.length} of ${repos.length} match "${repoFilter.trim()}"`
                          : `${repos.length} repositories available`}
                        {visibleRepos.length === 0 && " — no match. Check the App is installed on it."}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Branch */}
            {selectedRepo && (
              <div className="space-y-1">
                <Label className="text-xs">Branch</Label>
                {branchesLoading ? (
                  <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                  </div>
                ) : (
                  <>
                    {branches.length >= TYPEAHEAD_MIN_OPTIONS && (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={branchFilter}
                          onChange={(e) => setBranchFilter(e.target.value)}
                          placeholder={`Filter ${branches.length} branches…`}
                          aria-label="Filter branches"
                          className="h-8 pl-8 text-[0.8125rem]"
                        />
                      </div>
                    )}
                    <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                      <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Branch">
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleBranches.map((b) => (
                          <SelectItem key={b.name} value={b.name}>
                            <GitBranch className="mr-1 inline h-3 w-3" />
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            )}

            {/* Role */}
            {selectedRepo && (
              <div className="space-y-1">
                <Label className="text-xs">Role</Label>
                <Select value={developerRole} onValueChange={setDeveloperRole}>
                  <SelectTrigger className="h-8 text-[0.8125rem]" aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Ignored paths */}
            {selectedRepo && (
              <>
                <Separator />
                <div>
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto p-0 text-xs font-medium"
                    onClick={() => setShowIgnored(!showIgnored)}
                  >
                    {showIgnored ? "- Hide" : "+ Show"} ignored paths
                  </Button>
                  {showIgnored && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap gap-1">
                        {ignoredPaths.map((p) => (
                          <Badge key={p} variant="secondary" className="gap-0.5 pr-1 text-xs">
                            {p}
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Remove ignored path"
                              onClick={() => setIgnoredPaths((prev) => prev.filter((x) => x !== p))}
                              className="ml-0.5 size-4 rounded-sm p-0 hover:bg-accent"
                            >
                              <X className="h-2.5 w-2.5" />
                            </Button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={ignoreInput}
                          onChange={(e) => setIgnoreInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addIgnoredPath())}
                          placeholder="e.g. node_modules/"
                          className="h-8 flex-1 text-[0.8125rem]"
                        />
                        <Button variant="outline" size="xs" onClick={addIgnoredPath}>
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Privacy & AI */}
            {selectedRepo && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                    <Shield className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Read-only access · secrets filtered · no full repository stored.
                      The browser never receives full repository source.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canCreate || creating} onClick={handleCreate}>
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Rocket className="h-3 w-3" />
              )}
              {creating ? "Importing…" : "Import repository"}
            </Button>
          </div>
          <p className="mt-2 text-right text-[0.6875rem] text-muted-foreground">
            Nothing is analyzed yet — the next step configures the first run
            (branch, commit, scope, depth) with a cost preview before anything starts.
          </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
