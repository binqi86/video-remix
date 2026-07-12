import { defineStore } from 'pinia'
import { ref } from 'vue'
import { generateApi } from '../api'

export const useGenerationStore = defineStore('generation', () => {
  const isRunning = ref(false)
  const progress = ref<Record<number, { imageState: string; videoState: string }>>({})
  const outputUrl = ref<string | null>(null)

  async function startGeneration(projectId: number) {
    isRunning.value = true
    outputUrl.value = null
    const res = await generateApi.start(projectId)
    return res.data
  }

  function updateSegmentProgress(segmentId: number, type: 'image' | 'video', state: string) {
    if (!progress.value[segmentId]) {
      progress.value[segmentId] = { imageState: 'pending', videoState: 'pending' }
    }
    if (type === 'image') {
      progress.value[segmentId].imageState = state
    } else {
      progress.value[segmentId].videoState = state
    }
  }

  function setOutput(url: string) {
    outputUrl.value = url
    isRunning.value = false
  }

  function reset() {
    isRunning.value = false
    progress.value = {}
    outputUrl.value = null
  }

  return { isRunning, progress, outputUrl, startGeneration, updateSegmentProgress, setOutput, reset }
})
