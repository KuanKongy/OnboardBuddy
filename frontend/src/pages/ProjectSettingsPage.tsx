import { AlertTriangle, Loader2, RefreshCw, Save, Shield, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject, type ProjectData } from "@/contexts/ProjectContext";
import { usePackages } from "@/contexts/PackagesContext";
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
import { Textarea } from "@/components/ui/textarea";
import { AnalyzeDialog } from "@/components/AnalyzeDialog";
import { ConfirmDangerDialog } from "@/components/ConfirmDangerDialog";
import { useFullBleedMain } from "@/components/MainRegion";
import { PageHeader } from "@/components/PageHeader";
import { SettingsShell, type SettingsSection } from "@/components/SettingsShell";
import { apiFetch } from "@/lib/api";
import { autoDrillEnabled, setAutoDrillEnabled, type GraphSurface } from "@/lib/graphPrefs";
import { scrollBehavior } from "@/lib/motion";
import { PRIVACY_MODES } from "@/lib/privacyModes";
import { FALLBACK_ROLE, ROLE_OPTIONS, roleLabel } from "@/lib/roles";

/** The canonical mode list lives in lib/privacyModes (public pages import it
 *  too); re-exported so existing importers keep working. */
export { PRIVACY_MODES };

// Must match the backend's SEMANTIC_VIEWS keys exactly — the old short names
// ("runtime") never matched the API's "critical_for_runtime" keys, so every
// slider showed 0 and saves were rejected.
const WEIGHT_VIEWS = [
  "critical_for_runtime", "critical_for_business", "critical_for_onboarding",
  "critical_for_role", "critical_for_change_risk", "critical_for_architecture",
  "critical_for_workflow",
] as const;

// Mirrors backend SELECTABLE_MODELS (ai/modelTiers.ts) — the vetted model
// choices; one selection drives both chat tiers. "auto" probes OpenRouter's
// per-provider throughput before each job and picks the fastest model whose
// providers meet the privacy filter (data_collection: deny).
const DEFAULT_ANALYSIS_MODEL = "auto";
const SELECTABLE_MODELS: Array<{ id: string; label: string }> = [
  { id: "auto", label: "Auto — fastest private provider right now" },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (fast, 1M context)" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash (1M context)" },
  { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout (fastest bursts, smaller context)" },
];

// Mirrors backend DEPTH_BUDGETS (engine/budgets.ts) so the inputs show the
// real defaults instead of an opaque "depth default" placeholder.
const DEPTH_BUDGET_DEFAULTS: Record<string, { calls: number; tokens: number }> = {
  cheap: { calls: 100, tokens: 1_000_000 },
  standard: { calls: 300, tokens: 4_000_000 },
  full: { calls: 1_500, tokens: 20_000_000 },
};

const WEIGHT_LABELS: Record<string, string> = {
  critical_for_runtime: "Runtime",
  critical_for_business: "Business",
  critical_for_onboarding: "Onboarding",
  critical_for_role: "Role relevance",
  critical_for_change_risk: "Change risk",
  critical_for_architecture: "Architecture",
  critical_for_workflow: "Workflows",
};

interface RoleWeights {
  role: string;
  weights: Record<string, number>;
  defaults: Record<string, number>;
  customized: boolean;
}

/** One row of GET /projects/:id/llm-key's `usage_by_key_source`. Postgres
 *  returns bigint/numeric aggregates as strings, so every figure is coerced
 *  before it is summed — string `+` here would concatenate the bill. */
interface KeyUsageRow {
  key_source: string;
  calls: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  estimated_cost_usd: number | string;
}

const KEY_SOURCE_LABEL: Record<string, string> = {
  server: "Server key",
  project: "Project key",
};

/** Every key source added up — the project's whole AI bill. */
function totalKeyUsage(rows: KeyUsageRow[]) {
  return rows.reduce(
    (acc, r) => ({
      calls: acc.calls + Number(r.calls ?? 0),
      inputTokens: acc.inputTokens + Number(r.input_tokens ?? 0),
      outputTokens: acc.outputTokens + Number(r.output_tokens ?? 0),
      costUsd: acc.costUsd + Number(r.estimated_cost_usd ?? 0),
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );
}

/**
 * The eleven editable settings fields, in exactly the shape the form state
 * holds them (every numeric input is a string, because that is what an
 * `<Input>` gives back). Used twice: to hydrate the form from the server, and
 * as the baseline the current form is diffed against to decide whether the
 * save bar has anything to save.
 *
 * The no-settings branch must stay identical to the `useState` initial values.
 * A project whose row carries `settings: null` would otherwise read as dirty
 * the moment it loads, and the page would offer to save edits nobody made.
 */
function settingsFromProject(project: ProjectData) {
  const settings = project.settings;
  if (!settings) {
    return {
      ignoredPaths: "",
      defaultRole: FALLBACK_ROLE,
      privacyMode: "full_ai",
      analysisDepth: "standard",
      analysisModel: DEFAULT_ANALYSIS_MODEL,
      fileLimit: "",
      locLimit: "",
      budgetCalls: "",
      budgetTokens: "",
      stopBehavior: "pause",
      autoReanalyze: false,
    };
  }
  const tierOverrides = (settings as { model_tier_overrides?: Record<string, string[]> }).model_tier_overrides ?? {};
  const budgets = (settings as { budget_overrides?: Record<string, number> }).budget_overrides ?? {};
  return {
    ignoredPaths: settings.ignored_paths.join("\n"),
    defaultRole: settings.default_developer_role,
    privacyMode: settings.privacy_mode ?? "full_ai",
    analysisDepth: (settings as { analysis_depth?: string }).analysis_depth ?? "standard",
    analysisModel: tierOverrides.cheap?.[0] ?? DEFAULT_ANALYSIS_MODEL,
    fileLimit: settings.file_limit != null ? String(settings.file_limit) : "",
    locLimit: settings.loc_limit != null ? String(settings.loc_limit) : "",
    budgetCalls: budgets.max_llm_calls ? String(budgets.max_llm_calls) : "",
    budgetTokens: budgets.max_input_tokens ? String(budgets.max_input_tokens) : "",
    stopBehavior: (settings as { budget_stop_behavior?: string }).budget_stop_behavior ?? "pause",
    autoReanalyze: (settings as { auto_reanalyze_on_push?: boolean }).auto_reanalyze_on_push ?? false,
  };
}

export function ProjectSettingsPage() {
  const { project, refetch } = useProject();
  const { registerSessionJob } = usePackages();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // The header divider and the rail's border have to reach both window walls,
  // which the shell's `<main>` padding makes impossible from in here.
  useFullBleedMain();

  const [ignoredPaths, setIgnoredPaths] = useState("");
  const [defaultRole, setDefaultRole] = useState<string>(FALLBACK_ROLE);
  const [privacyMode, setPrivacyMode] = useState("full_ai");
  const [analysisDepth, setAnalysisDepth] = useState("standard");
  const [analysisModel, setAnalysisModel] = useState(DEFAULT_ANALYSIS_MODEL);
  const [fileLimit, setFileLimit] = useState<string>("");
  const [locLimit, setLocLimit] = useState<string>("");
  const [budgetCalls, setBudgetCalls] = useState<string>("");
  const [budgetTokens, setBudgetTokens] = useState<string>("");
  const [stopBehavior, setStopBehavior] = useState("pause");
  const [autoReanalyze, setAutoReanalyze] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const analyzing = project?.status === "analyzing";
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Kept apart from `error`: the page banner sits behind the modal overlay, so a
  // failed delete reported there is invisible to the person looking at the dialog.
  const [deleteError, setDeleteError] = useState("");

  // BYO LLM key
  const [keyInfo, setKeyInfo] = useState<{ exists: boolean; created_by?: string | null; updated_at?: string } | null>(null);
  // Project-wide AI spend, split by which key paid for it. Run history shows
  // one run at a time, so this is the only place the whole bill is visible.
  const [keyUsage, setKeyUsage] = useState<KeyUsageRow[]>([]);
  const [keyInfoError, setKeyInfoError] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keySaved, setKeySaved] = useState("");

  // Ranking weights
  const [weightRoles, setWeightRoles] = useState<RoleWeights[] | null>(null);
  const [weightsError, setWeightsError] = useState(false);
  const [weightRole, setWeightRole] = useState("backend");
  const [weightsSaving, setWeightsSaving] = useState(false);
  // Confirmation for the weight mutations. Saving used to await, refetch and
  // return with nothing changing on screen, so success and failure looked
  // identical (audit §20.3 SILENT-MUTATION).
  const [weightsSaved, setWeightsSaved] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const canEdit =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";

  // Graph click model. Browser-local and per project, so it is not part of the
  // saved settings above and every tier gets to set it: it changes what YOUR
  // click does, not what the project is. The graph pages read the stored value
  // per click, so this mirror exists only to show which option is active.
  const projectId = project?.id;
  const [autoDrill, setAutoDrill] = useState(() => ({
    dependencies: autoDrillEnabled("dependencies", projectId ?? ""),
    architecture: autoDrillEnabled("architecture", projectId ?? ""),
  }));
  // Seeded from the first render's project, which is null on a cold load — and
  // this page stays mounted across a project switch, so the toggles would
  // otherwise show the previous project's answer.
  useEffect(() => {
    setAutoDrill({
      dependencies: autoDrillEnabled("dependencies", projectId ?? ""),
      architecture: autoDrillEnabled("architecture", projectId ?? ""),
    });
  }, [projectId]);

  function chooseAutoDrill(surface: GraphSurface, enabled: boolean) {
    setAutoDrillEnabled(surface, projectId ?? "", enabled);
    setAutoDrill((prev) => ({ ...prev, [surface]: enabled }));
  }

  useEffect(() => {
    if (project?.settings) {
      const stored = settingsFromProject(project);
      setIgnoredPaths(stored.ignoredPaths);
      setDefaultRole(stored.defaultRole);
      setPrivacyMode(stored.privacyMode);
      setAnalysisDepth(stored.analysisDepth);
      setAnalysisModel(stored.analysisModel);
      setFileLimit(stored.fileLimit);
      setLocLimit(stored.locLimit);
      setBudgetCalls(stored.budgetCalls);
      setBudgetTokens(stored.budgetTokens);
      setStopBehavior(stored.stopBehavior);
      setAutoReanalyze(stored.autoReanalyze);
    }
  }, [project]);

  // Surface a save/delete/etc. failure wherever the user currently is on
  // this long page — the banner renders right under the header, easy to
  // miss from a bottom-of-page action. `block: "nearest"` so this cannot
  // scroll anything already in view: from lg up the banner is a pinned row
  // and the only scroller is the shell's column, which must not move.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "nearest" });
  }, [error]);

  // Slider state lives here, not in `project.settings`, so the footer Cancel
  // (which only refetched settings) left moved sliders moved — the user could
  // neither confirm a save nor undo one (audit §20.3). Cancel now reloads this
  // too, which is the only thing that actually reverts them.
  // Bug #68: both of these swallowed their rejections, so a failed load was
  // indistinguishable from a real answer — an empty role dropdown with no
  // sliders read as "this project has no ranking weights", and a failed
  // key lookup rendered the "paste a key" form, telling a team whose key IS
  // configured that it is not. Both now say which of the two happened.
  const loadWeights = useCallback(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/ranking-weights`)
      .then((data) => { setWeightRoles(data.roles); setWeightsError(false); })
      .catch(() => setWeightsError(true));
  }, [id]);

  const loadKeyInfo = useCallback(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/llm-key`)
      .then((data) => {
        setKeyInfo(data.key);
        setKeyUsage(Array.isArray(data.usage_by_key_source) ? data.usage_by_key_source : []);
        setKeyInfoError(false);
      })
      .catch(() => setKeyInfoError(true));
  }, [id]);

  useEffect(() => {
    loadKeyInfo();
    loadWeights();
  }, [loadKeyInfo, loadWeights]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const budget_overrides: Record<string, number> = {};
      if (budgetCalls && Number(budgetCalls) > 0) budget_overrides.max_llm_calls = Number(budgetCalls);
      if (budgetTokens && Number(budgetTokens) > 0) budget_overrides.max_input_tokens = Number(budgetTokens);
      const settingsBody: Record<string, unknown> = {
        ignored_paths: ignoredPaths.split("\n").map((p) => p.trim()).filter(Boolean),
        default_developer_role: defaultRole,
        privacy_mode: privacyMode,
        analysis_depth: analysisDepth,
        // One model choice drives both chat tiers; embeddings stay default.
        model_tier_overrides: { cheap: [analysisModel], strong: [analysisModel] },
        budget_overrides,
        budget_stop_behavior: stopBehavior,
        auto_reanalyze_on_push: autoReanalyze,
      };
      // file_limit/loc_limit are `not null check (> 0)` in the DB — never send
      // null/0. Omit the key entirely when the field is empty/invalid so the
      // backend's `!== undefined` guard leaves the stored value untouched
      // instead of failing the constraint.
      if (fileLimit.trim() && Number(fileLimit) > 0) settingsBody.file_limit = Number(fileLimit);
      if (locLimit.trim() && Number(locLimit) > 0) settingsBody.loc_limit = Number(locLimit);
      await apiFetch(`/projects/${id}/settings`, {
        method: "PUT",
        body: JSON.stringify(settingsBody),
      });
      setSaved(true);
      refetch();
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveKey() {
    if (!keyInput.trim()) return;
    setKeySaving(true);
    setError("");
    setKeySaved("");
    try {
      await apiFetch(`/projects/${id}/llm-key`, {
        method: "PUT",
        body: JSON.stringify({ api_key: keyInput.trim() }),
      });
      setKeyInput("");
      const data = await apiFetch(`/projects/${id}/llm-key`);
      setKeyInfo(data.key);
      setKeySaved("Key saved.");
      setTimeout(() => setKeySaved(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setKeySaving(false);
    }
  }

  async function handleRemoveKey() {
    setKeySaving(true);
    setKeySaved("");
    try {
      await apiFetch(`/projects/${id}/llm-key`, { method: "DELETE" });
      setKeyInfo({ exists: false });
      setKeySaved("Key removed — the server key is used again.");
      setTimeout(() => setKeySaved(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove key");
    } finally {
      setKeySaving(false);
    }
  }

  const activeWeights = weightRoles?.find((r) => r.role === weightRole) ?? null;

  function setWeight(view: string, value: number) {
    setWeightRoles((prev) =>
      prev?.map((r) => (r.role === weightRole ? { ...r, weights: { ...r.weights, [view]: value } } : r)) ?? null,
    );
  }

  async function handleSaveWeights() {
    if (!activeWeights) return;
    setWeightsSaving(true);
    setWeightsSaved("");
    setError("");
    try {
      await apiFetch(`/projects/${id}/ranking-weights/${weightRole}`, {
        method: "PUT",
        body: JSON.stringify({ weights: activeWeights.weights }),
      });
      const data = await apiFetch(`/projects/${id}/ranking-weights`);
      setWeightRoles(data.roles);
      setWeightsSaved(`Saved — ${roleLabel(weightRole)} scores re-projected.`);
      setTimeout(() => setWeightsSaved(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save weights");
    } finally {
      setWeightsSaving(false);
    }
  }

  async function handleRevertWeights() {
    setWeightsSaving(true);
    setWeightsSaved("");
    setError("");
    try {
      await apiFetch(`/projects/${id}/ranking-weights/${weightRole}`, { method: "DELETE" });
      const data = await apiFetch(`/projects/${id}/ranking-weights`);
      setWeightRoles(data.roles);
      setWeightsSaved(`Reverted — ${roleLabel(weightRole)} is back on the built-in weights.`);
      setTimeout(() => setWeightsSaved(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to revert weights");
    } finally {
      setWeightsSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await apiFetch(`/projects/${id}`, { method: "DELETE" });
      navigate("/dashboard");
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  if (!project) return null;

  // What the save bar is for. The ranking weights and the API key are not in
  // here on purpose: each has its own Save button and its own confirmation, so
  // a moved slider must not light up the page-level bar.
  const baseline = settingsFromProject(project);
  const dirty =
    ignoredPaths !== baseline.ignoredPaths ||
    defaultRole !== baseline.defaultRole ||
    privacyMode !== baseline.privacyMode ||
    analysisDepth !== baseline.analysisDepth ||
    analysisModel !== baseline.analysisModel ||
    fileLimit !== baseline.fileLimit ||
    locLimit !== baseline.locLimit ||
    budgetCalls !== baseline.budgetCalls ||
    budgetTokens !== baseline.budgetTokens ||
    stopBehavior !== baseline.stopBehavior ||
    autoReanalyze !== baseline.autoReanalyze;

  const spend = totalKeyUsage(keyUsage);

  const sections: SettingsSection[] = [
    {
      id: "settings-general",
      label: "General",
      children: (
        <>
          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">Repository</h3>
              <p className="text-xs text-foreground">{project.repo_owner}/{project.repo_name}</p>
              {/* Owner feedback N1: branch used to be listed here as if it were a
                  project-level setting. It is not — every run picks its own
                  branch and commit in the Analyze dialog, and each package is
                  pinned to the one it was built from. Showing a single "Branch"
                  value on a settings page implied it applied to everything. */}
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Branch and commit are chosen per analysis run — see the branch/commit chooser
                in the sidebar and the Analyze dialog.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">Developer role</h3>
              <Select value={defaultRole} onValueChange={setDefaultRole} disabled={!canEdit}>
                <SelectTrigger className="h-8 text-[0.8125rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Applies to new members and to packages generated without an explicit role.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">Ignored paths</h3>
              <Textarea
                value={ignoredPaths}
                onChange={(e) => setIgnoredPaths(e.target.value)}
                placeholder={"node_modules/\ndist/\n.env"}
                rows={4}
                disabled={!canEdit}
                className="text-[0.8125rem]"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                One path per line. These will be excluded from analysis.
              </p>
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      id: "settings-analysis",
      label: "Analysis",
      children: (
        <>
          <Card>
            <CardContent className="p-3">
              <h3 className="mb-2 text-xs font-medium text-foreground">Analysis budget</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="budget-calls" className="text-xs">Max LLM calls</Label>
                  <Input
                    id="budget-calls"
                    type="number"
                    value={budgetCalls}
                    onChange={(e) => setBudgetCalls(e.target.value)}
                    placeholder={`${DEPTH_BUDGET_DEFAULTS[analysisDepth]?.calls ?? 300}`}
                    disabled={!canEdit}
                    className="h-8 text-[0.8125rem]"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="budget-tokens" className="text-xs">Max input tokens</Label>
                  <Input
                    id="budget-tokens"
                    type="number"
                    value={budgetTokens}
                    onChange={(e) => setBudgetTokens(e.target.value)}
                    placeholder={`${(DEPTH_BUDGET_DEFAULTS[analysisDepth]?.tokens ?? 4_000_000).toLocaleString()}`}
                    disabled={!canEdit}
                    className="h-8 text-[0.8125rem]"
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="stop-behavior" className="text-xs">When exceeded</Label>
                  <Select value={stopBehavior} onValueChange={setStopBehavior} disabled={!canEdit}>
                    <SelectTrigger id="stop-behavior" className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue className="truncate" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pause">Pause — resume later</SelectItem>
                      <SelectItem value="degrade">Degrade — finish without AI</SelectItem>
                      <SelectItem value="fail">Fail the run</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
                Empty fields use the {analysisDepth} depth's built-in limits
                ({DEPTH_BUDGET_DEFAULTS[analysisDepth]?.calls ?? 300} calls, {((DEPTH_BUDGET_DEFAULTS[analysisDepth]?.tokens ?? 4_000_000) / 1_000_000).toLocaleString()}M input tokens).
                Live spend shows in the analysis status.
              </p>

              {/* The caps above are per run, and run history reports one run at
                  a time — so "what has this project cost" had no answer anywhere
                  in the product. Read-only: it is a record, not a setting. */}
              <div className="mt-3 border-t border-border pt-2">
                <h4 className="text-xs font-medium text-foreground">Total AI spend on this project</h4>
                {keyUsage.length === 0 ? (
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                    No completed AI calls recorded yet.
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 text-[0.8125rem] tabular-nums text-foreground">
                      ${spend.costUsd.toFixed(4)}
                      <span className="text-[0.6875rem] text-muted-foreground">
                        {" · "}{spend.calls.toLocaleString()} AI calls
                        {" · "}{spend.inputTokens.toLocaleString()} in / {spend.outputTokens.toLocaleString()} out tokens
                      </span>
                    </p>
                    {/* Which key paid matters: a team's own key and the server's
                        are two different bills, and only this split says which. */}
                    {keyUsage.length > 1 && (
                      <ul className="mt-1 space-y-0.5">
                        {keyUsage.map((row) => (
                          <li key={row.key_source} className="text-[0.6875rem] tabular-nums text-muted-foreground">
                            {KEY_SOURCE_LABEL[row.key_source] ?? row.key_source}: ${Number(row.estimated_cost_usd ?? 0).toFixed(4)}
                            {" · "}{Number(row.calls ?? 0).toLocaleString()} calls
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                      Across every completed AI call on this project's snapshots, all runs included.
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <h3 className="mb-1 text-xs font-medium text-foreground">Automation</h3>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.8125rem] font-medium text-foreground">Re-analyze on push</p>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                    When GitHub pushes to a branch that has onboarding packages, run an incremental
                    re-analysis per affected scope. Changed sections get stale badges — packages are
                    never rebuilt automatically, so there's no surprise AI spend. Requires the GitHub
                    App webhook to be configured (see the DevOps guide).
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoReanalyze}
                  aria-label="Re-analyze on push"
                  disabled={!canEdit}
                  onClick={() => setAutoReanalyze((v) => !v)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    autoReanalyze ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all ${
                      autoReanalyze ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium text-foreground">Analysis limits</h3>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setAnalyzeOpen(true)}
                    disabled={analyzing || project.status === "analyzing"}
                  >
                    <RefreshCw className={`h-3 w-3 ${analyzing ? "animate-spin" : ""}`} />
                    Re-analyze…
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="file-limit" className="text-xs">Max files</Label>
                  <Input
                    id="file-limit"
                    type="number"
                    value={fileLimit}
                    onChange={(e) => setFileLimit(e.target.value)}
                    placeholder="unchanged if blank"
                    disabled={!canEdit}
                    className="h-8 text-[0.8125rem]"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="loc-limit" className="text-xs">Max lines of code</Label>
                  <Input
                    id="loc-limit"
                    type="number"
                    value={locLimit}
                    onChange={(e) => setLocLimit(e.target.value)}
                    placeholder="unchanged if blank"
                    disabled={!canEdit}
                    className="h-8 text-[0.8125rem]"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium text-foreground">Ranking weights</h3>
                {activeWeights?.customized && (
                  <Badge variant="outline" className="text-[0.6875rem]">customized</Badge>
                )}
              </div>
              <p className="mb-2 text-[0.6875rem] text-muted-foreground">
                How much each signal counts toward "critical for this role". Changes apply instantly —
                scores are re-projected, never re-analyzed.
              </p>
              {weightsError ? (
                <div
                  className="flex items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2"
                  role="alert"
                >
                  <p className="text-xs text-danger">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                    Couldn&apos;t load ranking weights. The saved weights are unchanged — this is a
                    failed request, not a project without them.
                  </p>
                  <Button variant="outline" size="xs" className="shrink-0 gap-1.5" onClick={loadWeights}>
                    <RefreshCw className="h-3 w-3" /> Retry
                  </Button>
                </div>
              ) : (
                <Select value={weightRole} onValueChange={setWeightRole}>
                  <SelectTrigger className="mb-3 h-8 w-[180px] text-[0.8125rem]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(weightRoles ?? []).map((r) => (
                      <SelectItem key={r.role} value={r.role}>{roleLabel(r.role)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {activeWeights && (
                <div className="space-y-2">
                  {WEIGHT_VIEWS.map((view) => (
                    <div key={view} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-[0.71875rem] text-muted-foreground">
                        {WEIGHT_LABELS[view] ?? view.replace(/_/g, " ")}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={activeWeights.weights[view] ?? 0}
                        onChange={(e) => setWeight(view, Number(e.target.value))}
                        disabled={!canEdit}
                        className="h-1.5 flex-1 accent-[var(--primary)]"
                        aria-label={`${WEIGHT_LABELS[view] ?? view} weight`}
                      />
                      <span className="w-10 shrink-0 text-right text-[0.71875rem] tabular-nums text-foreground">
                        {Math.round((activeWeights.weights[view] ?? 0) * 100)}%
                      </span>
                    </div>
                  ))}
                  {(() => {
                    const total = Math.round(WEIGHT_VIEWS.reduce((s, v) => s + (activeWeights.weights[v] ?? 0), 0) * 100);
                    return (
                      <p className={`text-right text-[0.6875rem] tabular-nums ${total === 100 ? "text-muted-foreground" : "text-warning"}`}>
                        Total: {total}%{total !== 100 ? " — aim for 100% so scores stay comparable across roles" : ""}
                      </p>
                    );
                  })()}
                  {canEdit ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      {/* The only signal that a save happened: the request used
                          to fire and nothing on the page changed. */}
                      <p role="status" aria-live="polite" className="mr-auto text-[0.6875rem] text-success">
                        {weightsSaved}
                      </p>
                      <Button variant="outline" size="xs" onClick={handleRevertWeights} disabled={weightsSaving || !activeWeights.customized}>
                        Revert to built-in weights
                      </Button>
                      <Button size="xs" onClick={handleSaveWeights} disabled={weightsSaving}>
                        {weightsSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save weights"}
                      </Button>
                    </div>
                  ) : (
                    // "Adjust weights" on a graph node sends developers here,
                    // where every slider is disabled and both buttons are gone,
                    // with nothing saying why (audit §20.1 dead end).
                    <p className="pt-1 text-[0.6875rem] text-muted-foreground">
                      Read-only for your tier — these are the weights your criticality scores are
                      computed with. Only owners and admins can change them; ask one of them if a
                      signal is weighted wrong for your work.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ),
    },
    {
      id: "settings-llm",
      label: "LLM & privacy",
      children: (
        <>
          <Card data-tour="settings-privacy">
            <CardContent className="p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <h3 className="text-xs font-medium text-foreground">AI &amp; privacy</h3>
              </div>
              <div
                className="space-y-1.5"
                role="radiogroup"
                aria-label="Privacy mode"
                onKeyDown={(e) => {
                  if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key)) return;
                  e.preventDefault();
                  const currentIndex = PRIVACY_MODES.findIndex((m) => m.key === privacyMode);
                  const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
                  const nextIndex = (currentIndex + dir + PRIVACY_MODES.length) % PRIVACY_MODES.length;
                  const next = PRIVACY_MODES[nextIndex];
                  if (!next) return;
                  setPrivacyMode(next.key);
                  radioRefs.current[nextIndex]?.focus();
                }}
              >
                {PRIVACY_MODES.map((mode, i) => (
                  <button
                    key={mode.key}
                    ref={(el) => { radioRefs.current[i] = el; }}
                    type="button"
                    role="radio"
                    aria-checked={privacyMode === mode.key}
                    tabIndex={privacyMode === mode.key ? 0 : -1}
                    disabled={!canEdit}
                    onClick={() => setPrivacyMode(mode.key)}
                    className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                      privacyMode === mode.key
                        ? "border-primary/50 bg-primary/5"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <span
                      className={`mt-0.5 h-3 w-3 shrink-0 rounded-full border-2 ${
                        privacyMode === mode.key ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`}
                    />
                    <span>
                      <span className="block text-xs font-medium text-foreground">{mode.label}</span>
                      <span className="block text-[0.6875rem] text-muted-foreground">{mode.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="analysis-depth" className="text-xs">Analysis depth</Label>
                  <Select value={analysisDepth} onValueChange={setAnalysisDepth} disabled={!canEdit}>
                    <SelectTrigger id="analysis-depth" className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue className="truncate" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cheap">Cheap — fewest LLM calls</SelectItem>
                      <SelectItem value="standard">Standard — balanced</SelectItem>
                      <SelectItem value="full">Full — every eligible symbol</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="analysis-model" className="text-xs">Analysis model</Label>
                  <Select value={analysisModel} onValueChange={setAnalysisModel} disabled={!canEdit}>
                    <SelectTrigger id="analysis-model" className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue className="truncate" /></SelectTrigger>
                    <SelectContent>
                      {SELECTABLE_MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <Shield className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Read-only access · secrets filtered · no full repository stored. The mode used for a
                  run is stamped on that analysis, so older results keep the promise they were made under.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <h3 className="mb-1 text-xs font-medium text-foreground">Project LLM API key</h3>
              <p className="mb-2 text-[0.6875rem] text-muted-foreground">
                Bring your own OpenRouter key for this project's AI calls. The key is encrypted, never
                shown again, and usage is visible to the whole team.
              </p>
              {keyInfoError ? (
                <div
                  className="flex items-center justify-between gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2"
                  role="alert"
                >
                  <p className="text-xs text-danger">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" />
                    Couldn&apos;t check whether a key is configured. Don&apos;t add one until this
                    loads — you could overwrite a key the team is already using.
                  </p>
                  <Button variant="outline" size="xs" className="shrink-0 gap-1.5" onClick={loadKeyInfo}>
                    <RefreshCw className="h-3 w-3" /> Retry
                  </Button>
                </div>
              ) : keyInfo?.exists ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-success/40 bg-success-soft px-3 py-2">
                  <p className="text-xs text-success">
                    Key configured{keyInfo.created_by ? ` by ${keyInfo.created_by}` : ""} — all AI calls use it.
                  </p>
                  {canEdit && (
                    <Button variant="outline" size="xs" onClick={handleRemoveKey} disabled={keySaving}>
                      Remove
                    </Button>
                  )}
                </div>
              ) : canEdit ? (
                <div className="flex gap-2">
                  <Label htmlFor="llm-api-key" className="sr-only">Project LLM API key</Label>
                  <Input
                    id="llm-api-key"
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="sk-or-…"
                    className="h-8 flex-1 text-[0.8125rem]"
                    autoComplete="off"
                  />
                  <Button size="sm" onClick={handleSaveKey} disabled={keySaving || !keyInput.trim()}>
                    {keySaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save key"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No project key — the server key is used.</p>
              )}
              {/* Same silent-mutation class as Save weights: PUT/DELETE fired and
                  the page said nothing either way (audit §20.3). */}
              {keySaved && (
                <p role="status" aria-live="polite" className="mt-1.5 text-[0.6875rem] text-success">{keySaved}</p>
              )}
            </CardContent>
          </Card>
        </>
      ),
    },
    // NOT gated on canEdit: this is a personal browser preference for this
    // project, so a developer who only reads the graphs still gets to choose
    // what their own click does.
    {
      id: "settings-viewing",
      label: "Viewing",
      children: (
        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">Graph clicks</h3>
            {(
              [
                { surface: "dependencies", label: "Dependency graph drill-down on click" },
                { surface: "architecture", label: "Architecture map drill-down on click" },
              ] as const
            ).map((pref) => (
              <div key={pref.surface}>
                <Label className="mt-3 block text-[0.6875rem] text-muted-foreground first:mt-0">
                  {pref.label}
                </Label>
                <div
                  className="mt-1 flex items-center rounded-lg border border-border bg-card p-0.5"
                  role="group"
                  aria-label={pref.label}
                >
                  {(
                    [
                      { on: true, label: "On" },
                      { on: false, label: "Off" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => chooseAutoDrill(pref.surface, opt.on)}
                      aria-pressed={autoDrill[pref.surface] === opt.on}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        autoDrill[pref.surface] === opt.on
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
              On: clicking a group or component opens it immediately. Off: a click selects it and the
              Open button in its details panel drills down.
            </p>
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
              Saved in this browser for you; not shared with the team.
            </p>
          </CardContent>
        </Card>
      ),
    },
    // Owner-only card, so the rail loses the whole section rather than pointing at
    // an empty one.
    ...(project.permission_tier === "owner"
      ? [
          {
            id: "settings-danger",
            label: "Danger zone",
            children: (
              <Card className="border-destructive/30">
                <CardContent className="p-3">
                  <div className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <h3 className="text-xs font-medium">Danger zone</h3>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-foreground">Delete project</p>
                      <p className="text-xs text-muted-foreground">
                        Permanently delete this project and all data.
                      </p>
                    </div>
                    <Button variant="destructive" size="xs" onClick={() => setDeleteOpen(true)}>
                      <Trash2 className="h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ),
          },
        ]
      : []),
  ];

  return (
    // `lg:h-full`: the shell's `<main>` has a definite height, so the page fills
    // it exactly and only the shell's column scrolls — which is what keeps the
    // header and the error banner on screen from anywhere in the settings.
    // Below lg the page is normal flow and `<main>` scrolls, as before.
    <div className="lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      {/* The band carries the inset so the header's divider touches both walls. */}
      <div className="border-b px-3 pt-3 sm:px-4 sm:pt-4 lg:px-5 lg:pt-5">
        <PageHeader
          className="mb-3"
          title="Project settings"
          subtitle="Analysis, privacy, budgets, and ranking configuration for this project."
          actions={<Badge variant="outline" className="text-[0.6875rem] capitalize">{project.permission_tier}</Badge>}
        />
      </div>

      {error && (
        // Outside the shell's scroller, so it stays a pinned row; the inset is
        // its own now that `<main>` is full-bleed.
        <div className="px-3 pt-3 sm:px-4 lg:px-5">
          <ErrorBanner ref={errorRef}>{error}</ErrorBanner>
        </div>
      )}

      <SettingsShell
        sections={sections}
        footer={
          // Always mounted for someone who can edit, disabled until there is
          // something to save: a bar that appears only once the form is dirty
          // leaves a reader who has not touched anything unable to see that
          // saving is how a change is committed here at all. Below admin there
          // is nothing to save, so the bar is absent rather than permanently
          // greyed. `saved` is not part of the enable condition but keeps the
          // "Saved!" flash on the button through the refetch that clears
          // `dirty` (ProjectLayout keeps the tab mounted during a background
          // refetch; only a first load shows the spinner).
          canEdit ? (
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {/* Cancel used to refetch settings only, so moved ranking sliders —
                  which live in `weightRoles`, not in settings — stayed moved. */}
              <Button
                variant="outline"
                size="sm"
                disabled={saving || !dirty}
                onClick={() => {
                  refetch();
                  loadWeights();
                  setKeyInput("");
                  setWeightsSaved("");
                  setKeySaved("");
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {saved ? "Saved!" : "Save changes"}
              </Button>
            </div>
          ) : undefined
        }
      />

      <AnalyzeDialog
        project={project}
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        onStarted={(jobId) => {
          registerSessionJob(jobId, { navigateOnDone: true });
          refetch();
        }}
      />

      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={(open) => { setDeleteOpen(open); if (!open) setDeleteError(""); }}
        title="Delete project"
        description={
          <>
            This action cannot be undone. Type{" "}
            <span className="font-mono font-medium text-foreground">{project.repo_name}</span> to confirm.
          </>
        }
        confirmWord={project.repo_name}
        confirmLabel="Delete permanently"
        pending={deleting}
        error={deleteError}
        onConfirm={handleDelete}
      />
    </div>
  );
}
