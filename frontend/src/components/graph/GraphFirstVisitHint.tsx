import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type GraphHintVariant = "files" | "classes";

// `files` keeps the original key so readers who already dismissed it never see it
// again; `classes` is copy nobody has dismissed and needs its own.
const HINT_DISMISSED_KEYS: Record<GraphHintVariant, string> = {
  files: "onboardbuddy:graph-hint-dismissed",
  classes: "onboardbuddy:class-graph-hint-dismissed",
};

export function isGraphHintDismissed(variant: GraphHintVariant = "files"): boolean {
  return readHintDismissed(variant);
}

function readHintDismissed(variant: GraphHintVariant): boolean {
  try {
    return localStorage.getItem(HINT_DISMISSED_KEYS[variant]) === "1";
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — show
    // the hint every time rather than crash.
    return false;
  }
}

function persistHintDismissed(variant: GraphHintVariant): void {
  try {
    localStorage.setItem(HINT_DISMISSED_KEYS[variant], "1");
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}

export function GraphFirstVisitHint({
  hasEntryPoints = true,
  variant = "files",
}: {
  hasEntryPoints?: boolean;
  variant?: GraphHintVariant;
}) {
  const [dismissed, setDismissed] = useState(() => readHintDismissed(variant));

  if (dismissed) return null;

  return (
    <Card className="w-72 max-w-[85vw] gap-2 border-primary/30 bg-card/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur">
      <p className="font-semibold text-foreground">What am I looking at?</p>
      {variant === "classes" ? (
        <>
          <p className="text-muted-foreground">
            This is a map of the classes and interfaces in this project — arrows are
            extends/implements links.
          </p>
          {/* No GitHub offer: this view's panel has no repository link. */}
          <p className="text-muted-foreground">
            Click one to see what it does, where it is declared and what calls it.
          </p>
        </>
      ) : (
        <>
          <p className="text-muted-foreground">
            This is a map of how files in this project depend on each other.
          </p>
          <p className="text-muted-foreground">
            Click a node to see its details and open it on GitHub. Select a group and its panel's Open
            button lists the files inside.
            {hasEntryPoints && " Start from an entry point (marked ▶) to follow the app's flow."}
          </p>
        </>
      )}
      <div className="flex justify-end pt-1">
        <Button
          size="xs"
          onClick={() => {
            persistHintDismissed(variant);
            setDismissed(true);
          }}
        >
          Got it
        </Button>
      </div>
    </Card>
  );
}
