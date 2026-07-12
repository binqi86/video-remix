<template>
  <div class="dashboard">
    <div class="page-header">
      <h1>我的项目</h1>
      <t-button theme="primary" @click="showCreateDialog = true">新建项目</t-button>
    </div>

    <t-loading :loading="store.loading">
      <div v-if="store.projects.length === 0" class="empty-state">
        <t-icon name="file" size="48px" />
        <p>还没有项目，点击右上角新建项目开始创作</p>
      </div>
      <div v-else class="project-grid">
        <div
          v-for="project in store.projects"
          :key="project.id"
          class="project-card"
        >
          <div class="card-thumb" @click="router.push(`/project/${project.id}`)">
            <div v-if="project.videoFilePath" class="card-video-preview">
              <video :src="`/oss/${project.videoFilePath}`" muted preload="metadata"
                @mouseenter="($event) => { try { ($event.target as HTMLVideoElement).play(); } catch(e) {} }"
                @mouseleave="($event) => { const v = $event.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }"
              />
            </div>
            <div v-else class="card-icon">
              <t-icon name="video" size="32px" />
            </div>
          </div>
          <div class="card-body" @click="router.push(`/project/${project.id}`)">
            <div class="card-header">
              <h3>{{ project.name }}</h3>
              <t-tag :theme="statusTheme(project.status)" size="small">{{ statusLabel(project.status) }}</t-tag>
            </div>
            <p class="card-desc">{{ project.description || '暂无描述' }}</p>
            <div class="card-meta">
              <span v-if="project.videoFileName">🎬 {{ project.videoFileName }}</span>
              <span v-if="project.videoDuration">⏱ {{ formatDuration(project.videoDuration) }}</span>
            </div>
          </div>
          <div class="card-actions">
            <t-button variant="text" size="small" @click="router.push(`/project/${project.id}`)">查看</t-button>
            <t-popconfirm content="确定删除该项目？此操作不可恢复" @confirm="() => handleDelete(project)">
              <t-button variant="text" theme="danger" size="small">删除</t-button>
            </t-popconfirm>
          </div>
        </div>
      </div>
    </t-loading>

    <t-dialog
      v-model:visible="showCreateDialog"
      header="新建项目"
      :confirm-btn="{ theme: 'primary', content: '创建' }"
      @confirm="handleCreate"
    >
      <t-form :data="formData" label-align="top">
        <t-form-item label="项目名称" name="name" :rules="[{ required: true, message: '请输入项目名称' }]">
          <t-input v-model="formData.name" placeholder="例如：舞蹈视频二创" />
        </t-form-item>
        <t-form-item label="项目描述" name="description">
          <t-textarea v-model="formData.description" placeholder="描述你想要的效果（选填）" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useProjectStore, type Project } from '../stores/project'

const router = useRouter()
const store = useProjectStore()
const showCreateDialog = ref(false)
const formData = ref({ name: '', description: '' })

onMounted(() => store.fetchProjects())

function statusTheme(status: string) {
  const map: Record<string, string> = { draft:'default', analyzing:'warning', ready:'success', generating:'warning', completed:'success', failed:'danger' }
  return map[status] || 'default'
}
function statusLabel(status: string) {
  const map: Record<string, string> = { draft:'草稿', analyzing:'分析中', ready:'就绪', generating:'生成中', completed:'已完成', failed:'失败' }
  return map[status] || status
}
function formatDuration(seconds: number) {
  const m = Math.floor(seconds/60), s = Math.floor(seconds%60)
  return `${m}:${s.toString().padStart(2,'0')}`
}

async function handleCreate() {
  if (!formData.value.name) { MessagePlugin.warning('请输入项目名称'); return }
  try {
    await store.createProject({ ...formData.value })
    MessagePlugin.success('项目创建成功')
    showCreateDialog.value = false
    formData.value = { name: '', description: '' }
  } catch (err: any) { MessagePlugin.error(`创建失败: ${err.message}`) }
}

async function handleDelete(project: Project) {
  try {
    await store.deleteProject(project.id)
    MessagePlugin.success('已删除')
  } catch (err: any) {
    MessagePlugin.error(`删除失败: ${err.message}`)
  }
}
</script>

<style scoped>
.dashboard {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.page-header h1 { font-size: 24px; font-weight: 600; }
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--td-text-color-placeholder);
}
.empty-state p { margin: 16px 0; }

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.project-card {
  background: #fff;
  border: 1px solid var(--td-border-level-1-color);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
}

.project-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  border-color: var(--td-brand-color-light);
}

.card-thumb {
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
}
.card-thumb:has(.card-icon) {
  background: linear-gradient(135deg, var(--td-brand-color-light) 0%, #f0f5ff 100%);
  color: var(--td-brand-color);
}
.card-icon { text-align: center; }
.card-video-preview { width: 100%; height: 100%; }
.card-video-preview video { width: 100%; height: 100%; object-fit: cover; }

.card-body {
  padding: 12px 14px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.card-header h3 {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.card-desc {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  line-height: 1.4;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  font-size: 11px;
  color: var(--td-text-color-placeholder);
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.card-actions {
  padding: 8px 14px;
  border-top: 1px solid var(--td-border-level-1-color);
  display: flex;
  justify-content: flex-end;
}
</style>
