const EMBEDDINGS_BASE_URL = process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1';
const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small';
const EMBEDDINGS_API_KEY = process.env.EMBEDDINGS_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '';
const EMBEDDING_DIMENSIONS = 1536;

interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { total_tokens: number };
}

export async function embedTexts(contents: string[]): Promise<number[][]> {
  if (contents.length === 0) return [];

  const res = await fetch(`${EMBEDDINGS_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${EMBEDDINGS_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDINGS_MODEL,
      input: contents,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding API error (${res.status}): ${body}`);
  }

  const data = (await res.json()) as EmbeddingResponse;
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedText(content: string): Promise<number[]> {
  const [embedding] = await embedTexts([content]);
  return embedding!;
}

// The old embedAndStore/hybridRetrieve path over semantic_summaries and
// evidence_embeddings is deleted per doc/Pipeline.md. embedTexts/embedText
// stay: the multi-view embedding service (pipeline Phase 6) reuses them
// against the new `embeddings` table keyed by (record_id, view_type, model).
