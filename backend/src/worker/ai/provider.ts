/**
 * Abstract AI provider layer (doc/Pipeline.md "Provider abstraction").
 * Only OpenRouter is implemented for now; the interface exists so other
 * providers can plug in without touching the pipeline.
 */

export type ModelTier = 'cheap' | 'strong' | 'embedding';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  content: string;
  usage: TokenUsage;
}

/** JSON schema for structured outputs (subset: object/array/string/number/boolean/enum). */
export type JsonSchema = Record<string, unknown>;

export interface StructuredRequest extends CompletionRequest {
  schemaName: string;
  schema: JsonSchema;
}

export interface StructuredResult<T = unknown> {
  value: T;
  usage: TokenUsage;
  /** True when the model rejected strict json_schema and the JSON-prompt fallback served the request. */
  usedSchemaFallback: boolean;
}

export interface ProviderCallOptions {
  apiKey: string;
  signal?: AbortSignal;
}

export interface AiProvider {
  id: string; // 'openrouter'
  complete(req: CompletionRequest, opts: ProviderCallOptions): Promise<CompletionResult>;
  completeStructured<T = unknown>(req: StructuredRequest, opts: ProviderCallOptions): Promise<StructuredResult<T>>;
  embed(inputs: string[], model: string, opts: ProviderCallOptions): Promise<{ vectors: number[][]; usage: TokenUsage }>;
}

// ── Error taxonomy ───────────────────────────────────────────────────────────

/** HTTP/transport failure from a provider. `retryable` drives the retry behavior. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    /**
     * The upstream's own Retry-After, in ms, when it sent a usable one. It
     * beats any backoff schedule we could guess at: on a 429 the provider is
     * the only party that knows when its window reopens.
     */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** The model produced output that failed schema validation after all fallbacks. */
export class StructuredOutputError extends Error {
  constructor(message: string, public readonly rawOutput: string) {
    super(message);
    this.name = 'StructuredOutputError';
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
