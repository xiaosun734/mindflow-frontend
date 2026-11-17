import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { db } from '../lib/db.ts'

export const conversationsRouter = Router()

// Phase 5 加登录后，这里会换成当前登录用户
const DEMO_USER_ID = 'demo'

const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
})

const RenameConversationSchema = z.object({
  title: z.string().trim().min(1).max(100),
})

// GET /api/conversations
conversationsRouter.get('/', (_req, res) => {
  const conversations = db
    .prepare(
      `select id, title, summary, created_at, updated_at
       from conversations
       where user_id = ?
       order by updated_at desc`,
    )
    .all(DEMO_USER_ID)

  res.json({ code: 0, message: 'ok', data: conversations })
})

// POST /api/conversations
conversationsRouter.post('/', (req, res) => {
  const parsed = CreateConversationSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      code: 400,
      message: 'Invalid request',
      data: parsed.error.issues,
    })
    return
  }

  const id = randomUUID()
  const now = Date.now()
  const title = parsed.data.title ?? '新对话'

  db.prepare(
    `insert into conversations (id, user_id, title, created_at, updated_at)
     values (?, ?, ?, ?, ?)`,
  ).run(id, DEMO_USER_ID, title, now, now)

  const conversation = db
    .prepare(
      `select id, title, summary, created_at, updated_at
       from conversations
       where id = ?`,
    )
    .get(id)

  res.status(201).json({ code: 0, message: 'ok', data: conversation })
})

// PATCH /api/conversations/:id
conversationsRouter.patch('/:id', (req, res) => {
  const parsed = RenameConversationSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      code: 400,
      message: 'Invalid request',
      data: parsed.error.issues,
    })
    return
  }

  const now = Date.now()
  const result = db
    .prepare(
      `update conversations
       set title = ?, updated_at = ?
       where id = ? and user_id = ?`,
    )
    .run(parsed.data.title, now, req.params.id, DEMO_USER_ID)

  if (Number(result.changes) === 0) {
    res.status(404).json({ code: 404, message: 'Conversation not found', data: null })
    return
  }

  const conversation = db
    .prepare(
      `select id, title, summary, created_at, updated_at
       from conversations
       where id = ?`,
    )
    .get(req.params.id)

  res.json({ code: 0, message: 'ok', data: conversation })
})

// DELETE /api/conversations/:id
conversationsRouter.delete('/:id', (req, res) => {
  const result = db
    .prepare('delete from conversations where id = ? and user_id = ?')
    .run(req.params.id, DEMO_USER_ID)

  if (Number(result.changes) === 0) {
    res.status(404).json({ code: 404, message: 'Conversation not found', data: null })
    return
  }

  res.json({ code: 0, message: 'ok', data: { id: req.params.id } })
})

// GET /api/conversations/:id/messages
conversationsRouter.get('/:id/messages', (req, res) => {
  const conversation = db
    .prepare('select id from conversations where id = ? and user_id = ?')
    .get(req.params.id, DEMO_USER_ID)

  if (!conversation) {
    res.status(404).json({ code: 404, message: 'Conversation not found', data: null })
    return
  }

  const messages = db
    .prepare(
      `select id, role, content, status, error, citations, created_at
       from messages
       where conversation_id = ?
       order by created_at asc`,
    )
    .all(req.params.id)

  res.json({ code: 0, message: 'ok', data: messages })
})
