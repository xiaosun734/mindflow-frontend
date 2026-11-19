import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { RAG_SYSTEM_PROMPT } from '../lib/prompt.ts'
import type { RetrievedChunk } from './retrieval.ts'

export interface Citation {
  index: number
  chunkId: string
  documentId: string
  documentTitle: string
  heading: string | null
  content: string
  similarity: number
}

export interface RagContext {
  context: string
  citations: Citation[]
}

export function buildRagContext(chunks: RetrievedChunk[]): RagContext {
  const citations: Citation[] = chunks.map((chunk, index) => ({
    index: index + 1,
    ...chunk,
  }))

  const context = citations
    .map((citation) => {
      const source = citation.heading
        ? `${citation.documentTitle} > ${citation.heading}`
        : citation.documentTitle
      return `[${citation.index}] 文档：${source}\n内容：${citation.content}`
    })
    .join('\n\n')

  return { context, citations }
}

export function buildRagMessages(
  messages: ChatCompletionMessageParam[],
  context: string,
): ChatCompletionMessageParam[] {
  return [
    {
      role: 'system',
      content: `${RAG_SYSTEM_PROMPT}\n\n<context>\n${context}\n</context>`,
    },
    ...messages,
  ]
}

export function extractCitations(content: string, citations: Citation[]): Citation[] {
  const indexes = new Set<number>()

  for (const match of content.matchAll(/\[(\d+)\]/g)) {
    const index = Number(match[1])
    if (Number.isInteger(index) && index >= 1 && index <= citations.length) {
      indexes.add(index)
    }
  }

  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => citations[index - 1])
}
