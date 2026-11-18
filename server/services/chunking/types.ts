export interface TextChunk {
  heading: string | null
  content: string
  charCount: number
}

export interface ChunkingStrategy {
  name: string
  label: string
  description: string
  chunk(source: string): TextChunk[]
}
