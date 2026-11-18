export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  /** 会话 ID，后端会作为 x-opencode-session 请求头转发给上游 */
  sessionId?: string
}

export type MessageRole = 'system' | 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped'

export interface Conversation {
  id: string
  title: string
  summary: string | null
  created_at: number
  updated_at: number
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  status: MessageStatus
  error: string | null
  citations: string | null
  created_at: number
}

export interface EmbedRequest {
  input: string | string[]
}

export interface EmbedResponse {
  embedding: number[]
  tokens: number
}
