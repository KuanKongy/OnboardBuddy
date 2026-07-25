/**
 * The drill path through a graph, encoded in the URL.
 *
 * Dependencies previously kept only the CURRENT cluster (`?cluster=src/lib`)
 * and derived "up one level" by dropping a path segment:
 *
 *     segments.slice(0, -1).join("/")        // GraphPage.tsx:142-146
 *
 * That is a guess at a parent, not a record of where you were. Arriving via a
 * `?focus=` deep link auto-drilled two directory levels at once, so Back
 * landed somewhere the user had never seen; and it could not express a ladder
 * whose levels are not path prefixes of one another (cluster -> file ->
 * symbols), which is what Architecture and Workflows need.
 *
 * A frame is `kind,id,label`, frames joined by `|`:
 *
 *     ?drill=cluster,src%2Flib,lib|file,src%2Flib%2Fapi.ts,api.ts
 *
 * Both delimiters are chosen because `encodeURIComponent` escapes them, so
 * neither can survive inside a value and the split is unambiguous. That rules
 * out the tempting `~`: it is an *unreserved* character in RFC 3986 and passes
 * through unescaped, so a real path like `src/weird~name.ts` would have been
 * torn into two frames.
 */

export type LevelKind = "cluster" | "file" | "symbols" | "workflow" | "step" | "callees";

export interface DrillFrame {
  kind: LevelKind;
  /** Level target: a directory prefix, a file path, a node id. */
  id: string;
  /** What the breadcrumb shows. */
  label: string;
}

/** Viewport to restore when returning to a level. Lives in history.state. */
export interface DrillViewport {
  x: number;
  y: number;
  zoom: number;
}

const FRAME_SEP = "|";
const FIELD_SEP = ",";

const LEVEL_KINDS: readonly LevelKind[] = ["cluster", "file", "symbols", "workflow", "step", "callees"];

export function encodeDrill(frames: DrillFrame[]): string {
  return frames
    .map((f) => [f.kind, f.id, f.label].map(encodeURIComponent).join(FIELD_SEP))
    .join(FRAME_SEP);
}

/**
 * Tolerant by design: a hand-edited or truncated `?drill=` should land the
 * user at a shallower level, never blank the page. Unparseable frames are
 * dropped rather than thrown.
 */
export function decodeDrill(raw: string | null | undefined): DrillFrame[] {
  if (!raw) return [];
  const frames: DrillFrame[] = [];
  for (const chunk of raw.split(FRAME_SEP)) {
    if (!chunk) continue;
    const parts = chunk.split(FIELD_SEP);
    if (parts.length < 2) continue;
    const kind = decodeURIComponent(parts[0]!) as LevelKind;
    if (!LEVEL_KINDS.includes(kind)) continue;
    const id = decodeURIComponent(parts[1]!);
    if (!id) continue;
    const label = parts[2] ? decodeURIComponent(parts[2]) : id;
    frames.push({ kind, id, label });
  }
  return frames;
}

/**
 * Back-compat for `?cluster=<path>` links (bookmarks, the Architecture aside,
 * older specs). A single cluster frame is exactly what that param meant.
 */
export function framesFromLegacyCluster(cluster: string | null | undefined): DrillFrame[] {
  if (!cluster) return [];
  return [{ kind: "cluster", id: cluster, label: cluster.split("/").filter(Boolean).pop() ?? cluster }];
}

/** True when two stacks describe the same path — used to avoid redundant pushes. */
export function sameFrames(a: DrillFrame[], b: DrillFrame[]): boolean {
  return a.length === b.length && a.every((f, i) => f.kind === b[i]!.kind && f.id === b[i]!.id);
}
