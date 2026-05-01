<template>
  <div class="fixed bottom-0 left-0 w-full backdrop-blur-md bg-white/70 dark:bg-gray-900/70 border-t border-gray-200 dark:border-gray-800 p-4">
    <div class="max-w-3xl mx-auto relative flex items-end gap-2">
      <textarea
        ref="textareaRef"
        v-model="input"
        rows="1"
        placeholder="Type your message..."
        class="w-full resize-none rounded-xl border-gray-300 bg-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm py-3 px-4 max-h-32 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
        @input="autoResize"
        @keydown.enter.prevent="submit"
        :disabled="disabled"
      />
      <button
        @click="submit"
        :disabled="!input.trim() || disabled"
        class="mb-1 rounded-full bg-blue-600 p-2 text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
          <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.404z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', text: string): void
}>()

const input = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const autoResize = () => {
  if (!textareaRef.value) return
  textareaRef.value.style.height = 'auto'
  textareaRef.value.style.height = `${textareaRef.value.scrollHeight}px`
}

const submit = () => {
  const text = input.value.trim()
  if (!text || props.disabled) return
  
  emit('submit', text)
  input.value = ''
  
  // Reset height
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }
}
</script>
