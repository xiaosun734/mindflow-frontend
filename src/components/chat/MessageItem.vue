<script setup lang="ts">
import type { Message } from '../../types/api'

defineProps<{
  message: Message
}>()
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

      <div class="message-content">
        {{ message.content || (message.status === 'streaming' ? '思考中…' : '') }}
      </div>

      <div v-if="message.error" class="message-error">{{ message.error }}</div>
    </div>
  </article>
</template>
