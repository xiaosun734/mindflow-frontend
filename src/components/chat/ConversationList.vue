<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '../../stores/chat'
import type { Conversation } from '../../types/api'

const chat = useChatStore()
const route = useRoute()
const router = useRouter()

onMounted(() => {
  if (chat.conversations.length === 0) {
    void chat.loadConversations()
  }
})

function newConversation() {
  chat.clearActive()
  void router.push('/chat')
}

function openConversation(id: string) {
  void router.push(`/chat/${id}`)
}

async function renameConversation(conversation: Conversation) {
  const title = prompt('重命名会话', conversation.title)?.trim()
  if (!title || title === conversation.title) return

  try {
    await chat.renameConversation(conversation.id, title)
  } catch (error) {
    chat.error = error instanceof Error ? error.message : '重命名失败'
  }
}

async function removeConversation(id: string, event: MouseEvent) {
  event.stopPropagation()
  if (!confirm('确定删除这个会话吗？')) return

  const wasActive = route.params.id === id

  try {
    await chat.deleteConversation(id)
    if (wasActive) {
      void router.push('/chat')
    }
  } catch (error) {
    chat.error = error instanceof Error ? error.message : '删除失败'
  }
}
</script>

<template>
  <div class="conversation-list">
    <div class="conversation-header">
      <span>对话</span>
      <button type="button" class="new-chat" title="新建对话" @click="newConversation">＋</button>
    </div>

    <div class="conversation-items">
      <div v-if="chat.loadingConversations" class="conversation-empty">加载中…</div>
      <div v-else-if="chat.conversations.length === 0" class="conversation-empty">
        还没有会话
      </div>

      <button
        v-for="conversation in chat.conversations"
        :key="conversation.id"
        type="button"
        :class="['conversation-item', { active: conversation.id === chat.activeId }]"
        :title="conversation.title"
        @click="openConversation(conversation.id)"
        @dblclick="renameConversation(conversation)"
      >
        <span class="conversation-title">{{ conversation.title }}</span>
        <span
          class="conversation-delete"
          title="删除会话"
          @click="removeConversation(conversation.id, $event)"
        >
          ×
        </span>
      </button>
    </div>
  </div>
</template>
