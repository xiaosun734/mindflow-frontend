<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  disabled?: boolean
  streaming?: boolean
}>()

const emit = defineEmits<{
  send: [content: string]
  stop: []
}>()

const input = ref('')

function submit() {
  const content = input.value.trim()
  if (!content || props.disabled || props.streaming) return

  emit('send', content)
  input.value = ''
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <textarea
      v-model="input"
      class="composer-input"
      rows="2"
      placeholder="输入消息，Enter 发送，Shift+Enter 换行"
      :disabled="disabled"
      @keydown="onKeydown"
    ></textarea>

    <button v-if="streaming" type="button" class="composer-stop" @click="emit('stop')">
      停止
    </button>
    <button v-else type="submit" class="composer-send" :disabled="disabled || !input.trim()">
      发送
    </button>
  </form>
</template>
