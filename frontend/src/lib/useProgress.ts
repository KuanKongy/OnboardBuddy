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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) return;
    apiFetch(`/projects/${projectId}/progress`)
      .then((data: { items: ProgressItem[] }) => setItems(data.items ?? []))
      .catch(() => setItems([]));
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

  return { items, save };
}
