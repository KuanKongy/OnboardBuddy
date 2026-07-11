/**
 * Multi-view embedding text (doc/Pipeline.md "Multi-view Embeddings").
 * Content is rendered DETERMINISTICALLY from record fields — never
 * freeform — so the same record always embeds to the same text:
 *   purpose view:     name, kind, purpose, behavior, responsibilities
 *   domain view:      business_concepts, capability names, purpose
 *   dependency view:  dependencies_narrative, caller/callee names, imports
 *   operations view:  side_effects, risks_invariants, env/config touched, failure modes
 * Facts-only records get purpose/dependency/operations views only (there
 * is no LLM-derived domain signal to embed).
 */

import type { SemanticRecordBody, RecordLevel } from './recordTypes.js';

export type ViewType = 'purpose' | 'domain' | 'dependency' | 'operations';

export const ALL_VIEWS: ViewType[] = ['purpose', 'domain', 'dependency', 'operations'];

/** Per-record context the renderers may use beyond record fields. */
export interface ViewRenderContext {
  name: string;
  kind: string; // node type or record level
  filePath: string | null;
  callerNames: string[];
  calleeNames: string[];
  capabilityNames: string[];
}

const CONTENT_CAP = 2_000;

export function viewsForRecord(record: { factsOnly: boolean }): ViewType[] {
  return record.factsOnly ? ['purpose', 'dependency', 'operations'] : ALL_VIEWS;
}

export function renderView(
  view: ViewType,
  body: SemanticRecordBody,
  ctx: ViewRenderContext,
): string {
  const lines: Array<string | null> = [];
  switch (view) {
    case 'purpose':
      lines.push(
        `${ctx.kind} ${ctx.name}${ctx.filePath ? ` in ${ctx.filePath}` : ''}.`,
        `Purpose: ${body.purpose}`,
        `Behavior: ${body.behavior}`,
        body.responsibilities.length > 0 ? `Responsibilities: ${body.responsibilities.join(', ')}` : null,
      );
      break;
    case 'domain':
      lines.push(
        `${ctx.name}.`,
        body.business_concepts.length > 0 ? `Business concepts: ${body.business_concepts.join(', ')}` : null,
        ctx.capabilityNames.length > 0 ? `Capabilities: ${ctx.capabilityNames.join(', ')}` : null,
        `Purpose: ${body.purpose}`,
      );
      break;
    case 'dependency':
      lines.push(
        `${ctx.kind} ${ctx.name}${ctx.filePath ? ` in ${ctx.filePath}` : ''}.`,
        body.dependencies_narrative ? `Dependencies: ${body.dependencies_narrative}` : null,
        ctx.calleeNames.length > 0 ? `Calls: ${ctx.calleeNames.slice(0, 15).join(', ')}` : null,
        ctx.callerNames.length > 0 ? `Called by: ${ctx.callerNames.slice(0, 15).join(', ')}` : null,
      );
      break;
    case 'operations':
      lines.push(
        `${ctx.kind} ${ctx.name}${ctx.filePath ? ` in ${ctx.filePath}` : ''}.`,
        body.side_effects.length > 0
          ? `Side effects: ${body.side_effects.map((s) => `${s.kind} (${s.description})`).join('; ')}`
          : 'Side effects: none detected.',
        body.risks_invariants.length > 0 ? `Risks and invariants: ${body.risks_invariants.join('; ')}` : null,
        body.failure_modes?.length ? `Failure modes: ${body.failure_modes.join('; ')}` : null,
      );
      break;
  }
  return lines.filter(Boolean).join('\n').slice(0, CONTENT_CAP);
}

/** Views a retrieval query should search, by intent (doc/Pipeline.md). */
export function viewsForIntent(intent: 'what_does' | 'what_handles' | 'what_uses' | 'what_breaks' | 'general'): ViewType[] {
  switch (intent) {
    case 'what_does': return ['purpose'];
    case 'what_handles': return ['domain'];
    case 'what_uses': return ['dependency'];
    case 'what_breaks': return ['operations'];
    default: return ['purpose', 'domain'];
  }
}

/** Display kind for a record: node type for symbols/files, level otherwise. */
export function kindForRecord(level: RecordLevel, nodeType: string | null): string {
  return nodeType ?? level;
}
