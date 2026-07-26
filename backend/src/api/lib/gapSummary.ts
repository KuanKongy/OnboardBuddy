/**
 * One definition of "known gap", counted once.
 *
 * The reader used to show two disjoint populations under the same word. The
 * trust strip printed `snapshot.unknowns` ("6 known unknowns" — detection
 * dead-ends) while the twelve sections printed their own `unknowns` arrays
 * (89 entries on the audited package). Neither number described the other and
 * both were labelled "unknowns", so the strip contradicted the page it sat on
 * (AUDIT_LEDGER A10, UX §19.4).
 *
 * From here there is one population — **a known gap is anything the analysis
 * recorded as undetermined** — reported as a single total with its two
 * provenances broken out, and grouped deterministically so 34 copies of one
 * sentence render as one row with a count instead of 34 rows.
 *
 * Everything here is pure string work: no LLM, no I/O, stable ordering, so the
 * same package always produces the same rows.
 */

export interface RawGap {
  kind: string;
  detail?: string | null;
  claim?: string | null;
}

/** One template inside a kind — "…guardrails for {}" said 32 times. */
export interface GapVariant {
  /** Normalised template the members share — the dedupe key, exposed for debugging. */
  signature: string;
  /** How many raw gaps collapsed onto this template. */
  count: number;
  /** Representative detail (first member in source order); null when the kind carries none. */
  detail: string | null;
  /**
   * Distinct member details in first-seen order. Length may be < count when
   * two gaps were byte-identical; the row shows `count`, the expander shows
   * these, and nothing is dropped.
   */
  members: string[];
}

/** The row the reader sees: `kind × N`, with the sentences behind an expander. */
export interface GapGroup {
  kind: string;
  /** Raw gaps of this kind — what `× N` prints. */
  count: number;
  /** Distinct templates within the kind, largest first. */
  variants: GapVariant[];
}

export interface GapSummary {
  /** Every known gap in the package — sections + detection. The one number the strip shows. */
  total: number;
  /** Gaps raised while writing the sections (uncited claims, docs-only support, coverage holes). */
  sections: number;
  /** Snapshot-level detection dead-ends (traces, unmodelled packages, journey gaps). */
  detection: number;
  /** Distinct gap kinds after deterministic dedupe — how many rows the reader actually sees. */
  groups: number;
}

/**
 * Strip the parts of a gap sentence that vary per occurrence so that
 * "no documented guardrails for `SUPABASE_URL`" and "… for `REDIS_URL`"
 * collapse onto one template. Order matters: quoted/backticked spans first
 * (they swallow paths and identifiers), then paths, then bare identifiers.
 */
export function gapSignature(kind: string, detail?: string | null): string {
  const normalised = (detail ?? "")
    .toLowerCase()
    // `backticked`, "quoted", 'quoted' spans — almost always the identifier
    .replace(/`[^`]*`/g, "{}")
    .replace(/"[^"]*"/g, "{}")
    .replace(/'[^']*'/g, "{}")
    // file paths, with or without a line range
    .replace(/[\w@./-]*\/[\w@./-]+(?::\d+(?:[-–]\d+)?)?/g, "{}")
    .replace(/\b[\w-]+\.(ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|sql|md|py|go|rb|java|env|example|toml)\b/g, "{}")
    // SCREAMING_SNAKE env-var style names, then camel/Pascal identifiers with a dot call
    .replace(/\b[A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b/gi, "{}")
    .replace(/\b\d[\d,._]*\b/g, "{}")
    .replace(/\s+/g, " ")
    .replace(/[\s.;,:—–-]+$/g, "")
    .trim();
  return `${kind}|${normalised}`;
}

/**
 * Collapse raw gaps onto their templates. Stable by construction: groups come
 * back ordered by size, ties broken by first appearance, so the rendered list
 * never reshuffles between requests for the same package.
 */
export function groupGaps(gaps: readonly RawGap[]): GapGroup[] {
  type Seen<T> = T & { firstIndex: number };
  const byKind = new Map<string, Seen<{ kind: string; count: number; variants: Map<string, Seen<GapVariant>> }>>();

  gaps.forEach((gap, index) => {
    if (!gap || typeof gap.kind !== "string") return;
    const detail = typeof gap.detail === "string" && gap.detail.trim() ? gap.detail.trim() : null;
    const signature = gapSignature(gap.kind, detail);
    const kindEntry =
      byKind.get(gap.kind) ?? { kind: gap.kind, count: 0, variants: new Map(), firstIndex: index };
    kindEntry.count += 1;
    const variant = kindEntry.variants.get(signature);
    if (variant) {
      variant.count += 1;
      if (detail && !variant.members.includes(detail)) variant.members.push(detail);
    } else {
      kindEntry.variants.set(signature, {
        signature,
        count: 1,
        detail,
        members: detail ? [detail] : [],
        firstIndex: index,
      });
    }
    byKind.set(gap.kind, kindEntry);
  });

  const bySize = <T extends { count: number; firstIndex: number }>(a: T, b: T) =>
    b.count - a.count || a.firstIndex - b.firstIndex;

  return [...byKind.values()].sort(bySize).map((entry) => ({
    kind: entry.kind,
    count: entry.count,
    variants: [...entry.variants.values()]
      .sort(bySize)
      .map(({ firstIndex: _firstIndex, ...variant }) => variant),
  }));
}

/**
 * The package-level number the trust strip shows, with the two provenances it
 * is made of. `groups` is computed over the union so the strip can say what
 * the reader will actually scroll past ("89 gaps · 24 kinds").
 */
export function summarizeGaps(
  sectionGaps: ReadonlyArray<readonly RawGap[]>,
  detectionGaps: readonly RawGap[],
): GapSummary {
  const flatSections = sectionGaps.flat();
  const sections = flatSections.length;
  const detection = detectionGaps.length;
  return {
    total: sections + detection,
    sections,
    detection,
    groups: groupGaps([...flatSections, ...detectionGaps]).length,
  };
}
