<template>
  <div class="app-layout">
    <div class="sidebar">
      <div class="logo-box" @click="navigate('/')">
        <div class="logo">
          <t-icon name="video" size="22px" />
        </div>
      </div>

      <div class="nav-scroll">
        <div class="nav-section-label">创作</div>
        <t-tooltip content="我的项目" placement="right">
          <div class="nav-item" :class="{ active: isActive('/') && !isCanvasView }" @click="navigate('/')">
            <t-icon name="folder-1" size="20px" />
          </div>
        </t-tooltip>
        <t-tooltip content="我的画布" placement="right">
          <div class="nav-item" :class="{ active: isCanvasView }" @click="openCanvas('/canvas')">
            <t-icon name="layers" size="20px" />
          </div>
        </t-tooltip>

        <div class="nav-section-label">工作台</div>
        <t-tooltip content="生图工作台" placement="right">
          <div class="nav-item" :class="{ active: isCanvasPath('/image') }" @click="openCanvas('/image')">
            <t-icon name="image" size="20px" />
          </div>
        </t-tooltip>
        <t-tooltip content="视频工作台" placement="right">
          <div class="nav-item" :class="{ active: isCanvasPath('/video') }" @click="openCanvas('/video')">
            <t-icon name="video" size="20px" />
          </div>
        </t-tooltip>
        <t-tooltip content="画布配置" placement="right">
          <div class="nav-item" :class="{ active: isCanvasPath('/config') }" @click="openCanvas('/config')">
            <t-icon name="setting" size="20px" />
          </div>
        </t-tooltip>

        <div class="nav-section-label">资源</div>
        <t-tooltip content="提示词库" placement="right">
          <div class="nav-item" :class="{ active: isCanvasPath('/prompts') }" @click="openCanvas('/prompts')">
            <t-icon name="chat" size="20px" />
          </div>
        </t-tooltip>
        <t-tooltip content="我的素材" placement="right">
          <div class="nav-item" :class="{ active: isCanvasPath('/assets') }" @click="openCanvas('/assets')">
            <t-icon name="file" size="20px" />
          </div>
        </t-tooltip>

        <div class="nav-section-label">工具</div>
        <t-tooltip content="拼图" placement="right">
          <div class="nav-item" :class="{ active: isActive('/tools/tile') }" @click="navigate('/tools/tile')">
            <t-icon name="image" size="20px" />
          </div>
        </t-tooltip>

      </div>

      <div class="sidebar-spacer" />

      <div class="sidebar-bottom">
        <t-tooltip content="设置" placement="right">
          <div class="nav-item" :class="{ active: isActive('/settings') }" @click="navigate('/settings')">
            <t-icon name="setting" size="20px" />
          </div>
        </t-tooltip>
      </div>
    </div>

    <div class="main-content">
      <router-view />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const isCanvasView = computed(() => route.path.startsWith('/canvas-proxy'))
const canvasPath = computed(() => route.query.path as string || '')

function isActive(path: string) {
  if (path === '/') return route.path === '/' && !isCanvasView.value
  return route.path.startsWith(path)
}

function isCanvasPath(path: string) {
  return canvasPath.value === path
}

function navigate(path: string) {
  router.push(path)
}

function openCanvas(canvasPath: string) {
  router.push('/canvas-proxy?path=' + encodeURIComponent(canvasPath))
}
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--td-bg-color-page);
}

.sidebar {
  width: 52px;
  min-width: 52px;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-border-level-1-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: hidden;
  z-index: 100;
  padding: 0;
}

.logo-box {
  width: 52px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  border-bottom: 1px solid var(--td-border-level-1-color);
  margin-bottom: 4px;
}

.logo {
  width: 32px;
  height: 32px;
  background: var(--td-brand-color);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.nav-scroll {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  overflow-y: auto;
  width: 100%;
  padding: 0;
}

.nav-scroll::-webkit-scrollbar { width: 2px; }
.nav-scroll::-webkit-scrollbar-thumb { background: transparent; }

.nav-section-label {
  font-size: 7px;
  color: var(--td-text-color-placeholder);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 6px 0 4px;
  width: 100%;
  text-align: center;
  flex-shrink: 0;
  opacity: 0.6;
}

.nav-item {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  cursor: pointer;
  color: var(--td-text-color-secondary);
  transition: all 0.15s;
  flex-shrink: 0;
  margin: 1px 0;
}

.nav-item:hover {
  background: var(--td-bg-color-secondary);
  color: var(--td-text-color-primary);
}

.nav-item.active {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
}

.sidebar-spacer {
  flex: 1;
  min-height: 4px;
}

.sidebar-bottom {
  flex-shrink: 0;
  padding: 6px 0 10px;
  border-top: 1px solid var(--td-border-level-1-color);
  width: 100%;
  display: flex;
  justify-content: center;
  margin-top: auto;
}

.main-content {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
</style>
