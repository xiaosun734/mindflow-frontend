const TARGET_MAX = 1200
const OVERLAP = 150

const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/

export interface TextChunk {
  heading: string | null
  content: string
  charCount: number
}

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

function splitBlocks(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  let buffer: string[] = []
  let inFence = false
  let fenceChar = ''
  let fenceLength = 0

  const flush = () => {
    const block = buffer.join('\n').trim()
    if (block) {
      blocks.push(block)
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

    if (!inFence && line.trim() === '') {
      flush()
      continue
    }

    buffer.push(line)
  }

  flush()
  return blocks
}

function splitLongText(text: string): string[] {
  const blocks = splitBlocks(text)
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    const content = current.trim()
    if (content) {
      chunks.push(content)
    }
    current = ''
  }

  for (const block of blocks) {
    if (block.length > TARGET_MAX) {
      flush()

      for (let start = 0; start < block.length; start += TARGET_MAX - OVERLAP) {
        const piece = block.slice(start, start + TARGET_MAX).trim()
        if (piece) {
          chunks.push(piece)
        }
        if (start + TARGET_MAX >= block.length) {
          break
        }
      }
      continue
    }

    if (!current) {
      current = block
      continue
    }

    if (current.length + 2 + block.length <= TARGET_MAX) {
      current += `\n\n${block}`
      continue
    }

    flush()

    const previous = chunks[chunks.length - 1] ?? ''
    const overlap = previous.slice(-OVERLAP)
    const candidate = overlap ? `${overlap}\n\n${block}` : block
    current = candidate.length <= TARGET_MAX ? candidate : block
  }

  flush()
  return chunks
}

/**
 * 按 Markdown 标题切 section，再按段落切成 800–1200 字左右的 chunk。
 * 代码围栏内的标题和空行不会被误切。
 */
export function chunkMarkdown(source: string): TextChunk[] {
  const sections = splitSections(source)
  const chunks: TextChunk[] = []

  for (const section of sections) {
    const pieces =
      section.content.length <= TARGET_MAX ? [section.content] : splitLongText(section.content)

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
}
