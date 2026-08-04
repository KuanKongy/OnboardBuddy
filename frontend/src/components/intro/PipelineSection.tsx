import { useRef, useState } from "react";
import { Reveal } from "@/components/intro/Reveal";
import { SectionShell } from "@/components/intro/SectionShell";
import { PHASE_ORDER, stripAiPrefix, type PipelinePhase } from "@/lib/pipelinePhases";
import { PRIVACY_MODES, type PrivacyMode } from "@/lib/privacyModes";
import { cn } from "@/lib/utils";

/**
 * The whole 16-phase pipeline, interactive: pick a privacy mode and watch
 * which phases actually run; click a phase for its real description. Labels,
 * descriptions and skip semantics all come from lib/pipelinePhases, the same
 * module the live run panel renders, so this section cannot drift from what
 * a run really does.
 */
export function PipelineSection() {
  const [mode, setMode] = useState<PrivacyMode["key"]>("full_ai");
  const [selectedKey, setSelectedKey] = useState(PHASE_ORDER[0]!.key);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected = PHASE_ORDER.find((phase) => phase.key === selectedKey) ?? PHASE_ORDER[0]!;
  const factsOnly = mode === "facts_only_ai";
  const isSkipped = (phase: PipelinePhase) => mode === "ai_disabled" && phase.skippedWhenAiDisabled;
  const selectedSkipped = isSkipped(selected);
  const selectedRunsWithoutAi = mode === "ai_disabled" && selected.ai && !selected.skippedWhenAiDisabled;

  const cycleMode = (direction: 1 | -1) => {
    const index = PRIVACY_MODES.findIndex((m) => m.key === mode);
    const next = (index + direction + PRIVACY_MODES.length) % PRIVACY_MODES.length;
    setMode(PRIVACY_MODES[next]!.key);
    radioRefs.current[next]?.focus();
  };

  return (
    <SectionShell
      id="pipeline"
      eyebrow="What actually runs"
      title="Sixteen phases, deterministic first"
      deck="Parsing, the evidence graph and workflow tracing all finish before a model is asked anything. Toggle the privacy mode to see exactly which phases run."
    >
      <Reveal>
        <div
          role="radiogroup"
          aria-label="Privacy mode"
          className="mx-auto flex w-fit rounded-lg border border-foreground/10 bg-card/70 p-1 backdrop-blur-sm dark:border-white/10"
        >
          {PRIVACY_MODES.map((m, i) => (
            <button
              key={m.key}
              ref={(el) => {
                radioRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              tabIndex={mode === m.key ? 0 : -1}
              onClick={() => setMode(m.key)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  cycleMode(1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  cycleMode(-1);
                }
              }}
              className={cn(
                "rounded-md px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
                mode === m.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Reveal>

      <Reveal index={1} className="mt-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PHASE_ORDER.map((phase, i) => {
            const skipped = isSkipped(phase);
            const active = phase.key === selectedKey;
            return (
              <button
                key={phase.key}
                type="button"
                aria-pressed={active}
                aria-label={`${stripAiPrefix(phase.label)}, ${phase.ai ? "AI" : "deterministic"} phase${
                  skipped ? ", skipped under AI disabled" : ""
                }`}
                onClick={() => setSelectedKey(phase.key)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all duration-200",
                  active
                    ? "border-primary/60 bg-primary/10"
                    : "border-foreground/10 bg-card/60 hover:border-primary/30 hover:bg-card dark:border-white/10",
                  skipped && "opacity-40",
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-muted text-[0.625rem] font-semibold text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                  {stripAiPrefix(phase.label)}
                </span>
                {/* Facts-only recolors the AI badges: same phases run, but
                    they receive facts without code, and the section must show
                    that the mode changes something. */}
                <span
                  className={cn(
                    "rounded px-1 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide",
                    skipped
                      ? "bg-warning-soft text-warning"
                      : phase.ai
                        ? factsOnly
                          ? "bg-info-soft text-info"
                          : "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {skipped ? "skip" : phase.ai ? "AI" : "det"}
                </span>
              </button>
            );
          })}
        </div>
      </Reveal>

      <Reveal index={2} className="mt-4">
        <div className="min-h-[5.5rem] rounded-xl border border-foreground/10 bg-card/70 p-4 backdrop-blur-sm dark:border-white/10">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9375rem] font-semibold text-foreground">
              {stripAiPrefix(selected.label)}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide",
                selected.ai ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {selected.ai ? "AI" : "Deterministic"}
            </span>
            {selectedSkipped ? (
              <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-warning">
                Skipped in this mode
              </span>
            ) : null}
            {selectedRunsWithoutAi ? (
              <span className="rounded bg-success-soft px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-success">
                Runs without AI in this mode
              </span>
            ) : null}
            {selected.ai && mode === "full_ai" ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-primary">
                Sends code snippets + facts
              </span>
            ) : null}
            {selected.ai && factsOnly ? (
              <span className="rounded bg-info-soft px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-info">
                Sends extracted facts only, no code
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[0.875rem] leading-relaxed text-muted-foreground">{selected.desc}</p>
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
          {mode === "full_ai" &&
            "Deterministic phases run first. Under Full AI, the AI phases read code snippets plus the extracted facts for the best quality."}
          {mode === "facts_only_ai" &&
            "Deterministic phases run first. Under Facts-only AI, the AI phases receive extracted facts and structure; code never leaves the system."}
          {mode === "ai_disabled" &&
            "Deterministic phases run first. Under AI disabled the semantic phases are skipped entirely, and generation assembles the package from the deterministic output instead."}
        </p>
      </Reveal>
    </SectionShell>
  );
}
