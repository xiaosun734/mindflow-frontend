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
}
