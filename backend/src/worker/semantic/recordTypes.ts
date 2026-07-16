/**
 * Semantic record shapes (doc/Pipeline.md "Semantic record schema") — the
 * symbol pass and synthesis levels produce this fixed JSON via structured
 * outputs, never freeform prose. Level-specific fields extend the base.
 */

import type { JsonSchema } from '../ai/provider.js';

export type RecordLevel =
  | 'symbol' | 'file' | 'module' | 'service' | 'system' | 'workflow' | 'capability' | 'cluster';

export type RecordConfidence = 'high' | 'medium' | 'low';

export interface RecordClaim {
  claim: string;
  receiptIds: string[]; // prompt aliases (r1, r2, ...) until persisted, then UUIDs
  confidence: RecordConfidence;
}

export interface SemanticRecordBody {
  purpose: string;
  behavior: string;
  responsibilities: string[];
  business_concepts: string[];
  side_effects: Array<{ kind: string; description: string; mergedWithDeterministic: boolean }>;
  inputs_outputs: {
    inputs: Array<{ name: string; type: string | null; meaning: string }>;
    outputs: Array<{ type: string | null; meaning: string }>;
  } | null;
  dependencies_narrative: string;
  design_patterns: string[];
  risks_invariants: string[];
  confidence: RecordConfidence;
  claims: RecordClaim[];
  // Level-specific additions (present per level, null otherwise):
  key_symbols?: string[] | null;         // file
  file_role?: string | null;             // file
  key_files?: string[] | null;           // module
  internal_structure?: string | null;    // module
  boundary_contracts?: string[] | null;  // module
  runtime_shape?: string | null;         // service
  main_capabilities?: string[] | null;   // system
  architecture_narrative?: string | null;// system
  request_flow_narrative?: string | null;// system
  step_narrative?: string[] | null;      // workflow
  failure_modes?: string[] | null;       // workflow
  user_value?: string | null;            // capability
  label_explanation?: string | null;     // cluster
  boundary_rationale?: string | null;    // cluster
}

// Prompt versions (doc/Pipeline.md "Prompts"); bumping one invalidates its cache slice.
export const PROMPT_VERSIONS = {
  symbol: 'symbol-record-v1',
  file: 'file-synthesis-v1',
  module: 'module-synthesis-v1',
  service: 'service-synthesis-v1',
  system: 'system-synthesis-v1',
  capability: 'capability-extraction-v2',
  refinement: 'refinement-v1',
  critique: 'critique-v1',
  workflow: 'workflow-record-v1',
  rerank: 'rerank-v1',
  factsOnly: 'facts-only-v1', // deterministic, no LLM
} as const;

/** Shared output rules injected into every semantic prompt. */
export const OUTPUT_RULES =
  'Rules: use ONLY the provided evidence; cite receipt ids (r1, r2, ...) in claims; ' +
  'do not guess business intent beyond the evidence; docs receipts may be stale — code receipts win; ' +
  'write "unknown" rather than inventing an answer.';

// ── Structured-output schemas ────────────────────────────────────────────────
// Strict mode: every property required; optionality is expressed as |null.

const str = { type: 'string' } as const;
const strOrNull = { type: ['string', 'null'] } as const;
const strList = { type: 'array', items: str } as const;
const strListOrNull = { type: ['array', 'null'], items: str } as const;
const confidence = { enum: ['high', 'medium', 'low'] } as const;

const claimsSchema = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['claim', 'receiptIds', 'confidence'],
    properties: { claim: str, receiptIds: strList, confidence },
  },
} as const;

const baseRecordProperties = {
  purpose: str,
  behavior: str,
  responsibilities: strList,
  business_concepts: strList,
  side_effects: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'description', 'mergedWithDeterministic'],
      properties: { kind: str, description: str, mergedWithDeterministic: { type: 'boolean' } },
    },
  },
  inputs_outputs: {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['inputs', 'outputs'],
    properties: {
      inputs: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'type', 'meaning'],
          properties: { name: str, type: strOrNull, meaning: str },
        },
      },
      outputs: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['type', 'meaning'],
          properties: { type: strOrNull, meaning: str },
        },
      },
    },
  },
  dependencies_narrative: str,
  design_patterns: strList,
  risks_invariants: strList,
  confidence,
  claims: claimsSchema,
} as const;

const BASE_REQUIRED = Object.keys(baseRecordProperties);

function recordSchema(extraProperties: Record<string, unknown> = {}): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...BASE_REQUIRED, ...Object.keys(extraProperties)],
    properties: { ...baseRecordProperties, ...extraProperties },
  };
}

export const LEVEL_EXTRA_PROPERTIES: Record<RecordLevel, Record<string, unknown>> = {
  symbol: {},
  file: { key_symbols: strListOrNull, file_role: strOrNull },
  module: { key_files: strListOrNull, internal_structure: strOrNull, boundary_contracts: strListOrNull },
  service: { runtime_shape: strOrNull },
  system: { main_capabilities: strListOrNull, architecture_narrative: strOrNull, request_flow_narrative: strOrNull },
  workflow: { step_narrative: strListOrNull, failure_modes: strListOrNull },
  capability: { user_value: strOrNull },
  cluster: { label_explanation: strOrNull, boundary_rationale: strOrNull },
};

export function schemaForLevel(level: RecordLevel): JsonSchema {
  return recordSchema(LEVEL_EXTRA_PROPERTIES[level]);
}

/** Batched symbol pass: one call returns records keyed by stable_key. */
export function batchedSymbolSchema(): JsonSchema {
  const single = recordSchema({ stable_key: str }) as { required: string[]; properties: Record<string, unknown> };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['records'],
    properties: { records: { type: 'array', items: single } },
  };
}

/** One-line display summary rendered deterministically from record fields. */
export function renderSummary(name: string, body: SemanticRecordBody): string {
  const purpose = body.purpose?.trim() || 'purpose unknown';
  return `${name}: ${purpose}`.slice(0, 500);
}
