import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { config } from '../config.ts'
import { db } from '../lib/db.ts'
import { client } from '../lib/openai.ts'
import { withSystemPrompt } from '../lib/prompt.ts'
import { createSseStream } from '../lib/sse.ts'
import { resolveUpstreamHeaders } from '../upstream.ts'

export const conversationsRouter = Router()

// Phase 5 加登录后，这里会换成当前登录用户
const DEMO_USER_ID = 'demo'

const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
})

const RenameConversationSchema = z.object({
  title: z.string().trim().min(1).max(100),
})

const SendMessageSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
})

interface StoredMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function getConversation(id: string) {
  return db
    .prepare('select id from conversations where id = ? and user_id = ?')
    .get(id, DEMO_USER_ID)
}

function getChatMessages(conversationId: string): ChatCompletionMessageParam[] {
  const rows = db
    .prepare(
      `select role, content
       from messages
       where conversation_id = ? and status = 'done'
       order by created_at asc, rowid asc`,
    )
    .all(conversationId) as unknown as StoredMessage[]

  return withSystemPrompt(
    rows.map((message) => {
      if (message.role === 'system') {
        return { role: 'system', content: message.content }
      }
      if (message.role === 'assistant') {
        return { role: 'assistant', content: message.content }
      }
      return { role: 'user', content: message.content }
    }),
  )
}

function insertMessage(params: {
  conversationId: string
  role: 'system' | 'user' | 'assistant'
  content: string
  status: 'streaming' | 'done' | 'error' | 'stopped'
}) {
  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    `insert into messages (id, conversation_id, role, content, status, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(id, params.conversationId, params.role, params.content, params.status, now)

  return id
}

async function streamAssistantReply(
  res: Response,
  params: {
    conversationId: string
    assistantMessageId: string
    userMessageId: string | null
    chatMessages: ChatCompletionMessageParam[]
  },
) {
  const sse = createSseStream(res)
  const controller = new AbortController()
  let content = ''
  let usage: unknown = null
  let finalized = false

  const finish = (status: 'done' | 'error' | 'stopped', errorMessage: string | null = null) => {
    if (finalized) return
    finalized = true

    db.prepare(
      `update messages
       set content = ?, status = ?, error = ?
       where id = ?`,
    ).run(content, status, errorMessage, params.assistantMessageId)

    db.prepare('update conversations set updated_at = ? where id = ?').run(
      Date.now(),
      params.conversationId,
    )

    sse.close()
  }

  // 客户端主动断开时，response 会触发 close；正常结束时 finalized 已为 true
  res.on('close', () => {
    if (finalized || res.writableEnded) return
    controller.abort()
    finish('stopped')
  })

  sse.send('meta', {
    conversationId: params.conversationId,
    userMessageId: params.userMessageId,
    assistantMessageId: params.assistantMessageId,
  })

  try {
    const stream = await client.chat.completions.create(
      {
        model: config.openai.model,
        messages: params.chatMessages,
        stream: true,
      },
      {
        headers: resolveUpstreamHeaders({
          baseURL: config.openai.baseURL,
          sessionId: params.conversationId,
        }),
        signal: controller.signal,
      },
    )

    for await (const chunk of stream) {
      if (finalized) break

      if (chunk.usage) usage = chunk.usage

      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        content += delta
        sse.send('delta', { content: delta })
      }
    }

    if (finalized) return

    sse.send('done', { usage })
    finish('done')
  } catch (error: unknown) {
    if (controller.signal.aborted) return

    const message = error instanceof Error ? error.message : 'Upstream request failed'
    sse.send('error', { code: 'UPSTREAM_ERROR', message })
    finish('error', message)
  }
}

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
  const conversation = getConversation(req.params.id)

  if (!conversation) {
    res.status(404).json({ code: 404, message: 'Conversation not found', data: null })
    return
  }

  const messages = db
    .prepare(
      `select id, role, content, status, error, citations, created_at
       from messages
       where conversation_id = ?
       order by created_at asc, rowid asc`,
    )
    .all(req.params.id)

  res.json({ code: 0, message: 'ok', data: messages })
})

// POST /api/conversations/:id/messages
conversationsRouter.post('/:id/messages', (req, res) => {
  if (!getConversation(req.params.id)) {
    res.status(404).json({ code: 404, message: 'Conversation not found', data: null })
    return
  }

  const parsed = SendMessageSchema.safeParse(req.body)

  if (!parsed.success) {
    res.status(400).json({
      code: 400,
      message: 'Invalid request',
      data: parsed.error.issues,
    })
    return
  }

  try {
    const userMessageId = insertMessage({
      conversationId: req.params.id,
      role: 'user',
      content: parsed.data.content,
      status: 'done',
    })

    const chatMessages = getChatMessages(req.params.id)

    const assistantMessageId = insertMessage({
      conversationId: req.params.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    db.prepare('update conversations set updated_at = ? where id = ?').run(
      Date.now(),
      req.params.id,
    )

    void streamAssistantReply(res, {
      conversationId: req.params.id,
      assistantMessageId,
      userMessageId,
      chatMessages,
    }).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Unexpected streaming error:', error)
      if (!res.writableEnded) res.end()
    })
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error('Failed to create message:', error)
    res.status(500).json({ code: 500, message: 'Failed to create message', data: null })
  }
})

// POST /api/conversations/:id/regenerate
conversationsRouter.post('/:id/regenerate', (req, res) => {
  if (!getConversation(req.params.id)) {
    res.status(404).json({ code: 404, message: 'Conversation not found', data: null })
    return
  }

  const lastMessage = db
    .prepare(
      `select id, role
       from messages
       where conversation_id = ?
       order by created_at desc, rowid desc
       limit 1`,
    )
    .get(req.params.id) as { id: string; role: string } | undefined

  if (!lastMessage || lastMessage.role !== 'assistant') {
    res.status(400).json({
      code: 400,
      message: 'Last message is not an assistant message',
      data: null,
    })
    return
  }

  try {
    db.prepare(
      `update messages
       set content = '', status = 'streaming', error = null, citations = null
       where id = ?`,
    ).run(lastMessage.id)

    const chatMessages = getChatMessages(req.params.id)

    db.prepare('update conversations set updated_at = ? where id = ?').run(
      Date.now(),
      req.params.id,
    )

    void streamAssistantReply(res, {
      conversationId: req.params.id,
      assistantMessageId: lastMessage.id,
      userMessageId: null,
      chatMessages,
    }).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Unexpected streaming error:', error)
      if (!res.writableEnded) res.end()
    })
  } catch (error: unknown) {
    // eslint-disable-next-line no-console
    console.error('Failed to regenerate message:', error)
    res.status(500).json({ code: 500, message: 'Failed to regenerate message', data: null })
  }
})
