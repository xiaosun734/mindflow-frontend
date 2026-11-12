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

export interface EmbedRequest {
  input: string | string[]
}

export interface EmbedResponse {
  embedding: number[]
  tokens: number
}
