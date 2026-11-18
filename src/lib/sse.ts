export interface SseEvent {
  event: string
  data: unknown
}

/**
 * 读取 fetch 的流式响应，按 SSE 协议解析成事件。
 * 支持事件被拆到多个网络分片里。
 */
export async function readSse(
  response: Response,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      if (!block || block.startsWith(':')) continue

      let event = 'message'
      let data = ''

      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          data += line.slice(5).trimStart()
        }
      }

      if (!data) continue

      try {
        onEvent({ event, data: JSON.parse(data) })
      } catch {
        // 忽略不完整的 JSON 分片
      }
    }
  }
}
