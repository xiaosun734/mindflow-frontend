import { describe, expect, it } from 'vitest'
import {
  fixedSizeChunker,
  getChunker,
  listChunkers,
  markdownChunker,
  plainTextChunker,
} from './chunking/index.ts'

describe('markdownChunker', () => {
  it('没有标题时生成一个 chunk', () => {
    const chunks = markdownChunker.chunk('这是一段没有标题的普通文本。')

    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBeNull()
    expect(chunks[0].content).toBe('这是一段没有标题的普通文本。')
  })

  it('保留嵌套标题路径', () => {
    const source = ['# 事件循环', '总览', '## 微任务', '微任务内容', '### Promise', 'Promise 内容'].join(
      '\n\n',
    )

    const chunks = markdownChunker.chunk(source)

    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      '事件循环',
      '事件循环 > 微任务',
      '事件循环 > 微任务 > Promise',
    ])
  })

  it('不把代码块里的 # 当成标题', () => {
    const source = ['# 真实标题', '```md', '# 代码里的标题', '```'].join('\n')

    const chunks = markdownChunker.chunk(source)

    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBe('真实标题')
    expect(chunks[0].content).toContain('# 代码里的标题')
  })

  it('长文本会切成多个 chunk，并保留重叠', () => {
    const paragraphs = Array.from(
      { length: 6 },
      (_, index) => `${index}：${'内容'.repeat(150)}`,
    )
    const source = `# 长文\n\n${paragraphs.join('\n\n')}`

    const chunks = markdownChunker.chunk(source)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.charCount <= 1200)).toBe(true)
    expect(chunks[1].content.startsWith(chunks[0].content.slice(-150))).toBe(true)
  })

  it('空文档返回空数组', () => {
    expect(markdownChunker.chunk('   \n\n  ')).toEqual([])
  })
})

describe('plainTextChunker', () => {
  it('不识别 Markdown 标题，heading 永远是 null', () => {
    const chunks = plainTextChunker.chunk('# 标题\n\n正文内容')

    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBeNull()
    expect(chunks[0].content).toContain('# 标题')
  })
})

describe('fixedSizeChunker', () => {
  it('按固定长度切分并保留重叠', () => {
    const text = 'a'.repeat(2500)
    const chunks = fixedSizeChunker.chunk(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.charCount <= 1000)).toBe(true)
    expect(chunks[1].content.startsWith(chunks[0].content.slice(-150))).toBe(true)
  })
})

describe('chunking registry', () => {
  it('列出内置策略', () => {
    expect(listChunkers().map((chunker) => chunker.name)).toEqual([
      'markdown',
      'plain',
      'fixed',
    ])
  })

  it('按名字获取策略', () => {
    expect(getChunker('plain')).toBe(plainTextChunker)
  })

  it('未知策略抛错', () => {
    expect(() => getChunker('unknown')).toThrow('Unknown chunking strategy')
  })
})
