import express from 'express'
import { db } from './lib/db.ts'
import { chatRouter } from './routes/chat.ts'
import { conversationsRouter } from './routes/conversations.ts'
import { documentsRouter } from './routes/documents.ts'
import { embedRouter } from './routes/embed.ts'

export const app = express()

app.use(express.json())

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('select 1 as ok').get()
    res.json({ ok: true, db: 'ok' })
  } catch {
    res.status(500).json({ ok: false, db: 'error' })
  }
})

app.use('/api/chat', chatRouter)
app.use('/api/embed', embedRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/documents', documentsRouter)
