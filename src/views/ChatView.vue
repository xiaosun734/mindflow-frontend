<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChatComposer from '../components/chat/ChatComposer.vue'
import MessageList from '../components/chat/MessageList.vue'
import { useChatStore } from '../stores/chat'

const route = useRoute()
const router = useRouter()
const chat = useChatStore()

function currentRouteId(): string | null {
  return typeof route.params.id === 'string' ? route.params.id : null
}

watch(
  () => route.params.id,
  () => {
    const id = currentRouteId()
    if (id) {
      if (chat.activeId !== id) {
        void chat.selectConversation(id)
      }
    } else {
      chat.clearActive()
    }
  },
  { immediate: true },
)

watch(
  () => chat.activeId,
  (id) => {
    const routeId = currentRouteId()
    if (id && id !== routeId) {
      void router.replace(`/chat/${id}`)
    } else if (!id && routeId) {
      void router.replace('/chat')
    }
  },
)

async function handleSend(content: string) {
  await chat.sendMessage(content)
}
</script>

<template>
  <section class="chat-view">
    <header class="chat-header">
      <div>
        <h1>{{ chat.activeConversation?.title ?? '新对话' }}</h1>
        <p>流式对话 · 自动保存</p>
      </div>
      <button
        v-if="chat.canRegenerate"
        class="ghost-button"
        :disabled="chat.streaming"
        @click="chat.regenerate()"
      >
        重新生成
      </button>
    </header>

    <MessageList
      :messages="chat.messages"
      :loading="chat.loadingMessages"
      :streaming="chat.streaming"
    />

    <div v-if="chat.error" class="chat-error">{{ chat.error }}</div>

    <ChatComposer
      :disabled="chat.loadingMessages"
      :streaming="chat.streaming"
      @send="handleSend"
      @stop="chat.stopStreaming()"
    />
  </section>
</template>
