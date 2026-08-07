import { Code2, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The one mark for who wrote a piece of reader-facing text: the model, or the
 * deterministic pipeline. Before this existed the app had three ad-hoc
 * treatments and used the sparkle with opposite meanings on different pages;
 * every surface now renders one of these two tones, and BOTH sides are always
 * marked, so an unmarked paragraph means "not generated" rather than "unknown".
 *
 * The chip itself is the hover target (user requirement): the short label is
 * always visible, the full explanatory sentence lives in its tooltip. Colors
 * follow the pipeline-chip rule the landing page already established:
 * AI = primary, deterministic = muted.
 */
export type TextSource = "ai" | "code";

const TONE: Record<
  TextSource,
  { icon: typeof Sparkles; label: string; chip: string; defaultTip: string }
> = {
  ai: {
    icon: Sparkles,
    label: "AI",
    chip: "bg-primary/10 text-primary",
    defaultTip: "Written by the model from repository evidence.",
  },
  code: {
    icon: Code2,
    label: "From code",
    chip: "bg-muted text-muted-foreground",
    defaultTip: "Derived from the traced structure of the code. No AI involved.",
  },
};

export function SourceMark({
  source,
  detail,
  tip,
  variant = "chip",
  className,
}: {
  source: TextSource;
  /** Optional visible suffix on the chip, e.g. "high confidence". */
  detail?: string | null;
  /** Tooltip sentence; falls back to the tone's default explanation. */
  tip?: string;
  /**
   * chip: label pill with tooltip (default). icon: glyph only with a native
   * title, for dense canvas cards where a pill would crowd the text.
   */
  variant?: "chip" | "icon";
  className?: string;
}) {
  const tone = TONE[source];
  const Icon = tone.icon;
  const tipText = tip ?? tone.defaultTip;

  if (variant === "icon") {
    return (
      <Icon
        className={cn("inline h-2.5 w-2.5 shrink-0", source === "ai" ? "text-primary" : "text-muted-foreground", className)}
        aria-label={tone.label}
      >
        <title>{tipText}</title>
      </Icon>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-source={source}
          className={cn(
            "inline-flex shrink-0 cursor-help items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.625rem] font-medium leading-none",
            tone.chip,
            className,
          )}
        >
          <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden />
          {tone.label}
          {detail ? <span className="opacity-80">· {detail}</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-left">
        {tipText}
      </TooltipContent>
    </Tooltip>
  );
}
