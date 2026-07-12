import { defineStore } from 'pinia'
import { ref } from 'vue'
import { modelApi, settingApi } from '../api'

export const useModelStore = defineStore('model', () => {
  const textModels = ref<any[]>([])
  const imageModels = ref<any[]>([])
  const videoModels = ref<any[]>([])
  const settings = ref<Record<string, string>>({})
  const loading = ref(false)

  async function fetchModels() {
    loading.value = true
    try {
      const [textRes, imageRes, videoRes] = await Promise.all([
        modelApi.list('text'),
        modelApi.list('image'),
        modelApi.list('video'),
      ])
      textModels.value = textRes.data.data || []
      imageModels.value = imageRes.data.data || []
      videoModels.value = videoRes.data.data || []
    } finally {
      loading.value = false
    }
  }

  async function fetchSettings() {
    const res = await settingApi.get()
    settings.value = res.data.data || {}
  }

  async function updateSetting(key: string, value: string) {
    await settingApi.update(key, value)
    settings.value[key] = value
  }

  return { textModels, imageModels, videoModels, settings, loading, fetchModels, fetchSettings, updateSetting }
})
