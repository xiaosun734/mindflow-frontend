import { describe, expect, it } from 'vitest'
import { normalizeMarkdown } from './markdown-normalize'

describe('normalizeMarkdown', () => {
  it('给没有语言名的代码块补 text', () => {
    const input = '```\nconst answer = 42\n```'
    const expected = '```text\nconst answer = 42\n```'

    expect(normalizeMarkdown(input)).toBe(expected)
  })

  it('保留已有语言名的代码块', () => {
    const input = '```ts\nconst answer: number = 42\n```'

    expect(normalizeMarkdown(input)).toBe(input)
  })

  it('给缺少分隔行的表格补默认分隔行', () => {
    const input = '| 方法 | 作用 |\n| GET | 查询 |'
    const expected = '| 方法 | 作用 |\n| --- | --- |\n| GET | 查询 |'

    expect(normalizeMarkdown(input)).toBe(expected)
  })

  it('保留已有的对齐分隔行', () => {
    const input = '| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| a | b | c |'

    expect(normalizeMarkdown(input)).toBe(input)
  })

  it('不修改代码块里的表格文本', () => {
    const input = '```ts\nconst text = "| a | b |"\n```'

    expect(normalizeMarkdown(input)).toBe(input)
  })
})
