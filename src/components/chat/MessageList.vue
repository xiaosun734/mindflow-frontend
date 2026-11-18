<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { Message } from '../../types/api'
import MessageItem from './MessageItem.vue'

const props = defineProps<{
  messages: Message[]
  loading: boolean
  streaming: boolean
}>()

const listEl = ref<HTMLElement>()

function scrollToBottom() {
  if (!listEl.value) return
  listEl.value.scrollTop = listEl.value.scrollHeight
}

watch(
  () =>
    `${props.messages.length}:${props.messages[props.messages.length - 1]?.content ?? ''}:${props.streaming}`,
  async () => {
    await nextTick()
    scrollToBottom()
  },
)

onMounted(() => {
  void nextTick().then(scrollToBottom)
})
</script>

<template>
  <div ref="listEl" class="message-list">
    <div v-if="loading" class="list-state">加载消息中…</div>

    <div v-else-if="messages.length === 0" class="list-state">
      <h2>开始一段新对话</h2>
      <p>输入问题，MindFlow 会保存上下文并流式回答。</p>
    </div>

    <MessageItem v-for="message in messages" :key="message.id" :message="message" />
  </div>
</template>
