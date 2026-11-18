<script setup lang="ts">
import { RouterLink } from 'vue-router'
import ConversationList from '../chat/ConversationList.vue'

defineProps<{
  open: boolean
}>()
</script>

<template>
  <aside :class="['app-sidebar', { open }]">
    <div class="brand">
      <span class="brand-mark">M</span>
      <span>MindFlow</span>
    </div>

    <nav class="app-nav">
      <RouterLink to="/chat">💬 聊天</RouterLink>
      <RouterLink to="/knowledge">📚 知识库</RouterLink>
      <RouterLink to="/interview">🎯 模拟面试</RouterLink>
      <RouterLink to="/login">👤 登录</RouterLink>
    </nav>

    <ConversationList />

    <div class="sidebar-footer">Phase 1 · 本地 Demo</div>
  </aside>
</template>
