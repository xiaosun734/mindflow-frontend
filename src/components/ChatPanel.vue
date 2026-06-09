<script setup lang="ts">
import { ref, nextTick, type ComponentPublicInstance } from 'vue'
import type { ChatMessage } from '../types/api'

const messages = ref<ChatMessage[]>([])
const input = ref('')
const isLoading = ref(false)
const error = ref('')
const chatEl = ref<HTMLDivElement>()
const cmu = ref<HTMLElement>()

function setCmuRef(el: Element | ComponentPublicInstance | null) {
  cmu.value = el as HTMLElement
}

async function send() {
  const text = input.value.trim()
  if (!text || isLoading.value) return

  error.value = ''
  messages.value.push({ role: 'user', content: text })
  input.value = ''

  // 添加一条空的 assistant 消息，用于流式填充
  const aiMsg: ChatMessage = { role: 'assistant', content: '' }
  messages.value.push(aiMsg)

  await nextTick()
  scrollBottom()

  isLoading.value = true

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.value.filter(m => m !== aiMsg) }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }))
      throw new Error(err.message || `HTTP ${res.status}`)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new Error('不支持流式响应')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data)
          if (parsed.error) {
            throw new Error(parsed.error)
          }
          if (parsed.content) {
            aiMsg.content += parsed.content
            await nextTick()
            scrollBottom()
          }
        } catch (e: any) {
          if (e.message !== parsed?.error) throw e
          throw e
        }
      }
    }
  } catch (e: any) {
    error.value = e.message || '请求失败'
    // 移除空的 assistant 消息
    if (!aiMsg.content) {
      messages.value.pop()
    }
  } finally {
    isLoading.value = false
    await nextTick()
    scrollBottom()
  }
}

function scrollBottom() {
  if (!chatEl.value || !cmu.value) return
  const chatRect = chatEl.value.getBoundingClientRect()
  const cmuRect = cmu.value.getBoundingClientRect()
  // 用户消息在滚动容器内的绝对偏移：当前可见偏移 + 已滚动距离
  chatEl.value.scrollTop = cmuRect.top - chatRect.top + chatEl.value.scrollTop
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="chat-panel">
    <h2 class="chat-title">💬 API 测试面板</h2>

    <div ref="chatEl" class="chat-messages">
      <div v-if="messages.length === 0" class="chat-empty">
        输入消息，测试 /api/chat 接口
      </div>

      <div
        v-for="(m, i) in messages"
        :key="i"
        :class="['chat-msg', m.role]"
        :ref="m.role === 'user' ? setCmuRef : undefined"
      >
        <span class="msg-role">{{ m.role === 'user' ? '🧑' : '🤖' }}</span>
        <span class="msg-content">{{ m.content || (isLoading && m.role === 'assistant' ? '思考中…' : '') }}</span>
      </div>

      <div v-if="error" class="chat-error">{{ error }}</div>
    </div>

    <div class="chat-input-area">
      <textarea
        v-model="input"
        class="chat-input"
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        :disabled="isLoading"
        rows="2"
        @keydown="onKeydown"
      ></textarea>
      <button
        class="chat-send"
        :disabled="isLoading || !input.trim()"
        @click="send"
      >
        {{ isLoading ? '发送中…' : '发送' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  height: 80vh;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--bg);
}

.chat-title {
  font-size: 20px;
  padding: 16px 20px;
  margin: 0;
  border-bottom: 1px solid var(--border);
  text-align: left;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-empty {
  text-align: center;
  color: var(--text);
  opacity: 0.5;
  margin-top: 40px;
}

.chat-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.msg-role {
  flex-shrink: 0;
  font-size: 18px;
  line-height: 1.5;
}

.msg-content {
  background: var(--code-bg);
  padding: 8px 14px;
  border-radius: 10px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  text-align: left;
}

.chat-msg.user .msg-content {
  background: var(--accent-bg);
  color: var(--text-h);
}

.chat-msg.assistant .msg-content {
  background: var(--code-bg);
}

.chat-error {
  color: #ef4444;
  font-size: 14px;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 8px;
  text-align: left;
}

.chat-input-area {
  display: flex;
  gap: 10px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font: inherit;
  font-size: 15px;
  background: var(--bg);
  color: var(--text-h);
  outline: none;
}

.chat-input:focus {
  border-color: var(--accent-border);
}

.chat-send {
  flex-shrink: 0;
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  white-space: nowrap;
}

.chat-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
