export const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/

export const DEFAULT_TARGET_MAX = 1200
export const DEFAULT_OVERLAP = 150

/**
 * 按空行切段落，同时保证代码围栏内部的空行不会切断代码块。
 */
export function splitBlocks(text: string): string[] {
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

/**
 * 把过长的文本按块累积，超过 max 时切分，并保留 overlap 字符重叠。
 */
export function splitLongText(
  text: string,
  max = DEFAULT_TARGET_MAX,
  overlap = DEFAULT_OVERLAP,
): string[] {
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
    if (block.length > max) {
      flush()

      const step = Math.max(1, max - overlap)
      for (let start = 0; start < block.length; start += step) {
        const piece = block.slice(start, start + max).trim()
        if (piece) {
          chunks.push(piece)
        }
        if (start + max >= block.length) {
          break
        }
      }
      continue
    }

    if (!current) {
      current = block
      continue
    }

    if (current.length + 2 + block.length <= max) {
      current += `\n\n${block}`
      continue
    }

    flush()

    const previous = chunks[chunks.length - 1] ?? ''
    const tail = previous.slice(-overlap)
    const candidate = tail ? `${tail}\n\n${block}` : block
    current = candidate.length <= max ? candidate : block
  }

  flush()
  return chunks
}
