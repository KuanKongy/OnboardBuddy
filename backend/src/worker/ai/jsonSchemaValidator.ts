/**
 * Minimal JSON-schema validator for the structured-output fallback path
 * (doc/Pipeline.md: "fall back to JSON-only prompting + server-side schema
 * validation + one retry"). Supports the subset our prompt schemas use:
 * object/required/properties, array/items, string/enum, number/integer,
 * boolean. Unknown keywords are ignored — this is a shape check, not a
 * full draft-2020 implementation.
 */

import type { JsonSchema } from './provider.js';

export interface SchemaViolation {
  path: string;
  message: string;
}

export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = '$'): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const type = schema.type as string | string[] | undefined;
  const types = type === undefined ? [] : Array.isArray(type) ? type : [type];

  if (schema.enum !== undefined) {
    const allowed = schema.enum as unknown[];
    if (!allowed.some((a) => a === value)) {
      violations.push({ path, message: `expected one of ${JSON.stringify(allowed)}` });
    }
    return violations;
  }

  if (types.length > 0 && !types.some((t) => matchesType(value, t))) {
    violations.push({ path, message: `expected ${types.join('|')}, got ${describe(value)}` });
    return violations;
  }

  if (types.includes('object') && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const required = (schema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in obj)) violations.push({ path: `${path}.${key}`, message: 'missing required property' });
    }
    const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in obj) violations.push(...validateAgainstSchema(obj[key], propSchema, `${path}.${key}`));
    }
  }

  if (types.includes('array') && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      violations.push(...validateAgainstSchema(item, schema.items as JsonSchema, `${path}[${i}]`));
    });
  }

  return violations;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Strips markdown fences and extracts the first JSON object/array from model output. */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Model wrapped the JSON in prose — take the outermost braces/brackets.
    const start = cleaned.search(/[[{]/);
    if (start === -1) throw new Error('no JSON found in model output');
    const open = cleaned[start]!;
    const close = open === '{' ? '}' : ']';
    const end = cleaned.lastIndexOf(close);
    if (end <= start) throw new Error('no JSON found in model output');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}
