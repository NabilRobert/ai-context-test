<template>
  <div :class="['flex w-full mb-4', isUser ? 'justify-end' : 'justify-start']">
    <div
      :class="[
        'max-w-[80%] rounded-2xl px-4 py-2',
        isUser
          ? 'bg-blue-600 text-white rounded-br-sm'
          : 'bg-gray-100 text-gray-800 rounded-bl-sm dark:bg-gray-800 dark:text-gray-100'
      ]"
    >
      <!-- If it's a tool call -->
      <div v-if="message.role === 'tool'" class="text-xs italic text-gray-500 font-mono overflow-x-auto">
        <span class="font-bold">System Tool Output</span>
        <pre class="mt-1">{{ message.content }}</pre>
      </div>

      <!-- Normal Content -->
      <div v-else class="whitespace-pre-wrap leading-relaxed text-sm">
        {{ message.content }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

const props = defineProps<{
  message: ChatCompletionMessageParam
}>()

const isUser = computed(() => props.message.role === 'user')
</script>
