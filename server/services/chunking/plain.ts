import { DEFAULT_TARGET_MAX, splitLongText } from './shared.ts'
import type { ChunkingStrategy, TextChunk } from './types.ts'

export const plainTextChunker: ChunkingStrategy = {
  name: 'plain',
  label: '纯文本段落',
  description: '只按空行分段，不识别 Markdown 标题，适合普通 TXT',
  chunk(source: string): TextChunk[] {
    const text = source.replace(/\r\n/g, '\n').trim()
    if (!text) return []

    const pieces = text.length <= DEFAULT_TARGET_MAX ? [text] : splitLongText(text)

    return pieces.map((content) => ({
      heading: null,
      content,
      charCount: content.length,
    }))
  },
}
