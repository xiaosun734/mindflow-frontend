import { describe, expect, it } from 'vitest'
import { cosineSimilarity, rankChunks, type CachedChunk } from './retrieval.ts'

describe('cosineSimilarity', () => {
  it('相同向量相似度为 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
  })

  it('正交向量相似度为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('相反向量相似度为 -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1)
  })

  it('维度不一致时返回 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
  })
})

describe('rankChunks', () => {
  const chunks: CachedChunk[] = [
    {
      chunkId: 'a',
      documentId: 'd1',
      documentTitle: '事件循环.md',
      heading: '总览',
      content: 'a',
      embedding: [1, 0],
    },
    {
      chunkId: 'b',
      documentId: 'd1',
      documentTitle: '事件循环.md',
      heading: '微任务',
      content: 'b',
      embedding: [0.8, 0.2],
    },
    {
      chunkId: 'c',
      documentId: 'd2',
      documentTitle: 'Promise.md',
      heading: null,
      content: 'c',
      embedding: [0, 1],
    },
  ]

  it('按相似度排序并过滤阈值', () => {
    const results = rankChunks([1, 0], chunks, {
      topK: 2,
      minSimilarity: 0.5,
    })

    expect(results.map((chunk) => chunk.chunkId)).toEqual(['a', 'b'])
  })

  it('topK 为 0 时返回空数组', () => {
    const results = rankChunks([1, 0], chunks, {
      topK: 0,
      minSimilarity: 0,
    })

    expect(results).toEqual([])
  })
})
