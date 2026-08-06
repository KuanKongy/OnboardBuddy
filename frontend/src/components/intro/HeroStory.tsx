import { CheckCircle2, ChevronRight, CircleDashed, GitBranch, Pause, Play } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { LogoMark } from "@/components/BrandLogo";
import {
  STORY_ANALYSIS_STEPS,
  STORY_CLUSTERS,
  STORY_EDGES,
  STORY_NODES,
  STORY_REPOS,
  STORY_SCENES,
  STORY_SR_DESCRIPTION,
  type StorySceneId,
} from "@/components/intro/heroStoryData";
import { Button } from "@/components/ui/button";
import { CLUSTER_KIND_LABELS, CLUSTER_KIND_PALETTE } from "@/lib/architectureData";
import { prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Which tab of the fake app window each scene "opens": the dependency graph
 *  belongs to Dependencies, the cluster map to Architecture and the walkthrough
 *  to Tutorials; import and analysis both happen on Overview. */
const SCENE_TAB: Record<StorySceneId, number> = {
  import: 0,
  analysis: 0,
  graph: 1,
  architecture: 2,
  tutorial: 3,
};

/** First scene of each tab's showcase, in SCENE_TAB's tab order: clicking a tab
 *  jumps there. Analysis has no own tab (it plays under Overview), so it is
 *  reachable from the dots and the loop only. */
const TAB_FIRST_SCENE = [0, 2, 3, 4] as const;

/**
 * The hero centerpiece: a five-scene product story on a ~15s loop, inside an
 * app-window frame. Progression is wall-clock timers ONLY (never transition
 * events, which reduced-motion collapses to 0.01ms), one timeout per
 * [playing, scene] so StrictMode's double mount cannot leak a second clock.
 *
 * The stage is aria-hidden decoration with an sr-only description beside it;
 * the interactive controls are the four window tabs, the five scene dots and
 * the pause button, all of them outside the stage. Census contract (e2e audit)
 * binds the STAGE only: nothing inside it may be a button, link, [title] or
 * [tabindex] element, every layer stays mounted, and the stage's rendered text
 * never changes while scenes play.
 */
export function HeroStory() {
  const [scene, setScene] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [docHidden, setDocHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const reduced = prefersReducedMotion();

  // Continuous in-view tracking (pause offscreen); jsdom counts as in view.
  useEffect(() => {
    if (!stageEl) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.25 },
    );
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, [stageEl]);

  useEffect(() => {
    const onVisibility = () => setDocHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const playing = !userPaused && !docHidden && inView && !reduced;

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(
      () => setScene((current) => (current + 1) % STORY_SCENES.length),
      STORY_SCENES[scene]!.duration,
    );
    return () => window.clearTimeout(id);
  }, [playing, scene]);

  const activeTab = SCENE_TAB[STORY_SCENES[scene]!.id];

  return (
    <div>
      <div className="relative mx-auto max-w-4xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-10 -bottom-8 -top-12 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 65% 60% at 50% 45%, color-mix(in oklab, #2659f4 14%, transparent), transparent 72%)",
          }}
        />
        <div className="overflow-hidden rounded-2xl border border-foreground/10 bg-card/85 shadow-2xl shadow-[#2659f4]/10 backdrop-blur-sm dark:border-white/10 dark:bg-card/70">
          {/* Four pills clip a 375px viewport at the desktop scale, so the row
              and the pills both shrink below sm. */}
          <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-2.5 dark:border-white/10 sm:gap-3">
            <LogoMark className="h-4 w-4" />
            <div className="flex items-center gap-1">
              {["Overview", "Dependencies", "Architecture", "Tutorials"].map((tab, i) => (
                <button
                  key={tab}
                  type="button"
                  data-active={i === activeTab || undefined}
                  onClick={() => setScene(TAB_FIRST_SCENE[i]!)}
                  className={cn(
                    "rounded-md px-1.5 py-1 text-[0.625rem] font-medium transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5 sm:text-[0.6875rem]",
                    i === activeTab
                      ? "bg-accent/70 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <span className="ml-auto hidden font-mono text-[0.6875rem] text-muted-foreground sm:block">
              {STORY_REPOS[0]} @ main
            </span>
          </div>

          <div
            ref={setStageEl}
            aria-hidden="true"
            data-scene={STORY_SCENES[scene]!.id}
            className="story-stage aspect-[16/10] w-full select-none sm:aspect-[16/9]"
          >
            <div className="story-layer" data-for="import">
              <ImportScene />
            </div>
            <div className="story-layer" data-for="analysis">
              <AnalysisScene />
            </div>
            <div className="story-layer" data-for="architecture">
              <ClusterCards />
            </div>
            <div className="story-layer" data-for="graph architecture">
              <GraphLayer />
            </div>
            <div className="story-layer" data-for="tutorial">
              <TutorialScene />
            </div>
          </div>
        </div>
      </div>

      <p className="sr-only">{STORY_SR_DESCRIPTION}</p>

      <div className="mt-6 text-center">
        <div className="grid justify-items-center">
          {STORY_SCENES.map((s, i) => (
            <p
              key={s.id}
              data-active={i === scene || undefined}
              className="story-caption col-start-1 row-start-1 max-w-md text-[0.8125rem] text-muted-foreground"
            >
              <span className="font-medium text-foreground">{s.title}.</span> {s.caption}
            </p>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            {STORY_SCENES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Scene ${i + 1}: ${s.title}`}
                aria-current={i === scene || undefined}
                onClick={() => setScene(i)}
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  i === scene ? "w-6 bg-primary" : "w-2 bg-foreground/20 hover:bg-foreground/40",
                )}
              />
            ))}
          </div>
          {!reduced && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-pressed={userPaused}
              aria-label={userPaused ? "Play story" : "Pause story"}
              onClick={() => setUserPaused((paused) => !paused)}
              className="text-muted-foreground hover:text-foreground"
            >
              {userPaused ? (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Scene A: the import wizard, miniature ──────────────────────────────── */

function ImportScene() {
  return (
    <SceneCenter>
      <div className="w-full max-w-xs rounded-xl border border-foreground/10 bg-background/60 p-4 shadow-sm dark:border-white/10">
        <p className="text-[0.8125rem] font-semibold text-foreground">Import a repository</p>
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
          Step 1 of 2: connect a GitHub repository
        </p>
        <div className="mt-3 space-y-1.5">
          {STORY_REPOS.map((repo, i) => (
            <div
              key={repo}
              className={cn(
                "flex items-center gap-2 rounded-md border border-foreground/10 px-2.5 py-1.5 dark:border-white/10",
                i === 0 && "story-row-select",
              )}
            >
              <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1 truncate font-mono text-[0.6875rem] text-foreground">{repo}</span>
              {i === 0 ? <ChevronRight className="h-3 w-3 text-primary" aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
        {/* A div dressed as the primary button: real buttons are banned inside
            the stage (census). The press animation stands in for the click. */}
        <div className="story-press mt-3 rounded-md bg-primary px-3 py-1.5 text-center text-[0.75rem] font-medium text-primary-foreground shadow-sm">
          Start analysis
        </div>
      </div>
    </SceneCenter>
  );
}

/* ── Scene B: the pipeline checklist ────────────────────────────────────── */

function AnalysisScene() {
  return (
    <SceneCenter>
      <div className="w-full max-w-sm">
        <p className="mb-3 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
          Analyzing {STORY_REPOS[0]}
        </p>
        <div className="space-y-2">
          {STORY_ANALYSIS_STEPS.map((step, i) => (
            <div
              key={step.phaseKey}
              className="story-tick flex items-center gap-2.5"
              style={{ "--i": i } as CSSProperties}
            >
              <span className="relative h-4 w-4 shrink-0">
                <CircleDashed
                  className="story-tick-pending absolute inset-0 h-4 w-4 text-muted-foreground/50"
                  aria-hidden="true"
                />
                <CheckCircle2
                  className="story-tick-done absolute inset-0 h-4 w-4 text-success"
                  aria-hidden="true"
                />
              </span>
              <span className="text-[0.8125rem] text-foreground">{step.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted">
          <div className="story-bar-fill h-full w-full rounded-full bg-primary" />
        </div>
      </div>
    </SceneCenter>
  );
}

/* ── Scenes C + D: the shared chips-and-edges layer and the cluster cards ── */

function GraphLayer() {
  const centers = new Map(STORY_NODES.map((node) => [node.id, node.g]));
  return (
    <div className="absolute inset-0">
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="story-edges absolute inset-0 h-full w-full"
      >
        {STORY_EDGES.map((edge, i) => {
          const from = centers.get(edge.from)!;
          const to = centers.get(edge.to)!;
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              className="story-edge"
              d={`M${from.x} ${from.y} L${to.x} ${to.y}`}
              pathLength={1}
              fill="none"
              stroke="color-mix(in oklab, var(--foreground) 30%, transparent)"
              strokeWidth="1.25"
              vectorEffect="non-scaling-stroke"
              style={{ "--i": i } as CSSProperties}
            />
          );
        })}
      </svg>
      {STORY_NODES.map((node, i) => (
        <div
          key={node.id}
          className="story-chip"
          style={
            {
              "--gx": `${node.g.x}%`,
              "--gy": `${node.g.y}%`,
              "--ax": `${node.a.x}%`,
              "--ay": `${node.a.y}%`,
            } as CSSProperties
          }
        >
          <div
            className="story-chip-body flex items-center gap-1.5 rounded-md border bg-card px-1.5 py-1 shadow-sm"
            style={{ "--i": i, borderColor: `color-mix(in oklab, var(--node-${node.token}) 45%, transparent)` } as CSSProperties}
          >
            {node.entry ? (
              <span
                aria-hidden="true"
                className="text-[0.5rem] leading-none"
                style={{ color: `var(--node-${node.token})` }}
              >
                ▶
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: `var(--node-${node.token})` }}
              />
            )}
            <span className="whitespace-nowrap font-mono text-[0.5625rem] leading-none text-foreground">
              {node.file}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClusterCards() {
  return (
    <div className="absolute inset-0">
      {STORY_CLUSTERS.map((cluster, i) => {
        const token = CLUSTER_KIND_PALETTE[cluster.kind];
        return (
          <div
            key={cluster.kind}
            className="story-rise absolute rounded-lg border"
            style={
              {
                "--i": i,
                left: `${cluster.box.x}%`,
                top: `${cluster.box.y}%`,
                width: `${cluster.box.w}%`,
                height: `${cluster.box.h}%`,
                borderColor: `color-mix(in oklab, var(--node-${token}) 40%, transparent)`,
                background: `color-mix(in oklab, var(--node-${token}) 7%, transparent)`,
              } as CSSProperties
            }
          >
            <div className="flex items-center gap-1.5 px-2.5 pt-2">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: `var(--node-${token})` }}
              />
              <span className="text-[0.625rem] font-semibold text-foreground">
                {CLUSTER_KIND_LABELS[cluster.kind]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Scene E: a walkthrough tutorial opens ──────────────────────────────── */

const TUTORIAL_LINES = [
  { code: "const token = req.cookies.session;", highlight: false },
  { code: "const session = await verifySession(token);", highlight: true },
  { code: "if (!session) return res.status(401).end();", highlight: true },
  { code: "req.user = await loadUser(session.userId);", highlight: false },
];

function TutorialScene() {
  return (
    <SceneCenter>
      <div className="w-full max-w-md rounded-xl border border-foreground/10 bg-background/60 p-4 shadow-sm dark:border-white/10">
        <div className="story-rise" style={{ "--i": 0 } as CSSProperties}>
          <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-primary">
            Tutorial &middot; walkthrough
          </p>
          <p className="mt-0.5 text-[0.8125rem] font-semibold text-foreground">Authentication flow</p>
          <p className="text-[0.6875rem] text-muted-foreground">Follow one real path through the code.</p>
        </div>
        <div
          className="story-rise mt-3 overflow-hidden rounded-md border border-foreground/10 font-mono text-[0.625rem] leading-relaxed dark:border-white/10"
          style={{ "--i": 1 } as CSSProperties}
        >
          {TUTORIAL_LINES.map((line, i) => (
            <div
              key={line.code}
              className={cn(
                "flex gap-2 px-2.5 py-0.5",
                line.highlight ? "bg-primary/10 text-foreground" : "text-muted-foreground",
              )}
            >
              <span className="w-4 shrink-0 text-right text-muted-foreground/60">{i + 51}</span>
              <span className="whitespace-pre">{line.code}</span>
            </div>
          ))}
        </div>
        <div className="story-rise mt-3 flex flex-wrap gap-1.5" style={{ "--i": 2 } as CSSProperties}>
          {["auth.ts:52", "routes.ts:24", "db.ts:118"].map((ref) => (
            <span
              key={ref}
              className="rounded-md border border-foreground/15 bg-muted/40 px-1.5 py-0.5 font-mono text-[0.625rem] text-foreground dark:border-white/15"
            >
              {ref}
            </span>
          ))}
        </div>
      </div>
    </SceneCenter>
  );
}

function SceneCenter({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 flex items-center justify-center p-6">{children}</div>;
}
