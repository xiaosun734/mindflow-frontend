import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { z } from 'zod'
import { config } from '../config.ts'
import { db } from '../lib/db.ts'
import { client } from '../lib/openai.ts'
import { withSystemPrompt } from '../lib/prompt.ts'
import { createSseStream } from '../lib/sse.ts'
import {
  buildRagContext,
  buildRagMessages,
  extractCitations,
  type Citation,
} from '../services/rag.ts'
import { retrieveChunks } from '../services/retrieval.ts'
import { resolveUpstreamHeaders } from '../upstream.ts'

export const conversationsRouter = Router()

// Phase 5 加登录后，这里会换成当前登录用户
const DEMO_USER_ID = 'demo'
const REFUSAL_MESSAGE = '根据现有资料无法回答。'

type ConversationMode = 'chat' | 'rag'

const ConversationModeSchema = z.enum(['chat', 'rag'])

const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  mode: ConversationModeSchema.optional(),
})

const RenameConversationSchema = z.object({
  title: z.string().trim().min(1).max(100),
})

const SendMessageSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  mode: ConversationModeSchema.optional(),
})

interface StoredMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ConversationRow {
  id: string
  mode: ConversationMode
}

function normalizeMode(value: string): ConversationMode {
  return value === 'rag' ? 'rag' : 'chat'
}

function getConversation(id: string): ConversationRow | undefined {
  return db
    .prepare('select id, mode from conversations where id = ? and user_id = ?')
    .get(id, DEMO_USER_ID) as unknown as ConversationRow | undefined
}

function getHistoryMessages(conversationId: string): ChatCompletionMessageParam[] {
  const rows = db
    .prepare(
      `select role, content
       from messages
       where conversation_id = ? and status = 'done'
       order by created_at asc, rowid asc`,
    )
    .all(conversationId) as unknown as StoredMessage[]

  return rows.map((message) => {
    if (message.role === 'system') {
      return { role: 'system', content: message.content }
    }
    if (message.role === 'assistant') {
      return { role: 'assistant', content: message.content }
    }
    return { role: 'user', content: message.content }
  })
}

function insertMessage(params: {
  conversationId: string
  role: 'system' | 'user' | 'assistant'
  content: string
  status: 'streaming' | 'done' | 'error' | 'stopped'
  error?: string | null
}): string {
  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    `insert into messages
       (id, conversation_id, role, content, status, error, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.conversationId,
    params.role,
    params.content,
    params.status,
    params.error ?? null,
    now,
  )

  return id
}

function touchConversation(conversationId: string) {
  db.prepare('update conversations set updated_at = ? where id = ?').run(
    Date.now(),
    conversationId,
  )
}

function sendRefusal(
  res: Response,
  params: {
    conversationId: string
    userMessageId: string | null
    assistantMessageId: string
    content: string
  },
) {
  const sse = createSseStream(res)

  sse.send('meta', {
    conversationId: params.conversationId,
    userMessageId: params.userMessageId,
    assistantMessageId: params.assistantMessageId,
    mode: 'rag',
  })
  sse.send('delta', { content: params.content })
  sse.send('done', { usage: null, citations: [] })
  sse.close()
}

async function streamAssistantReply(
  res: Response,
  params: {
    conversationId: string
    assistantMessageId: string
    userMessageId: string | null
    chatMessages: ChatCompletionMessageParam[]
    mode: ConversationMode
    citations?: Citation[]
  },
) {
  const sse = createSseStream(res)
  const controller = new AbortController()
  let content = ''
  let usage: unknown = null
  let finalized = false

  const finish = (
    status: 'done' | 'error' | 'stopped',
    errorMessage: string | null = null,
    usedCitations: Citation[] = params.citations
      ? extractCitations(content, params.citations)
      : [],
  ) => {
    if (finalized) return
    finalized = true

    db.prepare(
      `update messages
       set content = ?, status = ?, error = ?, citations = ?
       where id = ?`,
    ).run(
      content,
      status,
      errorMessage,
      usedCitations.length > 0 ? JSON.stringify(usedCitations) : null,
      params.assistantMessageId,
    )

    touchConversation(params.conversationId)
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
    mode: params.mode,
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

    const usedCitations = params.citations
      ? extractCitations(content, params.citations)
      : []

    sse.send('done', { usage, citations: usedCitations })
    finish('done', null, usedCitations)
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
      `select id, title, summary, mode, created_at, updated_at
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
  const mode = parsed.data.mode ?? 'chat'

  db.prepare(
    `insert into conversations (id, user_id, title, mode, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(id, DEMO_USER_ID, title, mode, now, now)

  const conversation = db
    .prepare(
      `select id, title, summary, mode, created_at, updated_at
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
      `select id, title, summary, mode, created_at, updated_at
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
conversationsRouter.post('/:id/messages', async (req, res) => {
  const conversation = getConversation(req.params.id)

  if (!conversation) {
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

  const mode = parsed.data.mode ?? normalizeMode(conversation.mode)

  if (parsed.data.mode && parsed.data.mode !== conversation.mode) {
    db.prepare('update conversations set mode = ? where id = ?').run(mode, conversation.id)
  }

  try {
    const userMessageId = insertMessage({
      conversationId: conversation.id,
      role: 'user',
      content: parsed.data.content,
      status: 'done',
    })

    const history = getHistoryMessages(conversation.id)
    let chatMessages: ChatCompletionMessageParam[]
    let citations: Citation[] = []

    if (mode === 'rag') {
      const retrieved = await retrieveChunks(DEMO_USER_ID, parsed.data.content, {
        topK: config.rag.topK,
        minSimilarity: config.rag.minSimilarity,
      })

      if (retrieved.length === 0) {
        const assistantMessageId = insertMessage({
          conversationId: conversation.id,
          role: 'assistant',
          content: REFUSAL_MESSAGE,
          status: 'done',
        })

        touchConversation(conversation.id)
        sendRefusal(res, {
          conversationId: conversation.id,
          userMessageId,
          assistantMessageId,
          content: REFUSAL_MESSAGE,
        })
        return
      }

      const rag = buildRagContext(retrieved)
      citations = rag.citations
      chatMessages = buildRagMessages(history, rag.context)
    } else {
      chatMessages = withSystemPrompt(history)
    }

    const assistantMessageId = insertMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
    })

    touchConversation(conversation.id)

    void streamAssistantReply(res, {
      conversationId: conversation.id,
      assistantMessageId,
      userMessageId,
      chatMessages,
      mode,
      citations,
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
conversationsRouter.post('/:id/regenerate', async (req, res) => {
  const conversation = getConversation(req.params.id)

  if (!conversation) {
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
    .get(conversation.id) as { id: string; role: string } | undefined

  if (!lastMessage || lastMessage.role !== 'assistant') {
    res.status(400).json({
      code: 400,
      message: 'Last message is not an assistant message',
      data: null,
    })
    return
  }

  const lastUserMessage = db
    .prepare(
      `select content
       from messages
       where conversation_id = ? and role = 'user'
       order by created_at desc, rowid desc
       limit 1`,
    )
    .get(conversation.id) as { content: string } | undefined

  if (!lastUserMessage) {
    res.status(400).json({
      code: 400,
      message: 'No user message to regenerate from',
      data: null,
    })
    return
  }

  const mode = normalizeMode(conversation.mode)

  try {
    db.prepare(
      `update messages
       set content = '', status = 'streaming', error = null, citations = null
       where id = ?`,
    ).run(lastMessage.id)

    const history = getHistoryMessages(conversation.id)
    let chatMessages: ChatCompletionMessageParam[]
    let citations: Citation[] = []

    if (mode === 'rag') {
      const retrieved = await retrieveChunks(DEMO_USER_ID, lastUserMessage.content, {
        topK: config.rag.topK,
        minSimilarity: config.rag.minSimilarity,
      })

      if (retrieved.length === 0) {
        db.prepare(
          `update messages
           set content = ?, status = 'done', error = null, citations = null
           where id = ?`,
        ).run(REFUSAL_MESSAGE, lastMessage.id)

        touchConversation(conversation.id)
        sendRefusal(res, {
          conversationId: conversation.id,
          userMessageId: null,
          assistantMessageId: lastMessage.id,
          content: REFUSAL_MESSAGE,
        })
        return
      }

      const rag = buildRagContext(retrieved)
      citations = rag.citations
      chatMessages = buildRagMessages(history, rag.context)
    } else {
      chatMessages = withSystemPrompt(history)
    }

    touchConversation(conversation.id)

    void streamAssistantReply(res, {
      conversationId: conversation.id,
      assistantMessageId: lastMessage.id,
      userMessageId: null,
      chatMessages,
      mode,
      citations,
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
