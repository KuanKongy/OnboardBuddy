import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const HINT_DISMISSED_KEY = "onboardbuddy:graph-hint-dismissed";

export function isGraphHintDismissed(): boolean {
  return readHintDismissed();
}

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DISMISSED_KEY) === "1";
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — show
    // the hint every time rather than crash.
    return false;
  }
}

function persistHintDismissed(): void {
  try {
    localStorage.setItem(HINT_DISMISSED_KEY, "1");
  } catch {
    // Best-effort only; nothing to fall back to.
  }
}

export function GraphFirstVisitHint({ hasEntryPoints = true }: { hasEntryPoints?: boolean }) {
  const [dismissed, setDismissed] = useState(() => readHintDismissed());

  if (dismissed) return null;

  return (
    <Card className="w-72 max-w-[85vw] gap-2 border-primary/30 bg-card/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur">
      <p className="font-semibold text-foreground">What am I looking at?</p>
      <p className="text-muted-foreground">
        This is a map of how files in this project depend on each other.
      </p>
      <p className="text-muted-foreground">
        Click a node to see its file details and open it on GitHub.
        {hasEntryPoints && " Start from an entry point (marked ▶) to follow the app's flow."}
      </p>
      <div className="flex justify-end pt-1">
        <Button
          size="xs"
          onClick={() => {
            persistHintDismissed();
            setDismissed(true);
          }}
        >
          Got it
        </Button>
      </div>
    </Card>
  );
}
