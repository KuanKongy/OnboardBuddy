import { AlertTriangle, GitBranch, Loader2, RefreshCw, Save, Shield, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "@/contexts/ProjectContext";
import { usePackages } from "@/contexts/PackagesContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { PageHeader } from "@/components/PageHeader";
import { apiFetch } from "@/lib/api";

export const PRIVACY_MODES = [
  { key: "full_ai", label: "Full AI", hint: "Code snippets + facts go to the LLM — best quality." },
  { key: "facts_only_ai", label: "Facts-only AI", hint: "No code leaves the system — only extracted facts and structure." },
  { key: "ai_disabled", label: "AI disabled", hint: "No LLM calls at all; deterministic outputs only." },
];

// Must match the backend's SEMANTIC_VIEWS keys exactly — the old short names
// ("runtime") never matched the API's "critical_for_runtime" keys, so every
// slider showed 0 and saves were rejected.
const WEIGHT_VIEWS = [
  "critical_for_runtime", "critical_for_business", "critical_for_onboarding",
  "critical_for_role", "critical_for_change_risk", "critical_for_architecture",
  "critical_for_workflow",
] as const;

// Mirrors backend SELECTABLE_MODELS (ai/modelTiers.ts) — the vetted model
// choices; one selection drives both chat tiers.
const DEFAULT_ANALYSIS_MODEL = "google/gemini-2.5-flash-lite";
const SELECTABLE_MODELS: Array<{ id: string; label: string }> = [
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite (default — fast, 1M context)" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash (1M context)" },
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

export function ProjectSettingsPage() {
  const { project, refetch } = useProject();
  const { registerSessionJob } = usePackages();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [ignoredPaths, setIgnoredPaths] = useState("");
  const [defaultRole, setDefaultRole] = useState("general");
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
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // BYO LLM key
  const [keyInfo, setKeyInfo] = useState<{ exists: boolean; created_by?: string | null; updated_at?: string } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);

  // Ranking weights
  const [weightRoles, setWeightRoles] = useState<RoleWeights[] | null>(null);
  const [weightRole, setWeightRole] = useState("backend");
  const [weightsSaving, setWeightsSaving] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const canEdit =
    project?.permission_tier === "owner" || project?.permission_tier === "admin";

  useEffect(() => {
    if (project?.settings) {
      setIgnoredPaths(project.settings.ignored_paths.join("\n"));
      setDefaultRole(project.settings.default_developer_role);
      setPrivacyMode(project.settings.privacy_mode ?? "full_ai");
      setAnalysisDepth((project.settings as { analysis_depth?: string }).analysis_depth ?? "standard");
      const tierOverrides = (project.settings as { model_tier_overrides?: Record<string, string[]> }).model_tier_overrides ?? {};
      setAnalysisModel(tierOverrides.cheap?.[0] ?? DEFAULT_ANALYSIS_MODEL);
      setFileLimit(project.settings.file_limit != null ? String(project.settings.file_limit) : "");
      setLocLimit(project.settings.loc_limit != null ? String(project.settings.loc_limit) : "");
      const budgets = (project.settings as { budget_overrides?: Record<string, number> }).budget_overrides ?? {};
      setBudgetCalls(budgets.max_llm_calls ? String(budgets.max_llm_calls) : "");
      setBudgetTokens(budgets.max_input_tokens ? String(budgets.max_input_tokens) : "");
      setStopBehavior((project.settings as { budget_stop_behavior?: string }).budget_stop_behavior ?? "pause");
      setAutoReanalyze((project.settings as { auto_reanalyze_on_push?: boolean }).auto_reanalyze_on_push ?? false);
    }
  }, [project]);

  // Surface a save/delete/etc. failure wherever the user currently is on
  // this long page — the banner renders right under the header, easy to
  // miss from a bottom-of-page action.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  useEffect(() => {
    if (!id) return;
    apiFetch(`/projects/${id}/llm-key`).then((data) => setKeyInfo(data.key)).catch(() => {});
    apiFetch(`/projects/${id}/ranking-weights`).then((data) => setWeightRoles(data.roles)).catch(() => {});
  }, [id]);

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
    try {
      await apiFetch(`/projects/${id}/llm-key`, {
        method: "PUT",
        body: JSON.stringify({ api_key: keyInput.trim() }),
      });
      setKeyInput("");
      const data = await apiFetch(`/projects/${id}/llm-key`);
      setKeyInfo(data.key);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setKeySaving(false);
    }
  }

  async function handleRemoveKey() {
    setKeySaving(true);
    try {
      await apiFetch(`/projects/${id}/llm-key`, { method: "DELETE" });
      setKeyInfo({ exists: false });
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
    try {
      await apiFetch(`/projects/${id}/ranking-weights/${weightRole}`, {
        method: "PUT",
        body: JSON.stringify({ weights: activeWeights.weights }),
      });
      const data = await apiFetch(`/projects/${id}/ranking-weights`);
      setWeightRoles(data.roles);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save weights");
    } finally {
      setWeightsSaving(false);
    }
  }

  async function handleRevertWeights() {
    setWeightsSaving(true);
    try {
      await apiFetch(`/projects/${id}/ranking-weights/${weightRole}`, { method: "DELETE" });
      const data = await apiFetch(`/projects/${id}/ranking-weights`);
      setWeightRoles(data.roles);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to revert weights");
    } finally {
      setWeightsSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await apiFetch(`/projects/${id}`, { method: "DELETE" });
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  if (!project) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Project settings"
        subtitle="Analysis, privacy, budgets, and ranking configuration for this project."
        actions={<Badge variant="outline" className="text-[0.6875rem] capitalize">{project.permission_tier}</Badge>}
      />

      {error && (
        <div
          ref={errorRef}
          className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-3">
        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">Repository &amp; branch</h3>
            <div className="space-y-1.5">
              <div>
                <Label className="text-[0.6875rem] text-muted-foreground">Repository</Label>
                <p className="text-xs text-foreground">{project.repo_owner}/{project.repo_name}</p>
              </div>
              <div>
                <Label className="text-[0.6875rem] text-muted-foreground">Branch</Label>
                <div className="flex items-center gap-1 text-xs text-foreground">
                  <GitBranch className="h-3 w-3 text-muted-foreground" />
                  {project.branch}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <h3 className="mb-2 text-xs font-medium text-foreground">Default developer role</h3>
            <Select value={defaultRole} onValueChange={setDefaultRole} disabled={!canEdit}>
              <SelectTrigger className="h-8 text-[0.8125rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="backend">Backend</SelectItem>
                <SelectItem value="frontend">Frontend</SelectItem>
                <SelectItem value="devops">DevOps</SelectItem>
                <SelectItem value="qa">QA</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>
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
                <Label className="text-xs">Analysis depth</Label>
                <Select value={analysisDepth} onValueChange={setAnalysisDepth} disabled={!canEdit}>
                  <SelectTrigger className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue className="truncate" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cheap">Cheap — fewest LLM calls</SelectItem>
                    <SelectItem value="standard">Standard — balanced</SelectItem>
                    <SelectItem value="full">Full — every eligible symbol</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="text-xs">Analysis model</Label>
                <Select value={analysisModel} onValueChange={setAnalysisModel} disabled={!canEdit}>
                  <SelectTrigger className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue className="truncate" /></SelectTrigger>
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
            <h3 className="mb-2 text-xs font-medium text-foreground">Analysis budget</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Max LLM calls</Label>
                <Input
                  type="number"
                  value={budgetCalls}
                  onChange={(e) => setBudgetCalls(e.target.value)}
                  placeholder={`default: ${DEPTH_BUDGET_DEFAULTS[analysisDepth]?.calls ?? 300}`}
                  disabled={!canEdit}
                  className="h-8 text-[0.8125rem]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max input tokens</Label>
                <Input
                  type="number"
                  value={budgetTokens}
                  onChange={(e) => setBudgetTokens(e.target.value)}
                  placeholder={`default: ${(DEPTH_BUDGET_DEFAULTS[analysisDepth]?.tokens ?? 4_000_000).toLocaleString()}`}
                  disabled={!canEdit}
                  className="h-8 text-[0.8125rem]"
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="text-xs">When exceeded</Label>
                <Select value={stopBehavior} onValueChange={setStopBehavior} disabled={!canEdit}>
                  <SelectTrigger className="h-8 w-full min-w-0 text-[0.8125rem]"><SelectValue className="truncate" /></SelectTrigger>
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
            <h3 className="mb-1 text-xs font-medium text-foreground">Project LLM API key</h3>
            <p className="mb-2 text-[0.6875rem] text-muted-foreground">
              Bring your own OpenRouter key for this project's AI calls. The key is encrypted, never
              shown again, and usage is visible to the whole team.
            </p>
            {keyInfo?.exists ? (
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
                <Input
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
            <Select value={weightRole} onValueChange={setWeightRole}>
              <SelectTrigger className="mb-3 h-8 w-[180px] text-[0.8125rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(weightRoles ?? []).map((r) => (
                  <SelectItem key={r.role} value={r.role} className="capitalize">{r.role}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                {canEdit && (
                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" size="xs" onClick={handleRevertWeights} disabled={weightsSaving || !activeWeights.customized}>
                      Revert to defaults
                    </Button>
                    <Button size="xs" onClick={handleSaveWeights} disabled={weightsSaving}>
                      {weightsSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save weights"}
                    </Button>
                  </div>
                )}
              </div>
            )}
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
                <Label className="text-xs">Max files</Label>
                <Input
                  type="number"
                  value={fileLimit}
                  onChange={(e) => setFileLimit(e.target.value)}
                  placeholder="unchanged if blank"
                  disabled={!canEdit}
                  className="h-8 text-[0.8125rem]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max lines of code</Label>
                <Input
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

        {project.permission_tier === "owner" && (
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
        )}
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={() => refetch()}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {saved ? "Saved!" : "Save changes"}
          </Button>
        </div>
      )}

      <AnalyzeDialog
        project={project}
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        onStarted={(jobId) => {
          registerSessionJob(jobId, { navigateOnDone: true });
          refetch();
        }}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteConfirm("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete project</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            This action cannot be undone. Type <span className="font-mono font-medium text-foreground">{project.repo_name}</span> to confirm.
          </p>
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={project.repo_name}
            className="h-8 text-[0.8125rem]"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => { setDeleteOpen(false); setDeleteConfirm(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteConfirm !== project.repo_name || deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="h-3 w-3 animate-spin" />}
              Delete permanently
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
