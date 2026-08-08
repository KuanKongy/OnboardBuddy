import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  MoreVertical,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDangerDialog } from "@/components/ConfirmDangerDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, apiFetch } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { pipelineProgress, type PipelineJobLite } from "@/lib/pipelineProgress";

export interface Project {
  id: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
  status: "idle" | "analyzing" | "complete" | "failed";
  permission_tier: string;
  developer_role: string;
  stale_count: number;
  created_at?: string | null;
  last_analyzed_at: string | null;
  /** GitHub repo metadata (fetched at import, refreshed on every analysis run). */
  repo_description?: string | null;
  primary_language?: string | null;
  repo_pushed_at?: string | null;
  /**
   * Top languages from the latest analysis snapshot, most files first. Empty or
   * absent when the project has never been analyzed, which is why the render
   * still falls back to `primary_language`.
   */
  languages?: string[];
}

const defaultStatus = {
  label: "Ready",
  progress: 0,
  tone: "text-muted-foreground",
  bar: "bg-muted-foreground/40",
  icon: CircleDashed,
  hint: "This project hasn't been analyzed yet.",
};
const statusConfig = {
  idle: defaultStatus,
  analyzing: {
    label: "In Progress",
    progress: 45,
    tone: "text-primary",
    bar: "bg-primary",
    icon: Loader2,
    hint: "One or more analysis runs are in progress: the repository is being parsed and its onboarding content generated.",
  },
  complete: {
    label: "Complete",
    progress: 100,
    tone: "text-success",
    bar: "bg-success",
    icon: CheckCircle2,
    hint: "The repository has been parsed and its onboarding content generated.",
  },
  failed: {
    label: "Failed",
    progress: 0,
    tone: "text-destructive",
    bar: "bg-destructive",
    icon: XCircle,
    hint: "Analysis hit an error and did not finish.",
  },
};

const tierColors: Record<string, string> = {
  owner: "bg-warning-soft text-warning border-warning/30",
  admin: "bg-info/15 text-info border-info/30",
  contributor: "bg-muted text-muted-foreground border-border",
  developer: "bg-muted text-muted-foreground border-border",
};

/** GitHub's linguist colors for the languages we're likely to meet. */
const languageColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  "C#": "#178600",
  "C++": "#f34b7d",
  C: "#555555",
  Ruby: "#701516",
  PHP: "#4F5D95",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Vue: "#41b883",
  Dart: "#00B4AB",
};

export function ProjectCard({
  project,
  onDeleted,
}: {
  project: Project;
  onDeleted?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const status = statusConfig[project.status] ?? defaultStatus;
  const StatusIcon = status.icon;
  // `DELETE /api/projects/:id` is owner-only, so an admin's menu item could only
  // ever 403. Delete is the menu's one item, so the gate is on the whole menu.
  const canDelete = project.permission_tier === "owner";

  // While analyzing, show the SAME combined pipeline % and stage as the
  // project overview page (bug: the card showed a hardcoded 45%). With
  // concurrent runs the card tracks the newest active one and counts the rest.
  const [liveJob, setLiveJob] = useState<PipelineJobLite | null>(null);
  const [extraActiveRuns, setExtraActiveRuns] = useState(0);
  // A failed check must not leave the card saying "Checking run status…"
  // forever, and a 404/403 (project or access gone) must stop the poll
  // instead of re-requesting a dead project every 6s until unmount.
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  useEffect(() => {
    if (project.status !== "analyzing") {
      setLiveJob(null);
      setExtraActiveRuns(0);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const load = () => {
      apiFetch(`/projects/${project.id}/analysis-status`)
        .then((data: { jobs: Array<PipelineJobLite & { status?: string }> }) => {
          if (cancelled) return;
          const active = (data.jobs ?? []).filter((j) => j.status === "queued" || j.status === "running");
          setLiveJob(active[0] ?? data.jobs?.[0] ?? null);
          setExtraActiveRuns(Math.max(0, active.length - 1));
          setStatusUnavailable(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setStatusUnavailable(true);
          if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
            window.clearInterval(timer);
          }
        });
    };
    load();
    timer = window.setInterval(load, 6000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [project.id, project.status]);

  const live = pipelineProgress(liveJob);
  const analyzing = project.status === "analyzing";
  const progressValue = analyzing && liveJob ? live.pct : status.progress;

  /**
   * One run, one set of words.
   *
   * The same run read "Generating onboarding 93%" on the dashboard, "Analyzing
   * 0%" in the project list and "In Progress" on the chip beside both. Two
   * separate faults produced that. The chip carried a status word from a fixed
   * table while the line next to it carried the live pipeline stage, so the two
   * halves of one card never used the same vocabulary; and before the first
   * `/analysis-status` response landed, `pipelineProgress(null)` returned 0 and
   * the card printed "Analyzing 0%" as though it were a measurement — which is
   * why a freshly opened list disagreed with a dashboard that had been polling
   * for a minute.
   *
   * Now the stage IS the status word while a run is live, the percentage is
   * printed once beside it, and an unknown percentage says it is unknown.
   */
  // Paired with the separator pipelineProgress writes into `stageLabel`: the
  // two have to move together, or this split misses and the chip carries the
  // whole "Analyzing code · reading files" sentence instead of the stage word.
  const stageToken = live.stageLabel ? live.stageLabel.split(" · ")[0]! : null;
  const statusLabel = analyzing ? stageToken ?? status.label : status.label;
  const progressText = !analyzing
    ? ""
    : liveJob
      ? `${live.pct}%${extraActiveRuns > 0 ? ` · +${extraActiveRuns} more run${extraActiveRuns > 1 ? "s" : ""}` : ""}`
      : statusUnavailable
        ? "Couldn't check run status"
        : "Checking run status…";

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
      onDeleted?.(project.id);
      setDeleteDialogOpen(false);
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete the project");
    } finally {
      setDeleting(false);
    }
  }

  const openProject = () => navigate(`/projects/${project.id}`);
  const updatedAt = project.repo_pushed_at ?? project.last_analyzed_at ?? project.created_at ?? null;
  const langs = project.languages?.length
    ? project.languages
    : project.primary_language
      ? [project.primary_language]
      : [];

  return (
    <>
    {/* The whole card opens the project (like a GitHub repo card), and the
        card body is a clickable div rather than a stretched link. A stretched
        link is a transparent anchor covering the card, and covered text can't
        be drag-selected: every pointer event belongs to the overlay, not the
        text under it. The description is the one line on this card people want
        to copy, so nothing covers it now — `select-text` holds, and the
        onClick bails when the mouseup merely finished a selection.

        The repo name is the one real link: it carries the href, the
        accessible name and the `title`, so middle-click, cmd-click and the
        browser's own context menu still offer "open in new tab" from the
        obvious target, and it underlines on its own hover rather than the
        whole card's.

        The onClick's guards, in order: a click that started on a link or a
        button (the name, the menu trigger) belongs to that element, and its
        click bubbles up here, so without the guard one click would navigate
        twice; and a mouseup that merely finished a selection is not a click
        on the card. With no overlay left, this handler is the only thing that
        opens the project from the description or the metadata row — in jsdom,
        where a click lands on whatever element it names, and in a browser,
        where it lands on whatever is under the pointer. */}
    <Card
      onClick={(e) => {
        if ((e.target as Element).closest("a,button")) return;
        if (window.getSelection()?.toString()) return;
        openProject();
      }}
      // h-full + column flex, with the meta half pinned via mt-auto below: in a
      // grid the tallest description used to set the row height and every other
      // card floated its progress bar and metadata at a different y. The slack
      // now opens above the meta block instead of between the cards.
      className="group flex h-full cursor-pointer select-text flex-col transition-colors focus-within:border-primary/40 hover:border-primary/40"
    >
      <CardContent className="flex flex-1 flex-col p-3">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold">
                <Link
                  to={`/projects/${project.id}`}
                  aria-label={`Open ${project.repo_owner}/${project.repo_name}`}
                  title={project.repo_name}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {project.repo_name}
                </Link>
              </h3>
              <Badge className={`text-[0.6875rem] ${tierColors[project.permission_tier] ?? tierColors.developer}`} variant="outline">
                {project.permission_tier.toUpperCase()}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <StatusIcon
              className={`h-4 w-4 ${status.tone} ${project.status === "analyzing" ? "animate-spin" : ""}`}
            />
            {canDelete && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Project actions" onClick={(e) => e.stopPropagation()}>
                    <MoreVertical className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteError(""); setDeleteDialogOpen(true); }}>
                    <Trash2 className="h-3 w-3" />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Unclamped: the cards are equal height regardless now, so truncating
            the one line people read here bought nothing. The `title` went with
            the clamp — a tooltip repeating text already fully visible. */}
        <p className="mb-2 text-xs leading-snug text-muted-foreground">
          {project.repo_description ?? ""}
        </p>

        <div className="mt-auto mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 shrink truncate tabular-nums text-muted-foreground">{progressText}</span>
          <Tooltip>
            {/* A Badge, not an underlined span — a dotted underline reads as a link
                and "Complete" navigates nowhere. Still focusable, since the tooltip
                is the only place the hint lives. */}
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                tabIndex={0}
                className={`min-w-0 shrink-0 cursor-help truncate text-[0.6875rem] ${status.tone}`}
              >
                {statusLabel}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">{status.hint}</TooltipContent>
          </Tooltip>
        </div>

        <Progress value={progressValue} indicatorClassName={status.bar} className="mb-2.5 h-1" />

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex min-w-0 items-center gap-3">
            {/* Three names have to share the slack the single primary language
                used to have to itself, so each one shrinks and truncates like
                the rest of the row rather than pushing "Updated …" off the
                card. The dot keeps its size through that. */}
            {langs.slice(0, 3).map((lang) => {
              const dot = languageColors[lang];
              return (
                <span key={lang} className="flex min-w-0 shrink items-center gap-1.5 text-muted-foreground">
                  <span
                    aria-hidden
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot ? "" : "bg-muted-foreground/60"}`}
                    style={dot ? { backgroundColor: dot } : undefined}
                  />
                  <span className="truncate">{lang}</span>
                </span>
              );
            })}
            <span className="shrink-0 text-muted-foreground">
              STALE <span className={project.stale_count > 0 ? "font-semibold text-warning" : "font-semibold text-foreground"}>{project.stale_count}</span>
            </span>
          </div>
          {updatedAt && (
            <span className="shrink-0 truncate text-muted-foreground">Updated {timeAgo(updatedAt)}</span>
          )}
        </div>
      </CardContent>
    </Card>

      {/* Same guard as the settings page's danger zone, for the same delete. */}
      <ConfirmDangerDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete project"
        description={
          <>
            Deleting <strong className="text-foreground">{project.repo_owner}/{project.repo_name}</strong>{" "}
            removes all analyses and onboarding content and cannot be undone. Type{" "}
            <span className="font-mono font-medium text-foreground">{project.repo_name}</span> to confirm.
          </>
        }
        confirmWord={project.repo_name}
        confirmLabel="Delete permanently"
        pending={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
      />
    </>
  );
}
