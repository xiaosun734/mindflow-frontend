import { db } from '../lib/db.ts'
import { embedTexts } from '../lib/embedding.ts'

export interface RetrievedChunk {
  chunkId: string
  documentId: string
  documentTitle: string
  heading: string | null
  content: string
  similarity: number
}

export interface SearchOptions {
  topK: number
  minSimilarity: number
}

export interface VectorStore {
  search(
    userId: string,
    queryEmbedding: number[],
    options: SearchOptions,
  ): Promise<RetrievedChunk[]>
}

export interface CachedChunk {
  chunkId: string
  documentId: string
  documentTitle: string
  heading: string | null
  content: string
  embedding: number[]
}

const CANDIDATE_LIMIT = 20
const cache = new Map<string, CachedChunk[]>()

export function invalidateRetrievalCache(userId?: string): void {
  if (userId) {
    cache.delete(userId)
  } else {
    cache.clear()
  }
}

interface ChunkRow {
  chunk_id: string
  document_id: string
  document_title: string
  heading: string | null
  content: string
  embedding: string
}

function loadChunks(userId: string): CachedChunk[] {
  const cached = cache.get(userId)
  if (cached) return cached

  const rows = db
    .prepare(
      `select c.id as chunk_id, c.document_id, d.title as document_title,
              c.heading, c.content, c.embedding
       from chunks c
       join documents d on d.id = c.document_id
       where d.user_id = ? and d.status = 'ready' and c.embedding is not null`,
    )
    .all(userId) as unknown as ChunkRow[]

  const chunks: CachedChunk[] = []

  for (const row of rows) {
    try {
      const embedding = JSON.parse(row.embedding) as unknown
      if (!Array.isArray(embedding) || embedding.length === 0) continue
      if (!embedding.every((value) => typeof value === 'number')) continue

      chunks.push({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        heading: row.heading,
        content: row.content,
        embedding,
      })
    } catch {
      // 跳过损坏的 embedding，避免整个检索失败
    }
  }

  cache.set(userId, chunks)
  return chunks
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function rankChunks(
  queryEmbedding: number[],
  chunks: CachedChunk[],
  options: SearchOptions,
): RetrievedChunk[] {
  const topK = Math.max(0, Math.floor(options.topK))

  return chunks
    .map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      heading: chunk.heading,
      content: chunk.content,
      similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CANDIDATE_LIMIT)
    .filter((chunk) => chunk.similarity >= options.minSimilarity)
    .slice(0, topK)
}

class SqliteVectorStore implements VectorStore {
  async search(
    userId: string,
    queryEmbedding: number[],
    options: SearchOptions,
  ): Promise<RetrievedChunk[]> {
    return rankChunks(queryEmbedding, loadChunks(userId), options)
  }
}

export const vectorStore: VectorStore = new SqliteVectorStore()

export async function retrieveChunks(
  userId: string,
  query: string,
  options: SearchOptions,
): Promise<RetrievedChunk[]> {
  const embeddings = await embedTexts([query])
  const queryEmbedding = embeddings[0]
  if (!queryEmbedding) return []

  return vectorStore.search(userId, queryEmbedding, options)
}
