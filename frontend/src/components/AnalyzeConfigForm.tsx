import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ROLE_OPTIONS } from "@/lib/roles";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AnalyzeConfig {
  branch: string;
  /** "" = branch head. */
  commit: string;
  /** "whole" | scope uuid | "custom". */
  scopeId: string;
  /** Free-text path prefix, used when scopeId === "custom" (e.g. "backend/"). */
  scopePath: string;
  /** "" = project default. */
  depth: string;
  /** "" = project default. */
  role: string;
}

export const DEFAULT_ANALYZE_CONFIG: AnalyzeConfig = {
  branch: "",
  commit: "",
  scopeId: "whole",
  scopePath: "",
  depth: "",
  role: "",
};

/** Request body for POST /analyze and /preflight from a form config. */
export function analyzeRequestBody(config: AnalyzeConfig): Record<string, string> {
  const body: Record<string, string> = {};
  if (config.scopeId === "custom") {
    if (config.scopePath.trim()) body.scope_path = config.scopePath.trim();
  } else if (config.scopeId !== "whole") {
    body.scope_id = config.scopeId;
  }
  if (config.branch) body.branch = config.branch;
  if (config.commit) body.commit = config.commit;
  if (config.depth) body.depth = config.depth;
  if (config.role) body.role = config.role;
  return body;
}

interface Scope {
  id: string;
  path_prefix: string;
  display_name: string;
  kind: string;
}

interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

const DEPTHS = [
  { value: "cheap", label: "Cheap — fewest AI calls" },
  { value: "standard", label: "Standard — balanced" },
  { value: "full", label: "Full — most thorough" },
];

interface AnalyzeConfigFormProps {
  /** Needed for scope listing; omit before the project exists. */
  projectId?: string;
  repoOwner: string;
  repoName: string;
  installationId: string;
  /** Branch preselected when the form opens (project default). */
  defaultBranch: string;
  config: AnalyzeConfig;
  onChange: (config: AnalyzeConfig) => void;
}

/**
 * One analysis-run configuration form shared by the Analyze dialog and the
 * import wizard: branch, commit (picked from recent commits — no SHA
 * hunting), scope (detected or custom path), depth, and package role.
 * Empty values mean "project default"; analyzeRequestBody() maps the config
 * to the API body.
 */
export function AnalyzeConfigForm({
  projectId,
  repoOwner,
  repoName,
  installationId,
  defaultBranch,
  config,
  onChange,
}: AnalyzeConfigFormProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);

  const branch = config.branch || defaultBranch;

  useEffect(() => {
    if (!repoOwner || !repoName || !installationId) return;
    apiFetch(`/github/repos/${repoOwner}/${repoName}/branches?installation_id=${installationId}`)
      .then((data: { branches: Array<{ name: string }> }) =>
        setBranches((data.branches ?? []).map((b) => b.name)))
      .catch(() => setBranches([]));
  }, [repoOwner, repoName, installationId]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch(`/projects/${projectId}/scopes`)
      .then((data: { scopes: Scope[] }) => setScopes(data.scopes ?? []))
      .catch(() => setScopes([]));
  }, [projectId]);

  useEffect(() => {
    if (!repoOwner || !repoName || !installationId || !branch) return;
    setLoadingCommits(true);
    apiFetch(
      `/github/repos/${repoOwner}/${repoName}/commits?installation_id=${installationId}&branch=${encodeURIComponent(branch)}`,
    )
      .then((data: { commits: Commit[] }) => setCommits(data.commits ?? []))
      .catch(() => setCommits([]))
      .finally(() => setLoadingCommits(false));
  }, [repoOwner, repoName, installationId, branch]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <Label htmlFor="analyze-branch" className="text-xs">Branch</Label>
        <Select
          value={branch}
          onValueChange={(v) => onChange({ ...config, branch: v, commit: "" })}
        >
          <SelectTrigger id="analyze-branch" className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(branches.length > 0 ? branches : [branch]).map((b) => (
              <SelectItem key={b} value={b}>
                {b}
                {b === defaultBranch ? " (default)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 space-y-1">
        <Label htmlFor="analyze-commit" className="text-xs">Commit</Label>
        <Select
          value={config.commit || "head"}
          onValueChange={(v) => onChange({ ...config, commit: v === "head" ? "" : v })}
        >
          <SelectTrigger id="analyze-commit" className="h-8 w-full min-w-0 text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="head">
              {loadingCommits ? "Latest (loading history…)" : "Latest (branch head)"}
            </SelectItem>
            {commits.map((c) => (
              <SelectItem key={c.sha} value={c.sha}>
                <span className="font-mono">{c.shortSha}</span> — {c.message.slice(0, 48)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 space-y-1">
        <Label htmlFor="analyze-scope" className="text-xs">Scope</Label>
        <Select
          value={config.scopeId}
          onValueChange={(v) => onChange({ ...config, scopeId: v })}
        >
          <SelectTrigger id="analyze-scope" className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="whole">Whole repository</SelectItem>
            {scopes.filter((s) => s.path_prefix !== "").map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.display_name} ({s.path_prefix})
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom path…</SelectItem>
          </SelectContent>
        </Select>
        {config.scopeId === "custom" && (
          <>
            <Label htmlFor="analyze-scope-path" className="sr-only">Custom scope path</Label>
            <Input
              id="analyze-scope-path"
              value={config.scopePath}
              onChange={(e) => onChange({ ...config, scopePath: e.target.value })}
              placeholder="e.g. backend/ or packages/server"
              className="h-8 font-mono text-[0.75rem]"
            />
          </>
        )}
      </div>

      <div className="min-w-0 space-y-1">
        <Label htmlFor="analyze-depth" className="text-xs">Analysis depth</Label>
        <Select
          value={config.depth || "default"}
          onValueChange={(v) => onChange({ ...config, depth: v === "default" ? "" : v })}
        >
          <SelectTrigger id="analyze-depth" className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Project default</SelectItem>
            {DEPTHS.map((d) => (
              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 space-y-1 sm:col-span-2">
        <Label htmlFor="analyze-role" className="text-xs">Onboarding package role</Label>
        <Select
          value={config.role || "default"}
          onValueChange={(v) => onChange({ ...config, role: v === "default" ? "" : v })}
        >
          <SelectTrigger id="analyze-role" className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Project default role</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[0.6875rem] text-muted-foreground">
          The analysis itself is role-independent; the role shapes which onboarding
          package is generated first. Other roles can be generated later without re-analyzing.
        </p>
      </div>
    </div>
  );
}
