<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdown } from '../../lib/markdown'
import type { Message } from '../../types/api'

const props = defineProps<{
  message: Message
}>()

const rendered = ref('')
let renderTimer: number | null = null
let pendingContent = ''

function renderNow() {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer)
    renderTimer = null
  }
  rendered.value = renderMarkdown(props.message.content)
}

function scheduleRender(content: string) {
  pendingContent = content
  if (renderTimer !== null) return

  renderTimer = window.setTimeout(() => {
    renderTimer = null
    rendered.value = renderMarkdown(pendingContent)
  }, 50)
}

watch(
  () => props.message.content,
  (content) => {
    if (props.message.status === 'streaming') {
      scheduleRender(content)
    } else {
      rendered.value = renderMarkdown(content)
    }
  },
  { immediate: true },
)

watch(
  () => props.message.status,
  (status) => {
    if (status !== 'streaming') {
      renderNow()
    }
  },
)

onBeforeUnmount(() => {
  if (renderTimer !== null) {
    window.clearTimeout(renderTimer)
  }
})

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

async function onContentClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  const button = target?.closest<HTMLButtonElement>('.code-copy')
  if (!button) return

  const code = button.closest('.code-block')?.querySelector('code')?.textContent ?? ''

  try {
    await copyText(code)
    button.textContent = '已复制'
  } catch {
    button.textContent = '复制失败'
  }

  window.setTimeout(() => {
    button.textContent = '复制'
  }, 1500)
}
</script>

<template>
  <article :class="['message-item', message.role]">
    <div class="message-avatar">{{ message.role === 'user' ? '🧑' : '🤖' }}</div>

    <div class="message-body">
      <div class="message-meta">
        <span>{{ message.role === 'user' ? '你' : 'MindFlow' }}</span>
        <span v-if="message.status === 'streaming'" class="message-status">正在生成…</span>
        <span v-else-if="message.status === 'stopped'" class="message-status">已停止</span>
        <span v-else-if="message.status === 'error'" class="message-status error">生成失败</span>
      </div>

      <div
        v-if="message.content"
        class="message-content markdown-body"
        v-html="rendered"
        @click="onContentClick"
      ></div>
      <div v-else class="message-content markdown-body">
        <span v-if="message.status === 'streaming'">思考中…</span>
      </div>

      <div v-if="message.error" class="message-error">{{ message.error }}</div>
    </div>
  </article>
</template>
