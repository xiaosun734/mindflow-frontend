import express from 'express'
import OpenAI from 'openai'
import dotenv from 'dotenv'
dotenv.config({ path: new URL('../.env', import.meta.url) })
import type { ChatRequest, EmbedRequest } from '../src/types/api'

const app = express()
app.use(express.json())

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

const embedClient = new OpenAI({
  apiKey: process.env.EMBED_API_KEY,
  baseURL: process.env.EMBED_BASE_URL,
})

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body as ChatRequest

  if (!messages || messages.length === 0 || !Array.isArray(messages)) {
    res.status(400).json({ code: 400, message: 'messages is required', data: null })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL,
      messages,
      stream: true,
    })

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

app.post('/api/embed', async (req, res) => {
  const { input } = req.body as EmbedRequest

  if (!input || (Array.isArray(input) && input.length === 0)) {
    res.status(400).json({ code: 400, message: 'input is required', data: null })
    return
  }

  try {
    const response = await embedClient.embeddings.create({
      model: process.env.EMBED_MODEL,
      input,
    })

    const embedding = response.data[0].embedding
    const tokens = response.usage.total_tokens

    res.json({ code: 0, message: 'ok', data: { embedding, tokens } })
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Internal Server Error'
    // eslint-disable-next-line no-console
    console.error('Embedding API error:', error)
    res.status(500).json({ code: 500, message: errMsg, data: null })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${PORT}`)
})
