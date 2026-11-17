import { describe, expect, it } from 'vitest'
import { normalizeSessionId, resolveUpstreamHeaders } from './upstream.ts'

describe('resolveUpstreamHeaders', () => {
  it('为 opencode.ai 加上 x-opencode-session', () => {
    const headers = resolveUpstreamHeaders({
      baseURL: 'https://opencode.ai/inference/go/openai/v1',
      sessionId: 'session-1',
    })

    expect(headers['x-opencode-session']).toBe('session-1')
    expect(headers['User-Agent']).toBe('mindflow/1.0')
  })

  it('其他服务商不加 x-opencode-session', () => {
    const headers = resolveUpstreamHeaders({
      baseURL: 'https://api.deepseek.com',
      sessionId: 'session-1',
    })

    expect(headers['x-opencode-session']).toBeUndefined()
  })
})

describe('normalizeSessionId', () => {
  it('会去掉首尾空格', () => {
    expect(normalizeSessionId('  session-1  ')).toBe('session-1')
  })

  it('缺失时生成 UUID', () => {
    expect(normalizeSessionId(undefined)).toMatch(/^[0-9a-f-]{36}$/)
  })
})
