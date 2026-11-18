import { DEFAULT_TARGET_MAX, FENCE_PATTERN, splitLongText } from './shared.ts'
import type { ChunkingStrategy, TextChunk } from './types.ts'

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/

interface Section {
  heading: string | null
  content: string
}

interface HeadingItem {
  level: number
  title: string
}

function splitSections(source: string): Section[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const sections: Section[] = []
  const headings: HeadingItem[] = []
  let currentHeading: string | null = null
  let buffer: string[] = []
  let inFence = false
  let fenceChar = ''
  let fenceLength = 0

  const flush = () => {
    const content = buffer.join('\n').trim()
    if (content) {
      sections.push({ heading: currentHeading, content })
    }
    buffer = []
  }

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_PATTERN)

    if (fenceMatch) {
      const marker = fenceMatch[2]
      if (!inFence) {
        inFence = true
        fenceChar = marker[0]
        fenceLength = marker.length
      } else if (marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false
      }
      buffer.push(line)
      continue
    }

    if (!inFence) {
      const headingMatch = line.match(HEADING_PATTERN)
      if (headingMatch) {
        flush()
        const level = headingMatch[1].length
        const title = headingMatch[2].trim()

        while (headings.length > 0 && headings[headings.length - 1].level >= level) {
          headings.pop()
        }
        headings.push({ level, title })
        currentHeading = headings.map((item) => item.title).join(' > ')
        continue
      }
    }

    buffer.push(line)
  }

  flush()
  return sections
}

export const markdownChunker: ChunkingStrategy = {
  name: 'markdown',
  label: 'Markdown 标题感知',
  description: '按 #/##/### 标题切 section，再按段落切块，保留标题路径',
  chunk(source: string): TextChunk[] {
    const sections = splitSections(source)
    const chunks: TextChunk[] = []

    for (const section of sections) {
      const pieces =
        section.content.length <= DEFAULT_TARGET_MAX
          ? [section.content]
          : splitLongText(section.content)

      for (const piece of pieces) {
        const content = piece.trim()
        if (!content) continue

        chunks.push({
          heading: section.heading,
          content,
          charCount: content.length,
        })
      }
    }

    return chunks
  },
}
