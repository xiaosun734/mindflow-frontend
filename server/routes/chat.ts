import { Router } from 'express'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { ChatRequest } from '../../src/types/api'
import { config } from '../config.ts'
import { client } from '../lib/openai.ts'
import { withSystemPrompt } from '../lib/prompt.ts'
import { upstreamHeadersMiddleware } from '../upstream.ts'

export const chatRouter = Router()

chatRouter.use(upstreamHeadersMiddleware(() => config.openai.baseURL))

chatRouter.post('/', async (req, res) => {
  const { messages } = req.body as ChatRequest

  if (!messages || messages.length === 0 || !Array.isArray(messages)) {
    res.status(400).json({ code: 400, message: 'messages is required', data: null })
    return
  }

  const { upstreamHeaders } = res.locals as { upstreamHeaders: Record<string, string> }

  const chatMessages = messages.map((message): ChatCompletionMessageParam => {
    if (message.role === 'assistant') {
      return { role: 'assistant', content: message.content }
    }
    return { role: 'user', content: message.content }
  })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    const stream = await client.chat.completions.create(
      {
        model: config.openai.model,
        messages: withSystemPrompt(chatMessages),
        stream: true,
      },
      { headers: upstreamHeaders },
    )

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`)
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Internal Server Error'
    // eslint-disable-next-line no-console
    console.error('OpenAI API error:', error)
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`)
    res.end()
  }
})
