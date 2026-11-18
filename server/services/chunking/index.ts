import { fixedSizeChunker } from './fixed.ts'
import { markdownChunker } from './markdown.ts'
import { plainTextChunker } from './plain.ts'
import type { ChunkingStrategy } from './types.ts'

export type { ChunkingStrategy, TextChunk } from './types.ts'
export { fixedSizeChunker, markdownChunker, plainTextChunker }

const strategies = new Map<string, ChunkingStrategy>()

export function registerChunker(strategy: ChunkingStrategy): void {
  strategies.set(strategy.name, strategy)
}

registerChunker(markdownChunker)
registerChunker(plainTextChunker)
registerChunker(fixedSizeChunker)

export function listChunkers(): ChunkingStrategy[] {
  return [...strategies.values()]
}

export function getChunker(name: string): ChunkingStrategy {
  const strategy = strategies.get(name)
  if (!strategy) {
    const available = listChunkers()
      .map((item) => item.name)
      .join(', ')
    throw new Error(`Unknown chunking strategy: ${name}. Available: ${available}`)
  }
  return strategy
}
