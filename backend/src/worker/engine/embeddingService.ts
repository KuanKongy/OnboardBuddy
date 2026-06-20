import { query } from '../../lib/db.js';

const EMBEDDINGS_BASE_URL = process.env.EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1';
const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small';
const EMBEDDINGS_API_KEY = process.env.EMBEDDINGS_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '';
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 20;

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

export interface EmbeddingTarget {
  summaryId: string;
  targetType: string;
  targetId: string;
  content: string;
}

export async function embedAndStore(
  snapshotId: string,
  targets: EmbeddingTarget[],
): Promise<void> {
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const contents = batch.map((t) => t.content);
    const embeddings = await embedTexts(contents);

    for (let j = 0; j < batch.length; j++) {
      const t = batch[j]!;
      const embedding = embeddings[j]!;
      const vectorStr = `[${embedding.join(',')}]`;

      await query(
        `INSERT INTO evidence_embeddings
           (snapshot_id, summary_id, target_type, target_id, content, embedding, provider, model, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)`,
        [
          snapshotId,
          t.summaryId,
          t.targetType,
          t.targetId,
          t.content,
          vectorStr,
          'openai',
          EMBEDDINGS_MODEL,
          JSON.stringify({}),
        ],
      );
    }
  }
}

export async function hybridRetrieve(
  snapshotId: string,
  queryText: string,
  limit = 12,
): Promise<Array<{ id: string; content: string; similarity: number; target_type: string; target_id: string }>> {
  const queryEmbedding = await embedText(queryText);
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const result = await query(
    `SELECT ee.id, ee.content, ee.target_type, ee.target_id,
            1 - (ee.embedding <=> $1::vector) AS similarity
     FROM evidence_embeddings ee
     WHERE ee.snapshot_id = $2
     ORDER BY ee.embedding <=> $1::vector
     LIMIT $3`,
    [vectorStr, snapshotId, limit],
  );

  return result.rows as Array<{ id: string; content: string; similarity: number; target_type: string; target_id: string }>;
}
