import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from './chunking.ts'

describe('chunkMarkdown', () => {
  it('没有标题时生成一个 chunk', () => {
    const chunks = chunkMarkdown('这是一段没有标题的普通文本。')

    expect(chunks).toHaveLength(1)
    expect(chunks[0].heading).toBeNull()
    expect(chunks[0].content).toBe('这是一段没有标题的普通文本。')
  })

  it('保留嵌套标题路径', () => {
    const source = ['# 事件循环', '总览', '## 微任务', '微任务内容', '### Promise', 'Promise 内容'].join(
      '\n\n',
    )

    const chunks = chunkMarkdown(source)

    expect(chunks.map((chunk) => chunk.heading)).toEqual([
      '事件循环',
      '事件循环 > 微任务',
      '事件循环 > 微任务 > Promise',
    ])
  })

  it('不把代码块里的 # 当成标题', () => {
    const source = ['# 真实标题', '```md', '# 代码里的标题', '```'].join('\n')

    const chunks = chunkMarkdown(source)

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

    const chunks = chunkMarkdown(source)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.charCount <= 1200)).toBe(true)
    expect(chunks[1].content.startsWith(chunks[0].content.slice(-150))).toBe(true)
  })

  it('空文档返回空数组', () => {
    expect(chunkMarkdown('   \n\n  ')).toEqual([])
  })
})
