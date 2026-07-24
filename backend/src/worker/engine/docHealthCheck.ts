import type { EvidenceNode } from '../types/analysis.js';
import type { DetectedEntrypoint } from './entrypointDetector.js';

/**
 * Doc-vs-code staleness (plan step 3, M4 line 62 "flag outdated docs"):
 * deterministic comparison of claims the repo's own docs make against the
 * extracted facts. v1 checks the two claim classes that are reliably
 * machine-readable in prose:
 *
 *  - route paths (`/api/...` tokens) vs detected entrypoint routes,
 *  - env variable names (SNAKE_CASE tokens) vs .env template names.
 *
 * Table names are deliberately NOT checked — prose collides with common
 * words too often to stay honest. Mismatches surface as snapshot `unknowns`
 * (kind: doc_conflict) → coverage strip → trust panel; never silent, never
 * a prose section (doc_health the section is retired).
 */

export interface DocConflict {
  kind: 'doc_conflict';
  doc: string;
  claim: string;
  class: 'route' | 'env';
  detail: string;
}

const MAX_CONFLICTS = 8;
const ROUTE_RE = /(\/api\/[A-Za-z0-9_\-\/:{}.]+)/g;
const ENV_RE = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;
// esbuild mis-lexes backticks inside regex literals in this file, so
// markdown code-span backticks are stripped from the text up front instead.
const BACKTICK_G = new RegExp(String.fromCharCode(96), 'g');

/** `/api/projects/:id/analyze` -> `/api/projects/STAR/analyze` for comparison. */
function normalizeRoute(path: string): string {
  return path
    .replace(/[.,)]+$/, '')
    .replace(/\{[^}]+\}/g, ':x')
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '*' : seg))
    .join('/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function checkDocHealth(input: {
  docNodes: EvidenceNode[];
  entrypoints: DetectedEntrypoint[];
  envVarNames: string[];
}): DocConflict[] {
  const knownRoutes = new Set(
    input.entrypoints
      .filter((e) => e.kind === 'http_route' && e.routePattern)
      .map((e) => normalizeRoute(e.routePattern!)),
  );
  const knownEnv = new Set(input.envVarNames);
  const conflicts: DocConflict[] = [];
  const seen = new Set<string>();

  // No extracted facts on a side => nothing checkable, never "everything the
  // docs say is wrong".
  const routesCheckable = knownRoutes.size > 0;
  const envCheckable = knownEnv.size > 0;

  for (const node of input.docNodes) {
    if (conflicts.length >= MAX_CONFLICTS) break;
    const text = (node.snippet ?? '').replace(BACKTICK_G, ' ');
    if (!text.trim()) continue;
    const docLabel = node.filePath ?? node.stableKey;

    if (routesCheckable) {
      for (const m of text.matchAll(ROUTE_RE)) {
        // Source paths in prose (`/api/routes/projects.ts`) look route-shaped
        // but are file references, not route claims.
        if (/\.[a-z]{2,4}$/i.test(m[1]!)) continue;
        const claimed = normalizeRoute(m[1]!);
        if (claimed.split('/').length < 4) continue; // '/api' or '/api/v1' alone is not a checkable claim
        if (knownRoutes.has(claimed)) continue;
        const key = `${docLabel}:${claimed}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          kind: 'doc_conflict',
          doc: docLabel,
          claim: m[1]!,
          class: 'route',
          detail: `documented route not found among the ${knownRoutes.size} detected routes`,
        });
        if (conflicts.length >= MAX_CONFLICTS) break;
      }
    }

    if (envCheckable && conflicts.length < MAX_CONFLICTS) {
      for (const m of text.matchAll(ENV_RE)) {
        const name = m[1]!;
        // Underscored, ≥6 chars, env-shaped; prose acronyms (README, HTTP)
        // have no underscore and never match.
        if (name.length < 6 || knownEnv.has(name)) continue;
        // Only flag names the doc presents as configuration — a direct
        // assignment (`NAME=`) or a `process.env.NAME` reference. Loose
        // "env nearby" context flagged unrelated constants (HTTP_STATUS in a
        // sentence that happened to mention .env).
        if (!text.includes(`${name}=`) && !text.includes(`process.env.${name}`)) continue;
        const key = `${docLabel}:env:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          kind: 'doc_conflict',
          doc: docLabel,
          claim: name,
          class: 'env',
          detail: 'documented env variable not present in any .env template',
        });
        if (conflicts.length >= MAX_CONFLICTS) break;
      }
    }
  }

  return conflicts;
}
