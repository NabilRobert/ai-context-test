<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{
  messages: ChatCompletionMessageParam[]
  isLoading?: boolean
}>()

const containerRef = ref<HTMLElement | null>(null)

const scrollToBottom = async () => {
  await nextTick()
  if (containerRef.value) {
    containerRef.value.scrollTo({
      top: containerRef.value.scrollHeight,
      behavior: 'smooth'
    })
  }
}

watch(() => props.messages, scrollToBottom, { deep: true })
watch(() => props.isLoading, scrollToBottom)
</script>
<template>
  <div class="flex-1 overflow-y-auto p-4 w-full" ref="containerRef">
    <div class="max-w-3xl mx-auto pb-32">
      <template v-if="messages.length === 0">
        <div class="h-full flex flex-col items-center justify-center text-gray-500 mt-20">
          <div class="text-4xl mb-4">🚗</div>
          <h2 class="text-xl font-semibold mb-2">Used Car Lot AI</h2>
          <p>Powered by Sumopod. Ask me anything about our inventory!</p>
        </div>
      </template>
      <template v-else>
        <MessageBubble
          v-for="(msg, index) in messages"
          :key="index"
          :message="msg"
        />
        <div v-if="isLoading" class="flex justify-start mb-4">
          <div class="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-2 flex gap-1">
            <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
            <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
            <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
