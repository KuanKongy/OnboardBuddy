import {
  ExternalLink,
  GitBranch,
  Loader2,
  Rocket,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { apiFetch } from "@/lib/api";
import { consumeTourRequest, dismissTour, tourDismissed } from "@/lib/tourState";
import { FALLBACK_ROLE, ROLE_OPTIONS } from "@/lib/roles";

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
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  // Wizard: step 1 imports the repo (creates the project, nothing analyzed);
  // step 2 configures and explicitly starts the first analysis.
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [analyzeConfig, setAnalyzeConfig] = useState<AnalyzeConfig>(DEFAULT_ANALYZE_CONFIG);
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const { preview, previewing, error: previewError, run: runPreflight, reset: resetPreflight } = usePreflight(createdProjectId ?? "");
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
  const [developerRole, setDeveloperRole] = useState<string>(FALLBACK_ROLE);

  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const [ignoreInput, setIgnoreInput] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);

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

  async function handleCreate() {
    if (!repo) return;
    setCreating(true);
    setError("");
    setStrandedProjectId(null);
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
      setCreatedProjectId(project.id);
      setAnalyzeConfig({ ...DEFAULT_ANALYZE_CONFIG, branch: selectedBranch });
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
    } finally {
      setCreating(false);
    }
  }

  function dismissImportTour() {
    setTourOpen(false);
    if (user) dismissTour("import", user.id);
  }

  async function handleStartAnalysis() {
    if (!createdProjectId) return;
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

  // ── Step 2: configure + explicitly start the first analysis ───────────────
  if (createdProjectId && repo) {
    return (
      <>
        <PageHeader
          title="Configure the first analysis"
          subtitle={`Step 2 of 2 — ${repo.full_name} is imported; nothing runs until you press Start.`}
          actions={<BackLink />}
        />
        <div className="mx-auto max-w-lg">
          <Card>
            <CardContent className="space-y-3 p-4">
              {(error || previewError) && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error || previewError}
                </div>
              )}

              <div data-tour="import-config-form">
                <AnalyzeConfigForm
                  projectId={createdProjectId}
                  repoOwner={repo.owner}
                  repoName={repo.name}
                  installationId={selectedInstallation}
                  defaultBranch={selectedBranch}
                  config={analyzeConfig}
                  onChange={(c) => {
                    setAnalyzeConfig(c);
                    resetPreflight();
                  }}
                />
              </div>

              {previewing && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
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
              {preview && <PreflightPreviewCard preview={preview} />}

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
                <Button size="sm" data-tour="import-start" onClick={handleStartAnalysis} disabled={startingAnalysis}>
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
            <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
            </div>
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
                    <SelectTrigger className="h-8 text-[0.8125rem]">
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
                  <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                    <SelectTrigger className="h-8 text-[0.8125rem]">
                      <SelectValue placeholder="Select repository" />
                    </SelectTrigger>
                    <SelectContent>
                      {repos.map((r) => (
                        <SelectItem key={r.full_name} value={r.full_name}>
                          {r.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                    <SelectTrigger className="h-8 text-[0.8125rem]">
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => (
                        <SelectItem key={b.name} value={b.name}>
                          <GitBranch className="mr-1 inline h-3 w-3" />
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Role */}
            {selectedRepo && (
              <div className="space-y-1">
                <Label className="text-xs">Role</Label>
                <Select value={developerRole} onValueChange={setDeveloperRole}>
                  <SelectTrigger className="h-8 text-[0.8125rem]">
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
