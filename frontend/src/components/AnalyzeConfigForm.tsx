import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiFetch } from "@/lib/api";
import { FALLBACK_ROLE, ROLE_OPTIONS, roleTitle } from "@/lib/roles";
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

/**
 * Why a GitHub-backed list is missing. "reconnect" is the one failure the user
 * can fix themselves, so it gets its own copy and a route to the fix; "error"
 * is everything else (network, 404, rate limit) and stays a plain warning.
 */
type ListFailure = false | "error" | "reconnect";

/**
 * A dead stored GitHub connection, as the API reports it. Deliberate duplicate
 * of ImportPage's `isReconnectRequired` (ImportPage.tsx) rather than a shared
 * export: ImportPage imports this module, and ImportPage's test replaces the
 * whole module with a stub form — a classifier exported from here would be
 * mocked away on the page that needs it most. Keep the two in step.
 */
function reconnectRequired(err: unknown): boolean {
  return err instanceof ApiError && (err.body?.code === "github_reconnect_required" || err.status === 403);
}

/** Inherits the warning colour of the line it sits in, so the sentence and its
 *  fix read as one thing rather than a warning with a blue button glued on. */
const RECONNECT_LINK_CLASS = "font-medium underline underline-offset-2 hover:text-warning/80";

const DEPTHS = [
  { value: "cheap", label: "Cheap — fewest AI calls" },
  { value: "standard", label: "Standard — balanced" },
  { value: "full", label: "Full — most thorough" },
];

/** What a run gets when the project stores no depth: worker/index.ts resolves
 *  it as COALESCE(ps.analysis_depth, 'standard'). */
const FALLBACK_DEPTH = DEPTHS.find((d) => d.value === "standard")!;

interface AnalyzeConfigFormProps {
  /** Needed for scope listing; omit before the project exists. */
  projectId?: string;
  repoOwner: string;
  repoName: string;
  installationId: string;
  /** Branch preselected when the form opens (project default). */
  defaultBranch: string;
  /**
   * The project's stored depth and role. The two "leave it as configured"
   * options name the value they resolve to instead of saying "default", which
   * told the person starting a BILLED run nothing about what it would run at.
   */
  projectDepth?: string;
  projectRole?: string;
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
  projectDepth,
  projectRole,
  config,
  onChange,
}: AnalyzeConfigFormProps) {
  const [branches, setBranches] = useState<string[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  /**
   * Bug #68: all three of these lists used to `catch` into an empty array, and
   * each control falls back to a single sensible default when its list is
   * empty. So a failed request rendered as "this repo has one branch / no
   * history / no detected scopes" — a quiet lie on the screen that starts a
   * BILLED run. The run is still startable on the defaults; the form just
   * stops claiming the defaults are all there is.
   *
   * The two GitHub-backed lists additionally record WHICH failure it was: a
   * connection the user can re-authorize deserves the fix, not a shrug. Scopes
   * come from our own API, where the GitHub connection is not in the picture.
   */
  const [listErrors, setListErrors] = useState<{
    branches: ListFailure;
    commits: ListFailure;
    scopes: boolean;
  }>({
    branches: false,
    commits: false,
    scopes: false,
  });

  const branch = config.branch || defaultBranch;

  useEffect(() => {
    if (!repoOwner || !repoName || !installationId) return;
    apiFetch(`/github/repos/${repoOwner}/${repoName}/branches?installation_id=${installationId}`)
      .then((data: { branches: Array<{ name: string }> }) => {
        setBranches((data.branches ?? []).map((b) => b.name));
        setListErrors((e) => ({ ...e, branches: false }));
      })
      .catch((err: unknown) => {
        setBranches([]);
        setListErrors((e) => ({ ...e, branches: reconnectRequired(err) ? "reconnect" : "error" }));
      });
  }, [repoOwner, repoName, installationId]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch(`/projects/${projectId}/scopes`)
      .then((data: { scopes: Scope[] }) => {
        setScopes(data.scopes ?? []);
        setListErrors((e) => ({ ...e, scopes: false }));
      })
      .catch(() => { setScopes([]); setListErrors((e) => ({ ...e, scopes: true })); });
  }, [projectId]);

  useEffect(() => {
    if (!repoOwner || !repoName || !installationId || !branch) return;
    setLoadingCommits(true);
    apiFetch(
      `/github/repos/${repoOwner}/${repoName}/commits?installation_id=${installationId}&branch=${encodeURIComponent(branch)}`,
    )
      .then((data: { commits: Commit[] }) => {
        setCommits(data.commits ?? []);
        setListErrors((e) => ({ ...e, commits: false }));
      })
      .catch((err: unknown) => {
        setCommits([]);
        setListErrors((e) => ({ ...e, commits: reconnectRequired(err) ? "reconnect" : "error" }));
      })
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
              <SelectItem key={b} value={b}>{b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {listErrors.branches === "reconnect" ? (
          <p className="text-[0.6875rem] text-warning">
            Your GitHub connection needs to be re-authorized, so only {branch} is offered.{" "}
            <Link to="/settings" className={RECONNECT_LINK_CLASS}>
              Reconnect GitHub in Account settings
            </Link>
          </p>
        ) : listErrors.branches ? (
          <p className="text-[0.6875rem] text-warning">
            Branch list couldn&apos;t be loaded — only {branch} is offered. Other branches may exist.
          </p>
        ) : null}
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
        {listErrors.commits === "reconnect" ? (
          <p className="text-[0.6875rem] text-warning">
            Your GitHub connection needs to be re-authorized, so recent commits can&apos;t be
            listed — this will analyze the branch head.{" "}
            <Link to="/settings" className={RECONNECT_LINK_CLASS}>
              Reconnect GitHub in Account settings
            </Link>
          </p>
        ) : listErrors.commits ? (
          <p className="text-[0.6875rem] text-warning">
            Commit history couldn&apos;t be loaded — this will analyze the branch head.
          </p>
        ) : null}
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
        {listErrors.scopes && (
          <p className="text-[0.6875rem] text-warning">
            Detected scopes couldn&apos;t be loaded — this is a failed request, not a repository
            without sub-packages. Use a custom path if you meant to narrow the run.
          </p>
        )}
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
            <SelectItem value="default">
              {(DEPTHS.find((d) => d.value === projectDepth) ?? FALLBACK_DEPTH).label}
            </SelectItem>
            {/* Pinning the depth the project already resolves to is the same
                run; hiding it keeps the list free of two identical labels. */}
            {DEPTHS.filter((d) => d.value !== (projectDepth || FALLBACK_DEPTH.value)).map((d) => (
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
            <SelectItem value="default">{roleTitle(projectRole || FALLBACK_ROLE)}</SelectItem>
            {/* Same dedupe as depth: generating for the project's own role is
                the "default" entry above. */}
            {ROLE_OPTIONS.filter((r) => r.value !== (projectRole || FALLBACK_ROLE)).map((r) => (
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
