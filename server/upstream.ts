import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export interface UpstreamHeaderOptions {
  baseURL?: string
  sessionId: string
}

/** 会话 ID 缺失或非法时生成一个临时 ID，保证请求仍能发往上游 */
export function normalizeSessionId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : randomUUID()
}

/**
 * 根据上游地址决定请求头。
 * 新增服务商时在这里补一条规则即可，不需要改路由处理函数。
 */
export function resolveUpstreamHeaders({
  baseURL,
  sessionId,
}: UpstreamHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'mindflow/1.0',
  }

  let hostname = ''
  try {
    hostname = baseURL ? new URL(baseURL).hostname : ''
  } catch {
    // 非法 baseURL 交给 OpenAI SDK 报错，这里只使用默认头
  }

  // OpenCode Go：所有模型共用同一个会话路由头
  if (hostname === 'opencode.ai' || hostname.endsWith('.opencode.ai')) {
    headers['x-opencode-session'] = sessionId
  }

  // 其他服务商的自定义头可通过 UPSTREAM_HEADERS 补充，{sessionId} 会被替换
  const extra = process.env.UPSTREAM_HEADERS
  if (extra) {
    try {
      const parsed: unknown = JSON.parse(extra)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') {
            headers[key] = value.replaceAll('{sessionId}', sessionId)
          }
        }
      }
    } catch {
      // eslint-disable-next-line no-console
      console.warn('UPSTREAM_HEADERS 不是合法的 JSON，已忽略该配置')
    }
  }

  return headers
}

/**
 * 中间件：解析会话 ID，并按当前上游生成请求头，挂到 res.locals.upstreamHeaders。
 * 这样切换模型/服务商时，只要改 .env 即可，业务路由无需感知差异。
 */
export function upstreamHeadersMiddleware(getBaseURL: () => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { sessionId } = (req.body ?? {}) as { sessionId?: unknown }
    const resolvedSessionId = normalizeSessionId(sessionId)
    res.locals.sessionId = resolvedSessionId
    res.locals.upstreamHeaders = resolveUpstreamHeaders({
      baseURL: getBaseURL(),
      sessionId: resolvedSessionId,
    })
    next()
  }
}
