<template>
  <div class="h-screen w-full flex flex-col bg-white dark:bg-gray-950 font-sans text-gray-900 dark:text-gray-100">
    <!-- Header -->
    <header class="border-b border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-md sticky top-0 z-10 flex justify-between items-center px-6 py-3">
      <div class="flex items-center gap-2">
        <span class="text-xl">🚗</span>
        <h1 class="font-bold text-lg">Used Car Lot AI</h1>
      </div>
      <div v-if="tokenStats.used > 0" class="text-xs font-mono text-gray-500 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
        Tokens: {{ tokenStats.used }} | RTK Saved: {{ tokenStats.saved }}
      </div>
    </header>

    <!-- Chat Area -->
    <ChatContainer :messages="visibleMessages" :isLoading="isLoading" />

    <!-- Input Area -->
    <InputArea @submit="sendMessage" :disabled="isLoading" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import ChatContainer from './components/ChatContainer.vue'
import InputArea from './components/InputArea.vue'

const history = ref<ChatCompletionMessageParam[]>([])
const isLoading = ref(false)
const tokenStats = ref({ used: 0, saved: 0 })

// Filter out system prompt for the UI
const visibleMessages = computed(() => {
  return history.value.filter(msg => msg.role !== 'system')
})

const sendMessage = async (text: string) => {
  if (!text.trim() || isLoading.value) return

  // Optimistically add user message
  history.value.push({ role: 'user', content: text })
  isLoading.value = true

  try {
    const response = await $fetch('/api/chat', {
      method: 'POST',
      body: {
        history: history.value.slice(0, -1), // send history without the message we just pushed
        userInput: text
      }
    })

    // Update state from server response
    if (response) {
      history.value = response.history
      tokenStats.value = {
        used: response.tokensUsed,
        saved: response.tokensSaved
      }
    }
  } catch (error) {
    console.error('Failed to send message:', error)
    history.value.push({ role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' })
  } finally {
    isLoading.value = false
  }
}
</script>

<style>
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
}
#__nuxt {
  height: 100%;
}
</style>
