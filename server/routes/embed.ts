import { Router } from 'express'
import type { EmbedRequest } from '../../src/types/api'
import { config } from '../config.ts'
import { embedClient } from '../lib/openai.ts'

export const embedRouter = Router()

embedRouter.post('/', async (req, res) => {
  const { input } = req.body as EmbedRequest

  if (!input || (Array.isArray(input) && input.length === 0)) {
    res.status(400).json({ code: 400, message: 'input is required', data: null })
    return
  }

  try {
    const response = await embedClient.embeddings.create({
      model: config.embed.model,
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
