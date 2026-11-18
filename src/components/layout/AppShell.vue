<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppSidebar from './AppSidebar.vue'

const route = useRoute()
const sidebarOpen = ref(false)

watch(
  () => route.fullPath,
  () => {
    sidebarOpen.value = false
  },
)
</script>

<template>
  <div class="app-shell">
    <button
      type="button"
      class="sidebar-toggle"
      aria-label="切换侧栏"
      @click="sidebarOpen = !sidebarOpen"
    >
      ☰
    </button>

    <AppSidebar :open="sidebarOpen" />

    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false"></div>

    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>
