import { describe, expect, it } from 'vitest'
import { buildRagContext, buildRagMessages, extractCitations } from './rag.ts'
import type { RetrievedChunk } from './retrieval.ts'

const chunks: RetrievedChunk[] = [
  {
    chunkId: 'c1',
    documentId: 'd1',
    documentTitle: '事件循环.md',
    heading: '微任务',
    content: '微任务会在当前宏任务结束后立即执行。',
    similarity: 0.92,
  },
  {
    chunkId: 'c2',
    documentId: 'd2',
    documentTitle: 'Promise.md',
    heading: null,
    content: 'Promise 有三种状态。',
    similarity: 0.81,
  },
]

describe('buildRagContext', () => {
  it('生成带编号和标题路径的 context', () => {
    const rag = buildRagContext(chunks)

    expect(rag.citations.map((citation) => citation.index)).toEqual([1, 2])
    expect(rag.context).toContain('[1] 文档：事件循环.md > 微任务')
    expect(rag.context).toContain('[2] 文档：Promise.md')
    expect(rag.context).toContain('微任务会在当前宏任务结束后立即执行。')
  })
})

describe('buildRagMessages', () => {
  it('把 context 放进 system 消息', () => {
    const messages = buildRagMessages([{ role: 'user', content: '微任务是什么？' }], 'context')
    const system = messages[0]

    expect(system.role).toBe('system')
    expect(typeof system.content === 'string' ? system.content : '').toContain('<context>')
    expect(typeof system.content === 'string' ? system.content : '').toContain('context')
  })
})

describe('extractCitations', () => {
  it('提取、去重并按编号排序', () => {
    const rag = buildRagContext(chunks)
    const used = extractCitations('先执行微任务 [1]，然后执行宏任务 [2]，再看一次 [1]。', rag.citations)

    expect(used.map((citation) => citation.index)).toEqual([1, 2])
  })

  it('忽略越界编号', () => {
    const rag = buildRagContext(chunks)
    const used = extractCitations('不存在 [9]', rag.citations)

    expect(used).toEqual([])
  })
})
