/**
 * OpenRouter provider (doc/Pipeline.md "Provider abstraction") — the only
 * AiProvider implementation for now. Talks the OpenAI-compatible wire
 * protocol directly over fetch so tests can inject a fetchImpl (same
 * pattern as churnService).
 *
 * Structured outputs use `response_format: { type: 'json_schema', strict }`;
 * when the configured model rejects strict schemas, we fall back to
 * JSON-only prompting + server-side schema validation + one retry, then
 * surface StructuredOutputError for the tier's failure behavior to handle.
 */

import {
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type ProviderCallOptions,
  type StructuredRequest,
  type StructuredResult,
  type TokenUsage,
  ProviderError,
  StructuredOutputError,
  isRetryableStatus,
} from './provider.js';
import { validateAgainstSchema, extractJson } from './jsonSchemaValidator.js';

type FetchImpl = typeof fetch;

export interface OpenRouterProviderOptions {
  baseUrl?: string;
  embeddingsBaseUrl?: string;
  fetchImpl?: FetchImpl;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface EmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

const EMBEDDING_DIMENSIONS = 1536;

export class OpenRouterProvider implements AiProvider {
  readonly id = 'openrouter';
  private readonly baseUrl: string;
  private readonly embeddingsBaseUrl: string;
  private readonly fetchImpl: FetchImpl;

  constructor(options: OpenRouterProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
    this.embeddingsBaseUrl = options.embeddingsBaseUrl ?? process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(req: CompletionRequest, opts: ProviderCallOptions): Promise<CompletionResult> {
    const body = this.chatBody(req);
    const data = await this.post<ChatCompletionResponse>(`${this.baseUrl}/chat/completions`, body, opts);
    return this.toCompletionResult(data);
  }

  async completeStructured<T = unknown>(req: StructuredRequest, opts: ProviderCallOptions): Promise<StructuredResult<T>> {
    // Attempt 1: strict json_schema response_format.
    let usedSchemaFallback = false;
    let result: CompletionResult;
    try {
      const body = {
        ...this.chatBody(req),
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, strict: true, schema: req.schema },
        },
      };
      const data = await this.post<ChatCompletionResponse>(`${this.baseUrl}/chat/completions`, body, opts);
      result = this.toCompletionResult(data);
    } catch (err) {
      if (!isSchemaRejection(err)) throw err;
      usedSchemaFallback = true;
      result = await this.completeJsonPrompted(req, opts);
    }

    const parsed = this.parseAndValidate(result.content, req);
    if (parsed.ok) return { value: parsed.value as T, usage: result.usage, usedSchemaFallback };

    // One validation retry with the violations spelled out.
    const retryReq: StructuredRequest = {
      ...req,
      messages: [
        ...req.messages,
        { role: 'assistant', content: result.content },
        {
          role: 'user',
          content: `Your previous response was not valid JSON matching the required schema (${parsed.error}). Respond again with ONLY the corrected JSON object, no explanation.`,
        },
      ],
    };
    const retry = await this.completeJsonPrompted(retryReq, opts);
    const usage: TokenUsage = {
      inputTokens: result.usage.inputTokens + retry.usage.inputTokens,
      outputTokens: result.usage.outputTokens + retry.usage.outputTokens,
    };
    const reparsed = this.parseAndValidate(retry.content, req);
    if (reparsed.ok) return { value: reparsed.value as T, usage, usedSchemaFallback: true };
    throw new StructuredOutputError(`structured output failed validation after retry: ${reparsed.error}`, retry.content);
  }

  async embed(inputs: string[], model: string, opts: ProviderCallOptions): Promise<{ vectors: number[][]; usage: TokenUsage }> {
    if (inputs.length === 0) return { vectors: [], usage: { inputTokens: 0, outputTokens: 0 } };
    const data = await this.post<EmbeddingResponse>(
      `${this.embeddingsBaseUrl}/embeddings`,
      { model, input: inputs, dimensions: EMBEDDING_DIMENSIONS },
      opts,
    );
    const vectors = (data.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== inputs.length) {
      throw new ProviderError(`embedding API returned ${vectors.length} vectors for ${inputs.length} inputs`, null, false);
    }
    return {
      vectors,
      usage: { inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0, outputTokens: 0 },
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private chatBody(req: CompletionRequest): Record<string, unknown> {
    // OpenRouter routes each model to one of several upstreams; measured
    // decode on the default route varied 12–124 tok/s for the same model.
    // 'throughput' asks OpenRouter to prefer the fastest upstream. Set
    // OPENROUTER_PROVIDER_SORT="" to disable (e.g. non-OpenRouter base URL).
    // data_collection 'deny' is the privacy half of "sort by privacy then
    // throughput": OpenRouter excludes providers that retain/train on
    // prompts (the only machine-enforceable policy signal — the endpoints
    // API exposes no per-provider retention fields). Set
    // OPENROUTER_DATA_COLLECTION="" to disable.
    const sort = process.env.OPENROUTER_PROVIDER_SORT ?? 'throughput';
    const dataCollection = process.env.OPENROUTER_DATA_COLLECTION ?? 'deny';
    const providerPrefs = {
      ...(sort ? { sort } : {}),
      ...(dataCollection ? { data_collection: dataCollection } : {}),
    };
    return {
      model: req.model,
      messages: req.messages,
      ...(req.maxOutputTokens !== undefined ? { max_tokens: req.maxOutputTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(Object.keys(providerPrefs).length > 0 ? { provider: providerPrefs } : {}),
    };
  }

  /** JSON-only prompting: schema pasted into the prompt, no response_format. */
  private async completeJsonPrompted(req: StructuredRequest, opts: ProviderCallOptions): Promise<CompletionResult> {
    const schemaNote = `Respond with ONLY a JSON value matching this JSON schema (no markdown fences, no prose):\n${JSON.stringify(req.schema)}`;
    const messages = [...req.messages];
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${schemaNote}` };
    } else {
      messages.push({ role: 'user', content: schemaNote });
    }
    const data = await this.post<ChatCompletionResponse>(
      `${this.baseUrl}/chat/completions`,
      this.chatBody({ ...req, messages }),
      opts,
    );
    return this.toCompletionResult(data);
  }

  private parseAndValidate(content: string, req: StructuredRequest): { ok: true; value: unknown } | { ok: false; error: string } {
    let value: unknown;
    try {
      value = extractJson(content);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unparseable JSON' };
    }
    // Small models routinely emit null where the schema wants an empty array
    // (observed live: scout's `"outputs": null` failed 25 symbol batches into
    // the halving-retry path). null-for-[] is semantically "none" — coerce it
    // schema-aware instead of burning a full revalidation round trip.
    value = coerceNullArrays(value, req.schema);
    const violations = validateAgainstSchema(value, req.schema);
    if (violations.length > 0) {
      return { ok: false, error: violations.slice(0, 5).map((v) => `${v.path}: ${v.message}`).join('; ') };
    }
    return { ok: true, value };
  }

  private toCompletionResult(data: ChatCompletionResponse): CompletionResult {
    const content = data.choices?.[0]?.message?.content ?? '';
    if (!content) throw new ProviderError('provider returned an empty completion', null, true);
    return {
      content,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  private async post<T>(url: string, body: Record<string, unknown>, opts: ProviderCallOptions): Promise<T> {
    // Hard per-attempt deadline: observed calls running 550–800s on slow
    // upstreams with no timeout at all. An aborted attempt surfaces as a
    // retryable ProviderError, so withRetries / batch-halving take over.
    const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS ?? 240_000);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // Network-level failure (incl. per-attempt timeout): retryable.
      throw new ProviderError(err instanceof Error ? err.message : String(err), null, true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(`provider HTTP ${res.status}: ${text.slice(0, 500)}`, res.status, isRetryableStatus(res.status));
    }
    return (await res.json()) as T;
  }
}

/** A 4xx complaining about response_format/json_schema means the model can't do strict schemas. */
function isSchemaRejection(err: unknown): boolean {
  if (!(err instanceof ProviderError) || err.status === null) return false;
  if (err.status < 400 || err.status >= 500) return false;
  return /response_format|json_schema|structured|schema/i.test(err.message);
}

/**
 * Walk value and schema together, replacing null with [] wherever the schema
 * declares an array. Only that one coercion: everything else still has to
 * pass validation honestly. Exported for tests.
 */
export function coerceNullArrays(value: unknown, schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') return value;
  const s = schema as Record<string, unknown>;
  const types = Array.isArray(s.type) ? s.type : typeof s.type === 'string' ? [s.type] : [];

  if (value === null && types.includes('array') && !types.includes('null')) return [];

  if (Array.isArray(value) && types.includes('array')) {
    const items = s.items;
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      return value.map((v) => coerceNullArrays(v, items));
    }
    return value;
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const props = s.properties;
    if (props && typeof props === 'object') {
      const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
      for (const [key, propSchema] of Object.entries(props as Record<string, unknown>)) {
        if (key in out) out[key] = coerceNullArrays(out[key], propSchema);
      }
      return out;
    }
  }
  return value;
}
