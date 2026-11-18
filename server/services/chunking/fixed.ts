import type { ChunkingStrategy, TextChunk } from './types.ts'

const FIXED_SIZE = 1000
const FIXED_OVERLAP = 150

export const fixedSizeChunker: ChunkingStrategy = {
  name: 'fixed',
  label: '固定长度窗口',
  description: '按固定字符数切分，适合没有标题和段落结构的文本',
  chunk(source: string): TextChunk[] {
    const text = source.replace(/\r\n/g, '\n').trim()
    if (!text) return []

    const chunks: TextChunk[] = []
    const step = FIXED_SIZE - FIXED_OVERLAP

    for (let start = 0; start < text.length; start += step) {
      const content = text.slice(start, start + FIXED_SIZE).trim()
      if (content) {
        chunks.push({
          heading: null,
          content,
          charCount: content.length,
        })
      }

      if (start + FIXED_SIZE >= text.length) {
        break
      }
    }

    return chunks
  },
}
