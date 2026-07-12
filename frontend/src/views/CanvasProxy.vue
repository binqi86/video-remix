<template>
  <div class="canvas-proxy" v-if="iframeUrl">
    <div class="proxy-toolbar">
      <t-button variant="text" size="small" @click="goBack">
        <t-icon name="arrow-left" /> 返回
      </t-button>
      <span class="proxy-title">{{ pageTitle }}</span>
      <a :href="iframeUrl" target="_blank" class="external-link">
        <t-button variant="text" size="small">
          <t-icon name="external-link" /> 新窗口
        </t-button>
      </a>
    </div>
    <div v-if="!iframeLoaded" class="loading-overlay">
      <t-loading :loading="true" text="正在连接 Infinite Canvas..." size="large" />
    </div>
    <iframe
      :src="iframeUrl"
      class="canvas-iframe"
      :class="{ loaded: iframeLoaded }"
      frameborder="0"
      allow="clipboard-read; clipboard-write"
      @load="iframeLoaded = true"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const iframeLoaded = ref(false)

const CANVAS_BASE = 'http://localhost:3000'

// The path param can be a regular canvas path (/canvas, /image, etc.)
// OR an import token (import:xxx) that goes through the bridge
const rawPath = computed(() => route.query.path as string || '/canvas')
const isImport = computed(() => rawPath.value.startsWith('import:'))

const iframeUrl = computed(() => {
  if (isImport.value) {
    const raw = rawPath.value.replace('import:', '')
    const parts = raw.split('&')
    const token = parts[0]
    const canvasId = parts.find(p => p.startsWith('canvasId='))?.split('=')[1] || ''
    const apiBase = window.location.origin
    const projectId = (route.query.projectId as string) || ''
    let url = `${CANVAS_BASE}/import-bridge.html?token=${token}&api=${encodeURIComponent(apiBase)}`
    if (projectId) url += `&projectId=${encodeURIComponent(projectId)}`
    if (canvasId) url += `&canvasId=${encodeURIComponent(canvasId)}`
    return url
  }
  return `${CANVAS_BASE}${rawPath.value}`
})

const pageTitle = computed(() => {
  if (isImport.value) return '导入素材到画布'
  const map: Record<string, string> = {
    '/canvas': '我的画布',
    '/image': '生图工作台',
    '/video': '视频工作台',
    '/prompts': '提示词库',
    '/assets': '我的素材',
  }
  return map[rawPath.value] || 'Infinite Canvas'
})

function goBack() {
  router.push('/')
}
</script>

<style scoped>
.canvas-proxy {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  position: relative;
}
.proxy-toolbar {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  background: #fff;
  border-bottom: 1px solid var(--td-border-level-1-color);
  gap: 8px;
  flex-shrink: 0;
  z-index: 10;
}
.proxy-title { flex: 1; font-weight: 600; font-size: 14px; }
.external-link { text-decoration: none; }
.canvas-iframe { flex: 1; width: 100%; border: none; opacity: 0; transition: opacity 0.3s; }
.canvas-iframe.loaded { opacity: 1; }
.loading-overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; background: #fafafa; z-index: 5;
}
</style>
