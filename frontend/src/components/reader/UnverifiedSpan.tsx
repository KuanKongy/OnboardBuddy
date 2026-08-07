import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * A claim the validator downgraded for citing nothing, flagged at the point of
 * doubt rather than only in Known gaps at the end of the section.
 *
 * The underline is deliberately neutral: it used to be `decoration-warning`,
 * and amber inside body prose read as an error the reader had to act on when
 * the actual status is "true or not, nothing here proves it". Grey dots say
 * "unsupported" without competing with the sentence they sit under.
 *
 * Shared because both surfaces that render generated prose — package sections
 * and Ask answers — pass `#unverified` anchors through the same markdown
 * pipeline, and AskPanel used to render them as bare links with no marker at
 * all.
 */
export function UnverifiedSpan({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-muted-foreground/70 decoration-dotted underline-offset-4 hover:decoration-muted-foreground"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        Unverified: no receipt cites this statement. Listed under Known gaps.
      </TooltipContent>
    </Tooltip>
  );
}
