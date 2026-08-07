import {
  ArrowDown,
  Check,
  ChevronDown,
  Code2,
  Copy,
  CornerDownRight,
  DoorOpen,
  ExternalLink,
  FileCode2,
  FlagTriangleRight,
  KeyRound,
  Layers,
  Terminal,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CodeSnippet, type HighlightRange } from "@/components/CodeSnippet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { buildGithubBlobUrl, type GithubRepoRef } from "@/lib/githubUrl";
import { scrollBehavior } from "@/lib/motion";

/**
 * A walkthrough is ONE SCROLLING DOCUMENT, not a one-step-at-a-time pager.
 *
 * The owner's verdict on the previous shape was "it used to be minimal, now it
 * has what you should see, check it worked, the do this — it is strange", and
 * what he asked for instead is exact: *"code and it highlighted the important
 * lines, while explaining what it does, what is happening with handoff to next
 * step."* So a card here is a snippet with its important lines lit, two or
 * three sentences underneath, and a connector carrying one sentence about how
 * control reaches the next card. Nothing else.
 *
 * The scroll is load-bearing rather than cosmetic: a path has a shape, and a
 * pager hides it behind one card at a time. Phases (one per leg of a composed
 * journey) are section headers with their own sub-step folds, so a four-stage
 * pipeline reads as four stages — the direct answer to "the onboarding package
 * generation is just 2 steps. Maybe you should think about it as a pipeline."
 *
 * The Do/See/Check triptych is NOT deleted; it moved to the how-to group,
 * where action / expected / verify is the correct shape for a runbook.
 */

export interface WalkthroughHighlight {
  start: number;
  end: number;
  source: string;
  label: string;
}

export interface WalkthroughHandoff {
  text: string;
  /** `call`, or whatever boundary vocabulary the composer emitted. */
  kind: string;
  toStep: number;
  toSymbol: string | null;
  toFile: string | null;
  source: string;
}

export interface WalkthroughPhase {
  index: number;
  count: number;
  title: string;
  member: string;
}

/**
 * How the path is entered, stated on the first card.
 *
 * `command` is present on exactly one entry kind — an HTTP route — because
 * that is the only one a reader can set off by hand. A socket or queue handler
 * names the publishing call sites instead: those, not a request, are its door.
 */
export interface WalkthroughEntry {
  kind: string;
  text: string;
  command?: string | null;
  token?: string | null;
  emitters?: Array<{ filePath: string; symbolName: string | null; lineStart: number | null }> | null;
}

export interface WalkthroughStepData {
  id: string;
  step_order: number;
  file_path: string;
  symbol_name: string | null;
  line_start: number | null;
  line_end: number | null;
  snippet: string | null;
  /** The narration. Persisted on `explanation` so pre-v4 readers keep working. */
  explanation: string;
  role?: string | null;
  phase?: WalkthroughPhase | null;
  highlights?: WalkthroughHighlight[];
  window?: { start: number; end: number } | null;
  handoff?: WalkthroughHandoff | null;
  landing?: string | null;
  boundary?: { kind: string; detail: string } | null;
  entry?: WalkthroughEntry | null;
  narration_source?: string | null;
  collapsed?: boolean;
  appendix?: {
    marker: string;
    triggerAction: string;
    triggerCommand?: string;
    expected: string;
    revertCommand: string;
  } | null;
  receipts: Array<{
    id: string;
    trust_level: string;
    file_path: string | null;
    line_start: number | null;
    line_end: number | null;
  }>;
}

/** A command the reader is meant to run, with a real copy button. */
export function CommandLine({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context / denied) — the text is selectable */
    }
  };

  return (
    <div className="flex items-stretch gap-1 rounded-md border border-border bg-muted/50">
      <Terminal className="ml-2 mt-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-1 py-1.5 font-mono text-[0.75rem] text-foreground">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="shrink-0 rounded-r-md px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

export function StepLocation({
  step,
  repo,
}: {
  step: { file_path: string; symbol_name: string | null; line_start: number | null; line_end: number | null; step_kind?: string | null };
  repo?: GithubRepoRef;
}) {
  const githubUrl = repo
    ? buildGithubBlobUrl(repo, step.file_path, { lineStart: step.line_start, lineEnd: step.line_end })
    : null;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        {githubUrl ? (
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={step.file_path}
            className="inline-flex max-w-full items-center gap-1 truncate font-mono text-[0.8125rem] text-foreground hover:underline"
          >
            <span className="min-w-0 truncate">{step.file_path}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
          </a>
        ) : (
          <p className="truncate font-mono text-[0.8125rem] text-foreground" title={step.file_path}>{step.file_path}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {step.symbol_name && (
            <span className="flex items-center gap-1">
              <Code2 className="h-3 w-3" />
              {step.symbol_name}
            </span>
          )}
          {step.line_start && (
            <span className="tabular-nums">
              Lines {step.line_start}{step.line_end ? `–${step.line_end}` : ""}
            </span>
          )}
          {step.step_kind && <Badge variant="secondary" className="text-[0.625rem] uppercase">{step.step_kind.replace(/_/g, " ")}</Badge>}
        </div>
      </div>
    </div>
  );
}

/**
 * One icon per structural crossing, with a default for anything the detector
 * grows later — boundary discovery is being generalized, and an unknown kind
 * must render as a connector rather than disappear.
 */
const BOUNDARY_ICON: Record<string, typeof Zap> = {
  queue: Zap,
  async_token: Zap,
  redirect: ExternalLink,
  external_roundtrip: ExternalLink,
  capability_unlock: KeyRound,
  resource_lifecycle: Layers,
  group: CornerDownRight,
};

const stepAnchorId = (order: number): string => `walkthrough-step-${order}`;

/** The connector between two cards: one sentence about how the path continues. */
function HandoffConnector({ handoff, boundary }: { handoff: WalkthroughHandoff; boundary?: { kind: string; detail: string } | null }) {
  const Icon = boundary ? (BOUNDARY_ICON[boundary.kind] ?? CornerDownRight) : ArrowDown;
  return (
    <div className="flex items-stretch gap-3 pl-3" aria-label="hand-off to the next step">
      <div className="flex w-6 shrink-0 flex-col items-center">
        <span className={cn("w-px flex-1", boundary ? "bg-primary/40" : "bg-border")} />
        <span
          className={cn(
            "my-1 flex h-6 w-6 items-center justify-center rounded-full border",
            boundary ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className={cn("w-px flex-1", boundary ? "bg-primary/40" : "bg-border")} />
      </div>
      <p className="flex-1 py-3 text-[0.78125rem] leading-relaxed text-muted-foreground">
        {handoff.text}
        {boundary && (
          <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-0.5 align-middle text-[0.625rem] uppercase tracking-wide text-primary">
            {boundary.kind.replace(/_/g, " ")}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * "How this path starts" — the sentence the reading used to leave out.
 *
 * A walkthrough of a socket handler used to render identically to a walkthrough
 * of a route, so a reader reasonably assumed the same door and there was
 * nothing on screen to correct them. The copy button appears only when the
 * backend supplied a command, which it does only for an HTTP route; every other
 * entry kind gets the publishing call sites instead, as real file links.
 */
function EntryBlock({ entry, repo }: { entry: WalkthroughEntry; repo?: GithubRepoRef }) {
  const emitters = entry.emitters ?? [];
  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
      <p className="flex items-start gap-2 text-[0.78125rem] leading-relaxed text-foreground">
        <DoorOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span>
          <span className="font-medium">How this path starts. </span>
          {entry.text}
        </span>
      </p>
      {entry.command && <CommandLine command={entry.command} label="request" />}
      {emitters.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-[0.6875rem] text-muted-foreground">
          Emitted from:
          {emitters.map((e, i) => {
            const label = `${e.filePath}${e.lineStart ? `:${e.lineStart}` : ""}`;
            const url = repo ? buildGithubBlobUrl(repo, e.filePath, { lineStart: e.lineStart, lineEnd: e.lineStart }) : null;
            return url ? (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 rounded bg-muted/60 px-1 font-mono hover:text-foreground hover:underline"
              >
                {label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span key={i} className="rounded bg-muted/60 px-1 font-mono">{label}</span>
            );
          })}
        </p>
      )}
    </div>
  );
}

/**
 * One card: the code, the lines that matter in it, and what it does here.
 *
 * The snippet is windowed to ~32 lines around the first highlight so a 300-line
 * handler does not bury the two lines the step is about; "show the whole
 * function" restores the full captured bytes, which are the same bytes the
 * receipts prove.
 */
function WalkthroughStepCard({
  step,
  repo,
  compact,
}: {
  step: WalkthroughStepData;
  repo?: GithubRepoRef;
  compact?: boolean;
}) {
  const [whole, setWhole] = useState(false);
  const highlights = step.highlights ?? [];
  const ranges: HighlightRange[] = highlights.map((h) => ({ start: h.start, end: h.end }));

  const lines = step.snippet?.replace(/\n$/, "").split("\n") ?? [];
  const firstLine = step.line_start ?? 1;
  const lastLine = firstLine + lines.length - 1;
  // The window is computed over the snippet as captured; the stored copy is
  // capped, so clamp rather than slice past the end and render a blank block.
  const raw = step.window;
  const win = raw && raw.start <= lastLine
    ? { start: Math.max(raw.start, firstLine), end: Math.min(raw.end, lastLine) }
    : null;
  const windowed = Boolean(win && !whole && (win.start > firstLine || win.end < lastLine));
  const shown = windowed && win ? lines.slice(win.start - firstLine, win.end - firstLine + 1).join("\n") : step.snippet ?? "";
  const shownStart = windowed && win ? win.start : firstLine;

  return (
    // A real card, because "card" used to be a name for a run of stacked
    // blocks: 8px between a step's own parts against 12px between steps is not
    // a boundary a reader can see, and a six-step walkthrough read as one long
    // column of snippets. The border is what says where a step ends.
    <div
      id={stepAnchorId(step.step_order)}
      className={cn(
        "scroll-mt-20 space-y-2 rounded-lg border border-border bg-card/50",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="shrink-0 text-[0.6875rem] tabular-nums">Step {step.step_order}</Badge>
        {step.symbol_name && (
          <span className="font-mono text-[0.78125rem] font-medium text-foreground">{step.symbol_name}</span>
        )}
        {step.narration_source === "deterministic" && (
          <Badge variant="secondary" className="text-[0.625rem]">deterministic</Badge>
        )}
      </div>

      {step.entry && <EntryBlock entry={step.entry} repo={repo} />}

      <StepLocation step={{ ...step, step_kind: null }} repo={repo} />

      {step.snippet ? (
        <>
          <CodeSnippet
            code={shown}
            startLine={shownStart}
            maxHeightClass={compact ? "max-h-56" : "max-h-[28rem]"}
            highlightRanges={ranges}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {highlights.map((h, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                <span className="rounded bg-primary/15 px-1 font-mono tabular-nums text-primary">
                  {h.start}{h.end > h.start ? `–${h.end}` : ""}
                </span>
                {h.label}
              </span>
            ))}
            {win && (windowed || whole) && lines.length > win.end - win.start + 1 && (
              <button
                type="button"
                onClick={() => setWhole((v) => !v)}
                className="text-[0.6875rem] font-medium text-primary hover:underline"
              >
                {whole ? "Show just the lines that matter" : `Show the whole function (${lines.length} lines)`}
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-[0.71875rem] text-muted-foreground">
          No snippet was captured for this step. Open the file above to read it.
        </p>
      )}

      <p className="text-[0.8125rem] leading-relaxed text-foreground">
        {step.explanation || "No narration could be grounded in the evidence for this step."}
      </p>

      {step.landing && (
        <p className="flex items-start gap-2 rounded-md border border-success/40 bg-success-soft px-3 py-2 text-[0.78125rem] leading-relaxed text-foreground">
          <FlagTriangleRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span>{step.landing}</span>
        </p>
      )}

      {step.receipts.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.65625rem] text-muted-foreground">
          Backed by:
          {step.receipts.map((r) => {
            const url = repo && r.file_path
              ? buildGithubBlobUrl(repo, r.file_path, { lineStart: r.line_start, lineEnd: r.line_end })
              : null;
            const label = `${r.file_path}${r.line_start ? `:${r.line_start}` : ""}`;
            return url ? (
              <a
                key={r.id}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 rounded bg-muted/60 px-1 font-mono hover:text-foreground hover:underline"
              >
                {label}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span key={r.id} className="rounded bg-muted/60 px-1 font-mono">{label}</span>
            );
          })}
        </p>
      )}
    </div>
  );
}

/** The v3 marker / trigger / revert trio, compressed onto one optional card. */
function AppendixCard({ step }: { step: WalkthroughStepData }) {
  const [open, setOpen] = useState(false);
  const a = step.appendix!;
  return (
    <div className="rounded-lg border border-dashed border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[0.78125rem] font-medium text-foreground hover:bg-accent/40"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        Optional: prove it live
        <span className="font-normal text-muted-foreground">(plant a marker, set the flow off, revert)</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-3">
          <p className="text-[0.78125rem] text-muted-foreground">
            Add this line at the top of <code className="font-mono text-foreground">{step.symbol_name ?? step.file_path}</code>{" "}
            in <code className="font-mono text-foreground">{step.file_path}</code>
            {step.line_start ? ` (line ${step.line_start})` : ""}:
          </p>
          <CommandLine command={a.marker} label="marker" />
          <p className="text-[0.78125rem] text-muted-foreground">{a.triggerAction}</p>
          {a.triggerCommand && <CommandLine command={a.triggerCommand} label="trigger command" />}
          <p className="text-[0.78125rem] text-muted-foreground">{a.expected}</p>
          <p className="text-[0.78125rem] text-muted-foreground">Then put the file back:</p>
          <CommandLine command={a.revertCommand} label="revert command" />
        </div>
      )}
    </div>
  );
}

interface PhaseGroup {
  key: string;
  phase: WalkthroughPhase | null;
  visible: WalkthroughStepData[];
  folded: WalkthroughStepData[];
}

/** Group by journey member; a single flow is one implicit, header-less phase. */
function groupIntoPhases(steps: WalkthroughStepData[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  for (const step of steps) {
    const key = step.phase ? `${step.phase.index}:${step.phase.member}` : "flow";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, phase: step.phase ?? null, visible: [], folded: [] };
      groups.push(group);
    }
    (step.collapsed ? group.folded : group.visible).push(step);
  }
  return groups;
}

export function WalkthroughDocument({
  steps,
  repo,
  onActiveStep,
}: {
  steps: WalkthroughStepData[];
  repo?: GithubRepoRef;
  /** Fires as the reader scrolls, so "Continue tutorial" resumes where they were. */
  onActiveStep?: (stepOrder: number) => void;
}) {
  const appendix = steps.filter((s) => s.appendix);
  const body = useMemo(() => steps.filter((s) => !s.appendix), [steps]);
  const groups = useMemo(() => groupIntoPhases(body), [body]);
  const [active, setActive] = useState(body[0]?.step_order ?? 1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const activeRef = useRef(active);
  // Held in a ref, not a dependency: the caller passes an inline arrow, and
  // rebuilding the observer on every render makes the rail flicker.
  const notifyRef = useRef(onActiveStep);
  notifyRef.current = onActiveStep;

  // Progress follows the scroll instead of a pager index: the topmost card
  // still on screen is the one the reader is on.
  useEffect(() => {
    const nodes = body
      .map((s) => document.getElementById(stepAnchorId(s.step_order)))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b));
        const order = Number(top.target.id.replace("walkthrough-step-", ""));
        if (!Number.isFinite(order) || order === activeRef.current) return;
        activeRef.current = order;
        setActive(order);
        notifyRef.current?.(order);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [body]);

  const railItems = groups[0]?.phase
    ? groups.map((g) => ({ label: `${g.phase!.index}. ${g.phase!.title}`, target: g.visible[0]?.step_order ?? 1, orders: [...g.visible, ...g.folded].map((s) => s.step_order) }))
    : body.filter((s) => !s.collapsed).map((s) => ({ label: `${s.step_order}. ${s.symbol_name ?? s.file_path.split("/").pop()}`, target: s.step_order, orders: [s.step_order] }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
      <div className="min-w-0 space-y-1">
        {groups.map((group) => (
          <section key={group.key} className="space-y-4">
            {group.phase && (
              <div className="sticky top-0 z-10 -mx-1 flex items-baseline gap-2 border-b border-border bg-card/95 px-1 py-2 backdrop-blur">
                <h3 className="text-[0.8125rem] font-semibold text-foreground">{group.phase.title}</h3>
                <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                  Phase {group.phase.index} of {group.phase.count}
                </span>
              </div>
            )}
            {group.visible.map((step) => (
              // `space-y-4` inside as well as between wrappers so the connector
              // sits the same distance from the card it leaves as from the one
              // it points at; flush against the card above, it read as part of
              // that card rather than as the gap between two.
              <div key={step.id} className="space-y-4">
                <WalkthroughStepCard step={step} repo={repo} />
                {step.handoff && <HandoffConnector handoff={step.handoff} boundary={step.boundary} />}
              </div>
            ))}
            {group.folded.length > 0 && (
              <div className="rounded-lg border border-dashed border-border">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => ({ ...e, [group.key]: !e[group.key] }))}
                  aria-expanded={Boolean(expanded[group.key])}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.71875rem] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded[group.key] && "rotate-180")} />
                  {expanded[group.key] ? "Hide" : `+ ${group.folded.length} more step${group.folded.length === 1 ? "" : "s"}`}
                  {group.phase ? " inside this phase" : " in this flow"}
                </button>
                {expanded[group.key] && (
                  <div className="space-y-4 border-t border-border px-3 py-3">
                    {group.folded.map((step) => (
                      <WalkthroughStepCard key={step.id} step={step} repo={repo} compact />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        ))}
        {appendix.map((step) => <AppendixCard key={step.id} step={step} />)}
      </div>

      {railItems.length > 1 && (
        <nav aria-label="Walkthrough contents" className="hidden lg:block">
          <div className="sticky top-4 space-y-0.5">
            <p className="section-label pb-1">{groups[0]?.phase ? "Phases" : "Steps"}</p>
            {railItems.map((item) => (
              <button
                key={item.target}
                type="button"
                onClick={() => document.getElementById(stepAnchorId(item.target))?.scrollIntoView({ behavior: scrollBehavior(), block: "start" })}
                className={cn(
                  "block w-full truncate rounded px-2 py-1 text-left text-[0.6875rem] transition-colors",
                  item.orders.includes(active)
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

/** Scrolls a deep link (`?step=n`) or a keyboard jump to its card. */
export function scrollToWalkthroughStep(order: number): void {
  document.getElementById(stepAnchorId(order))?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
}
