const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/

function normalizeCodeFences(source: string): string {
  const lines = source.split('\n')
  let inFence = false
  let fenceChar = ''
  let fenceLength = 0

  return lines
    .map((line) => {
      const match = line.match(FENCE_PATTERN)
      if (!match) return line

      const [, indent, marker, info] = match

      if (!inFence) {
        inFence = true
        fenceChar = marker[0]
        fenceLength = marker.length
        return info.trim() ? line : `${indent}${marker}text`
      }

      if (marker[0] === fenceChar && marker.length >= fenceLength) {
        inFence = false
      }
      return line
    })
    .join('\n')
}

function splitRow(line: string): string[] {
  const trimmed = line.trim()
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return withoutEdges.split('|').map((cell) => cell.trim())
}

function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function normalizeTables(source: string): string {
  const lines = source.split('\n')
  const output: string[] = []
  let inFence = false
  let fenceChar = ''
  let fenceLength = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
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
      output.push(line)
      continue
    }

    if (inFence) {
      output.push(line)
      continue
    }

    // 已经是表格分隔行，不要再把它当成表头
    if (isDelimiterRow(line)) {
      output.push(line)
      continue
    }

    const next = lines[index + 1]
    const cells = splitRow(line)
    const nextCells = next ? splitRow(next) : []

    if (
      line.includes('|') &&
      next &&
      next.includes('|') &&
      !isDelimiterRow(next) &&
      cells.length >= 2 &&
      cells.length === nextCells.length
    ) {
      const hasLeadingPipe = line.trim().startsWith('|')
      const hasTrailingPipe = line.trim().endsWith('|')
      const delimiterCells = Array.from({ length: cells.length }, () => '---')
      const delimiter = `${hasLeadingPipe ? '| ' : ''}${delimiterCells.join(' | ')}${
        hasTrailingPipe ? ' |' : ''
      }`

      output.push(line, delimiter)
      continue
    }

    output.push(line)
  }

  return output.join('\n')
}

/**
 * 在渲染前做一次轻量规范化：
 * - 代码块缺少语言时补 text
 * - 表格缺少第二行分隔行时自动补一行
 *
 * 它只处理“能安全推断”的情况，不替换正常内容。
 */
export function normalizeMarkdown(source: string): string {
  return normalizeTables(normalizeCodeFences(source))
}
