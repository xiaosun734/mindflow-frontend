import type { Response } from 'express'

export interface SseStream {
  send(event: string, data: unknown): void
  close(): void
}

export function createSseStream(res: Response): SseStream {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  res.flushHeaders()

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n')
    }
  }, 15_000)

  const cleanup = () => clearInterval(heartbeat)
  res.on('close', cleanup)

  return {
    send(event, data) {
      if (res.writableEnded) return
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    close() {
      cleanup()
      if (!res.writableEnded) {
        res.end()
      }
    },
  }
}
