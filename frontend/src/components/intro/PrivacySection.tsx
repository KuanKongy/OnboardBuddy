import { ArrowRight, EyeOff, KeyRound, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { IconRow } from "@/components/intro/IconRow";
import { Reveal } from "@/components/intro/Reveal";
import { SectionShell } from "@/components/intro/SectionShell";
import { PRIVACY_MODES } from "@/lib/privacyModes";

/** Icon + accent per privacy mode, in PRIVACY_MODES order (full, facts, off). */
const MODE_DECOR = [
  { icon: Sparkles, accent: "text-primary" },
  { icon: ShieldCheck, accent: "text-info" },
  { icon: EyeOff, accent: "text-success" },
];

export function PrivacySection() {
  const navigate = useNavigate();

  return (
    <SectionShell
      id="privacy"
      eyebrow="Your code, your rules"
      title="Choose how much reaches a model"
      deck="The privacy mode is set per project and applies to every run. It is enforced in the pipeline, not promised in a policy."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {PRIVACY_MODES.map((mode, i) => {
          const decor = MODE_DECOR[i] ?? MODE_DECOR[0]!;
          const Icon = decor.icon;
          return (
            <Reveal key={mode.key} index={i}>
              <div className="h-full rounded-xl border border-foreground/10 bg-card/70 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2659f4]/30 dark:border-white/10">
                <Icon className={`h-5 w-5 ${decor.accent}`} aria-hidden="true" />
                <h3 className="mt-3 text-[0.9375rem] font-semibold text-foreground">{mode.label}</h3>
                <p className="mt-1 text-[0.875rem] leading-relaxed text-muted-foreground">{mode.hint}</p>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal index={1} className="mt-4">
        {/* The whole card opens /privacy, but as role="link" rather than a real
            anchor: these three guarantees are the sentences a reader wants to
            quote, and inside an anchor a drag doesn't select text, it starts a
            native link drag. A div keeps the text selectable, so the onClick
            has to bail when the mouseup merely finished a selection. Keyboard
            activation is hand-rolled for the same reason.

            The row at the bottom is a real anchor, which is the other half of
            why the card cannot be one (anchors don't nest). It carries its own
            hover:underline rather than group-hover, so hovering anywhere on the
            card no longer underlines a row the pointer is nowhere near, and it
            hands back what a div never had: drag the link out, middle-click it,
            open the browser's own context menu on it. Its click bubbles up
            here, so the outer handler drops anything that started inside an
            anchor before it can navigate a second time. Card and row share one
            accessible name, which keeps the card from reading out all three
            guarantees at the cost of announcing that one name twice. */}
        <div
          role="link"
          tabIndex={0}
          aria-label="Full privacy breakdown, mode by mode"
          onClick={(e) => {
            if ((e.target as Element).closest("a")) return;
            if (window.getSelection()?.toString()) return;
            navigate("/privacy");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate("/privacy");
            }
          }}
          className="block cursor-pointer select-text rounded-xl border border-foreground/10 bg-card/70 p-6 backdrop-blur-sm transition-colors duration-300 hover:border-[#2659f4]/30 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10"
        >
          <ul className="space-y-3">
            <IconRow icon={<Lock className="h-4 w-4" aria-hidden="true" />}>
              Read-only access; secrets are filtered and no full repository copy is stored.
            </IconRow>
            <IconRow icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}>
              AI calls run through OpenRouter with{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem] text-foreground">
                data_collection: deny
              </code>
              , and zero-data-retention routing is requested by default. What a given provider then
              does with a request is governed by their policy.
            </IconRow>
            <IconRow icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
              Bring your own OpenRouter key and this project's calls run under your account, not a
              shared one.
            </IconRow>
          </ul>
          <Link
            to="/privacy"
            onClick={(e) => e.stopPropagation()}
            className="mt-4 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-primary hover:underline"
          >
            Full privacy breakdown, mode by mode
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </Reveal>
    </SectionShell>
  );
}
