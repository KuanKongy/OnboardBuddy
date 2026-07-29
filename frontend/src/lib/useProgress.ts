import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface ProgressItem {
  kind: "onboarding" | "tutorial";
  ref_id: string;
  position: Record<string, unknown>;
  updated_at: string;
  /** False when the package/tutorial was regenerated away — fall back to static links. */
  still_exists: boolean;
  title: string | null;
}

/**
 * Per-user "continue where you left off" markers for a project. Reading
 * pages call save() as the user moves (debounced ~2s so scrolling through
 * sections doesn't spam the API); the overview's Continue cards read items.
 */
export function useProgress(projectId: string | undefined) {
  const [items, setItems] = useState<ProgressItem[]>([]);
  // Consumers that MERGE into stored positions (e.g. per-section read marks)
  // must wait for the initial fetch or they'd overwrite history with [].
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bug #68, and the one instance here that destroys data rather than just
  // misinforming: a rejected fetch used to do `setItems([])` and *still* flip
  // `loaded` to true in `finally`. That is precisely the state the comment
  // above says must never happen — the reader then merged its read marks
  // against an empty history and wrote `readSections: []` straight back to
  // the server, so one failed GET silently erased a member's progress. A
  // failure now leaves `loaded` false, which makes every merge consumer stand
  // down for the session instead of overwriting what it could not read.
  useEffect(() => {
    if (!projectId) return;
    setLoaded(false);
    setLoadError(false);
    apiFetch(`/projects/${projectId}/progress`)
      .then((data: { items: ProgressItem[] }) => {
        setItems(data.items ?? []);
        setLoaded(true);
      })
      .catch(() => {
        setItems([]);
        setLoadError(true);
      });
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [projectId]);

  const save = useCallback(
    (kind: "onboarding" | "tutorial", refId: string, position: Record<string, unknown>) => {
      if (!projectId) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        apiFetch(`/projects/${projectId}/progress`, {
          method: "PUT",
          body: JSON.stringify({ kind, ref_id: refId, position }),
        }).catch(() => { /* progress is best-effort */ });
      }, 2000);
    },
    [projectId],
  );

  return { items, loaded, loadError, save };
}
