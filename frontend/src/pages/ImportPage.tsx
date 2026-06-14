import {
  ExternalLink,
  GitBranch,
  Loader2,
  Rocket,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { apiFetch } from "@/lib/api";

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

const developerRoles = [
  { value: "backend", label: "Backend" },
  { value: "frontend", label: "Frontend" },
  { value: "devops", label: "DevOps" },
  { value: "qa", label: "QA" },
  { value: "general", label: "General" },
];

export function ImportPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const [installUrl, setInstallUrl] = useState("");
  const [appName, setAppName] = useState("GitHub App");
  const [refreshKey, setRefreshKey] = useState(0);

  const [installations, setInstallations] = useState<Installation[]>([]);
  const [installationsLoading, setInstallationsLoading] = useState(true);
  const [selectedInstallation, setSelectedInstallation] = useState<string>("");

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>("");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [developerRole, setDeveloperRole] = useState("general");

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
      .then(([appInfo, instData]: [{ name: string; install_url: string } | null, { installations: Installation[] }]) => {
        if (appInfo) {
          setAppName(appInfo.name);
          setInstallUrl(appInfo.install_url);
        }
        setInstallations(instData.installations);
      })
      .catch((err) => setError(err.message))
      .finally(() => setInstallationsLoading(false));
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedInstallation) return;
    setReposLoading(true);
    setSelectedRepo("");
    setSelectedBranch("");
    apiFetch(`/github/repos?installation_id=${selectedInstallation}`)
      .then((data: { repos: Repo[] }) => setRepos(data.repos))
      .catch((err) => setError(err.message))
      .finally(() => setReposLoading(false));
  }, [selectedInstallation]);

  useEffect(() => {
    const repo = repos.find((r) => r.full_name === selectedRepo);
    if (!repo || !selectedInstallation) return;
    setBranchesLoading(true);
    setSelectedBranch("");
    setDisplayName(repo.name);
    apiFetch(
      `/github/repos/${repo.owner}/${repo.name}/branches?installation_id=${selectedInstallation}`,
    )
      .then((data: { branches: Branch[] }) => {
        setBranches(data.branches);
        const defaultBranch = data.branches.find((b) => b.name === repo.default_branch);
        if (defaultBranch) setSelectedBranch(defaultBranch.name);
      })
      .catch((err) => setError(err.message))
      .finally(() => setBranchesLoading(false));
  }, [selectedRepo, selectedInstallation, repos]);

  function addIgnoredPath() {
    const path = ignoreInput.trim();
    if (path && !ignoredPaths.includes(path)) {
      setIgnoredPaths((prev) => [...prev, path]);
    }
    setIgnoreInput("");
  }

  const repo = repos.find((r) => r.full_name === selectedRepo);
  const canCreate = selectedInstallation && selectedRepo && selectedBranch;

  async function handleCreate() {
    if (!repo) return;
    setCreating(true);
    setError("");
    try {
      const { project } = await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({
          repo_owner: repo.owner,
          repo_name: repo.name,
          branch: selectedBranch,
          default_developer_role: developerRole,
        }),
      }) as { project: { id: string } };

      if (ignoredPaths.length > 0) {
        await apiFetch(`/projects/${project.id}/settings`, {
          method: "PUT",
          body: JSON.stringify({ ignored_paths: ignoredPaths }),
        });
      }

      await apiFetch(`/projects/${project.id}/analyze`, { method: "POST" });
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create project");
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardContent className="p-4">
          <h1 className="text-sm font-semibold text-foreground">Import a repository</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Point to a GitHub repository to analyze.
          </p>

          {error && (
            <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
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
                    {installUrl && (
                      <Button size="xs" asChild>
                        <a href={installUrl} target="_blank" rel="noopener noreferrer">
                          Install {appName}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    )}
                    <Button variant="outline" size="xs" onClick={() => setRefreshKey((k) => k + 1)}>
                      Refresh
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <Select value={selectedInstallation} onValueChange={setSelectedInstallation}>
                    <SelectTrigger className="h-8 text-[13px]">
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
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        Configure repositories <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setRefreshKey((k) => k + 1)}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Refresh
                    </button>
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
                    <SelectTrigger className="h-8 text-[13px]">
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

            {/* Display name + Branch */}
            {selectedRepo && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Display name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Project name"
                    className="h-8 text-[13px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Branch</Label>
                  {branchesLoading ? (
                    <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Loading...
                    </div>
                  ) : (
                    <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                      <SelectTrigger className="h-8 text-[13px]">
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
              </div>
            )}

            {/* Role */}
            {selectedRepo && (
              <div className="space-y-1">
                <Label className="text-xs">Role</Label>
                <Select value={developerRole} onValueChange={setDeveloperRole}>
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {developerRoles.map((role) => (
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
                  <button
                    type="button"
                    onClick={() => setShowIgnored(!showIgnored)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {showIgnored ? "- Hide" : "+ Show"} ignored paths
                  </button>
                  {showIgnored && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex flex-wrap gap-1">
                        {ignoredPaths.map((p) => (
                          <Badge key={p} variant="secondary" className="gap-0.5 pr-1 text-[11px]">
                            {p}
                            <button
                              type="button"
                              onClick={() => setIgnoredPaths((prev) => prev.filter((x) => x !== p))}
                              className="ml-0.5 rounded-sm hover:bg-accent"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={ignoreInput}
                          onChange={(e) => setIgnoreInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addIgnoredPath())}
                          placeholder="e.g. node_modules/"
                          className="h-8 flex-1 text-[13px]"
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
              Start analysis
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
