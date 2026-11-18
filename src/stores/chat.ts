import { defineStore } from 'pinia'
import { api, streamChat } from '../lib/api'
import type { Conversation, Message } from '../types/api'

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  messages: Message[]
  loadingConversations: boolean
  loadingMessages: boolean
  streaming: boolean
  error: string
  abortController: AbortController | null
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    conversations: [],
    activeId: null,
    messages: [],
    loadingConversations: false,
    loadingMessages: false,
    streaming: false,
    error: '',
    abortController: null,
  }),

  getters: {
    activeConversation(state): Conversation | null {
      return state.conversations.find((item) => item.id === state.activeId) ?? null
    },

    canRegenerate(state): boolean {
      if (state.streaming || state.messages.length === 0) return false
      return state.messages[state.messages.length - 1]?.role === 'assistant'
    },
  },

  actions: {
    async loadConversations() {
      this.loadingConversations = true
      try {
        this.conversations = await api.get<Conversation[]>('/conversations')
      } catch (error) {
        this.error = error instanceof Error ? error.message : '加载会话失败'
      } finally {
        this.loadingConversations = false
      }
    },

    async createConversation(title = '新对话'): Promise<Conversation> {
      const conversation = await api.post<Conversation>('/conversations', { title })
      this.conversations.unshift(conversation)
      return conversation
    },

    async selectConversation(id: string) {
      this.activeId = id
      this.error = ''
      this.loadingMessages = true
      try {
        this.messages = await api.get<Message[]>(`/conversations/${id}/messages`)
      } catch (error) {
        this.error = error instanceof Error ? error.message : '加载消息失败'
        this.messages = []
      } finally {
        this.loadingMessages = false
      }
    },

    clearActive() {
      this.activeId = null
      this.messages = []
      this.error = ''
    },

    async renameConversation(id: string, title: string) {
      const updated = await api.patch<Conversation>(`/conversations/${id}`, { title })
      const index = this.conversations.findIndex((item) => item.id === id)
      if (index !== -1) {
        this.conversations[index] = updated
      }
    },

    async deleteConversation(id: string) {
      await api.delete<{ id: string }>(`/conversations/${id}`)
      this.conversations = this.conversations.filter((item) => item.id !== id)
      if (this.activeId === id) {
        this.clearActive()
      }
    },

    async sendMessage(content: string) {
      if (this.streaming) return
      this.error = ''

      let conversationId = this.activeId
      if (!conversationId) {
        try {
          const conversation = await this.createConversation()
          conversationId = conversation.id
          this.activeId = conversation.id
        } catch (error) {
          this.error = error instanceof Error ? error.message : '创建会话失败'
          return
        }
      }

      const controller = new AbortController()
      this.abortController = controller
      this.streaming = true
      let assistantId: string | null = null

      try {
        await streamChat(
          `/conversations/${conversationId}/messages`,
          { content },
          (event) => {
            if (event.event === 'meta') {
              const data = event.data as {
                userMessageId: string
                assistantMessageId: string
              }
              assistantId = data.assistantMessageId

              this.messages.push({
                id: data.userMessageId,
                role: 'user',
                content,
                status: 'done',
                error: null,
                citations: null,
                created_at: Date.now(),
              })
              this.messages.push({
                id: data.assistantMessageId,
                role: 'assistant',
                content: '',
                status: 'streaming',
                error: null,
                citations: null,
                created_at: Date.now(),
              })
              return
            }

            if (event.event === 'delta') {
              const data = event.data as { content: string }
              const message = assistantId
                ? this.messages.find((item) => item.id === assistantId)
                : undefined
              if (message) {
                message.content += data.content
              }
              return
            }

            if (event.event === 'done') {
              const message = assistantId
                ? this.messages.find((item) => item.id === assistantId)
                : undefined
              if (message) {
                message.status = 'done'
              }
              return
            }

            if (event.event === 'error') {
              const data = event.data as { message?: string }
              const message = assistantId
                ? this.messages.find((item) => item.id === assistantId)
                : undefined
              if (message) {
                message.status = 'error'
                message.error = data.message ?? '生成失败'
              }
              this.error = data.message ?? '生成失败'
            }
          },
          controller.signal,
        )
      } catch (error) {
        if (!controller.signal.aborted) {
          this.error = error instanceof Error ? error.message : '发送失败'
          const message = assistantId
            ? this.messages.find((item) => item.id === assistantId)
            : undefined
          if (message && message.status === 'streaming') {
            message.status = 'error'
            message.error = this.error
          }
        }
      } finally {
        this.streaming = false
        this.abortController = null

        if (controller.signal.aborted) {
          // 等服务端把已生成内容落库，再刷新准确状态
          await new Promise((resolve) => setTimeout(resolve, 150))
          if (this.activeId === conversationId) {
            this.messages = await api.get<Message[]>(`/conversations/${conversationId}/messages`)
          }
        } else if (assistantId) {
          const message = this.messages.find((item) => item.id === assistantId)
          if (message?.status === 'streaming' && this.activeId === conversationId) {
            // 连接意外断开，服务端可能已标记为 error/stopped
            this.messages = await api.get<Message[]>(`/conversations/${conversationId}/messages`)
          }
        }

        await this.loadConversations()
      }
    },

    stopStreaming() {
      this.abortController?.abort()
    },

    async regenerate() {
      if (!this.activeId || this.streaming) return

      const conversationId = this.activeId
      const controller = new AbortController()
      this.abortController = controller
      this.streaming = true
      this.error = ''
      let assistantId: string | null = null

      try {
        await streamChat(
          `/conversations/${conversationId}/regenerate`,
          {},
          (event) => {
            if (event.event === 'meta') {
              const data = event.data as { assistantMessageId: string }
              assistantId = data.assistantMessageId
              const message = this.messages.find((item) => item.id === assistantId)
              if (message) {
                message.content = ''
                message.status = 'streaming'
                message.error = null
              }
              return
            }

            if (event.event === 'delta') {
              const data = event.data as { content: string }
              const message = assistantId
                ? this.messages.find((item) => item.id === assistantId)
                : undefined
              if (message) {
                message.content += data.content
              }
              return
            }

            if (event.event === 'done') {
              const message = assistantId
                ? this.messages.find((item) => item.id === assistantId)
                : undefined
              if (message) {
                message.status = 'done'
              }
              return
            }

            if (event.event === 'error') {
              const data = event.data as { message?: string }
              const message = assistantId
                ? this.messages.find((item) => item.id === assistantId)
                : undefined
              if (message) {
                message.status = 'error'
                message.error = data.message ?? '生成失败'
              }
              this.error = data.message ?? '生成失败'
            }
          },
          controller.signal,
        )
      } catch (error) {
        if (!controller.signal.aborted) {
          this.error = error instanceof Error ? error.message : '重新生成失败'
          const message = assistantId
            ? this.messages.find((item) => item.id === assistantId)
            : undefined
          if (message && message.status === 'streaming') {
            message.status = 'error'
            message.error = this.error
          }
        }
      } finally {
        this.streaming = false
        this.abortController = null

        if (controller.signal.aborted && this.activeId === conversationId) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          this.messages = await api.get<Message[]>(`/conversations/${conversationId}/messages`)
        }

        await this.loadConversations()
      }
    },
  },
})
