<template>
  <div class="workbench">
    <!-- Top toolbar -->
    <div class="workbench-toolbar">
      <t-button variant="text" @click="router.push(`/project/${projectId}`)">
        <t-icon name="arrow-left" /> 返回项目
      </t-button>
      <span class="toolbar-title">视频工作台</span>
      <div class="toolbar-actions">
        <t-button variant="outline" @click="addVideoNode">添加视频节点</t-button>
        <t-button variant="outline" @click="addImageNode">添加图片节点</t-button>
        <t-button theme="primary" @click="saveWorkbench">保存</t-button>
      </div>
    </div>

    <!-- Main area: VueFlow canvas + right panel -->
    <div class="workbench-body">
      <!-- VueFlow Infinite Canvas -->
      <div class="canvas-area" ref="canvasWrapperRef">
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :default-viewport="{ x: 100, y: 100, zoom: 0.8 }"
          :node-types="nodeTypes"
          :min-zoom="0.1"
          :max-zoom="3"
          fit-view-on-init
          class="infinite-canvas"
        >
          <!-- Custom controls -->
          <template #node-video="nodeProps">
            <div class="flow-node video-node" :class="{ selected: selectedNode?.id === nodeProps.id }" @click="selectNode(nodeProps)">
              <div class="node-header">
                <t-icon name="video" /> 视频
              </div>
              <div class="node-preview">
                <video v-if="nodeProps.data.videoUrl" :src="nodeProps.data.videoUrl" muted style="width:100%;height:80px;object-fit:cover" />
                <div v-else class="node-placeholder">
                  <t-icon name="video" size="24px" />
                  <span>参考视频</span>
                </div>
              </div>
              <div class="node-label">{{ nodeProps.data.label || '视频片段' }}</div>
              <div class="node-prompt" v-if="nodeProps.data.prompt">{{ truncate(nodeProps.data.prompt, 30) }}</div>
            </div>
          </template>

          <template #node-image="nodeProps">
            <div class="flow-node image-node" :class="{ selected: selectedNode?.id === nodeProps.id }" @click="selectNode(nodeProps)">
              <div class="node-header">
                <t-icon name="image" /> 图片
              </div>
              <div class="node-preview">
                <img v-if="nodeProps.data.imageUrl" :src="nodeProps.data.imageUrl" style="width:100%;height:80px;object-fit:cover" />
                <div v-else class="node-placeholder">
                  <t-icon name="image" size="24px" />
                  <span>角色图/参考帧</span>
                </div>
              </div>
              <div class="node-label">{{ nodeProps.data.label || '图片' }}</div>
            </div>
          </template>

          <template #node-generate="nodeProps">
            <div class="flow-node generate-node" :class="{ selected: selectedNode?.id === nodeProps.id }" @click="selectNode(nodeProps)">
              <div class="node-header">
                <t-icon name="play-circle" /> 生成
              </div>
              <div class="node-prompt-area">
                <textarea
                  v-model="nodeProps.data.prompt"
                  placeholder="输入生成提示词..."
                  rows="3"
                  @click.stop
                  @input="onPromptChange(nodeProps.id, nodeProps.data.prompt)"
                  class="prompt-input"
                />
              </div>
              <div class="node-footer">
                <t-tag v-if="nodeProps.data.status" :theme="statusTheme(nodeProps.data.status)" size="small">
                  {{ statusLabel(nodeProps.data.status) }}
                </t-tag>
                <t-button size="small" @click.stop="generateFromNode(nodeProps)">生成</t-button>
              </div>
            </div>
          </template>

          <!-- Custom zoom controls -->
          <Panel :position="Position.BottomRight">
            <div class="zoom-controls">
              <t-button size="small" @click="zoomIn">+</t-button>
              <span class="zoom-label">{{ zoomLevel }}%</span>
              <t-button size="small" @click="zoomOut">-</t-button>
              <t-button size="small" @click="fitView">适应</t-button>
            </div>
          </Panel>
        </VueFlow>
      </div>

      <!-- Right config panel -->
      <div class="config-panel" v-if="selectedNode">
        <h3>{{ selectedNode.type === 'generate' ? '生成配置' : selectedNode.type === 'video' ? '视频节点' : '图片节点' }}</h3>
        <t-form :data="nodeForm" label-align="top" layout="vertical">
          <t-form-item label="名称">
            <t-input v-model="nodeForm.label" @change="updateNodeLabel" />
          </t-form-item>
          <t-form-item v-if="selectedNode.type === 'generate'" label="提示词">
            <t-textarea v-model="nodeForm.prompt" :rows="6" @change="updateNodePrompt" />
          </t-form-item>
          <t-form-item v-if="selectedNode.type === 'video'" label="视频参考">
            <t-select v-model="nodeForm.segmentId" :options="segmentOptions" @change="updateNodeVideo" />
          </t-form-item>
          <t-form-item v-if="selectedNode.type === 'image'" label="上传图片">
            <t-upload
              :files="imageFiles"
              :auto-upload="false"
              theme="image"
              accept="image/*"
              @change="handleImageUpload"
            />
          </t-form-item>
        </t-form>
        <div class="panel-actions">
          <t-button theme="danger" variant="outline" size="small" @click="deleteNode">删除节点</t-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { VueFlow, useVueFlow, type Node, type Edge, Panel, Position } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { segmentApi, assetApi } from '../api'

const route = useRoute()
const router = useRouter()
const { projectId, segmentId } = route.params as { projectId: string; segmentId?: string }

const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const selectedNode = ref<any>(null)
const canvasWrapperRef = ref<HTMLElement | null>(null)
const imageFiles = ref<any[]>([])
const segments = ref<any[]>([])
const nodeForm = reactive({ label: '', prompt: '', segmentId: '' })
const zoomLevel = ref(80)

const { zoomIn, zoomOut, fitView } = useVueFlow({ id: 'main-flow' })

// Node types must be marked raw to avoid Vue reactivity issues
const nodeTypes = markRaw({
  video: 'video',
  image: 'image',
  generate: 'generate',
})

const segmentOptions = computed(() =>
  segments.value.map((s: any, i: number) => ({
    label: `片段 ${i + 1} (${s.startTime}-${s.endTime}s)`,
    value: s.id,
  }))
)

onMounted(async () => {
  await loadSegments()
  // If a segmentId is provided, auto-add it as a video node
  if (segmentId) {
    const seg = segments.value.find((s: any) => s.id === parseInt(segmentId))
    if (seg) {
      addVideoNode(seg)
    }
  }
})

async function loadSegments() {
  try {
    const res = await segmentApi.list(parseInt(projectId))
    segments.value = res.data.data || []
  } catch {}
}

function addVideoNode(seg?: any) {
  const id = `video_${Date.now()}`
  const node: Node = {
    id,
    type: 'video',
    position: { x: nodes.value.length * 300 + 50, y: 200 },
    data: {
      label: seg ? `片段 ${seg.sortOrder + 1}` : '视频节点',
      videoUrl: seg ? `/${seg.videoGenPath || ''}` : null,
      prompt: seg?.prompt || '',
    },
  }
  nodes.value.push(node)
}

function addImageNode() {
  const id = `image_${Date.now()}`
  const node: Node = {
    id,
    type: 'image',
    position: { x: nodes.value.length * 300 + 50, y: 400 },
    data: { label: '图片节点', imageUrl: null },
  }
  nodes.value.push(node)
}

function selectNode(nodeProps: any) {
  selectedNode.value = nodeProps
  nodeForm.label = nodeProps.data.label || ''
  nodeForm.prompt = nodeProps.data.prompt || ''
  nodeForm.segmentId = nodeProps.data.segmentId || ''
}

function updateNodeLabel() {
  if (selectedNode.value) {
    selectedNode.value.data.label = nodeForm.label
  }
}

function updateNodePrompt() {
  if (selectedNode.value) {
    selectedNode.value.data.prompt = nodeForm.prompt
  }
}

function updateNodeVideo() {
  if (selectedNode.value) {
    selectedNode.value.data.segmentId = nodeForm.segmentId
    const seg = segments.value.find((s: any) => s.id === nodeForm.segmentId)
    if (seg) {
      selectedNode.value.data.videoUrl = `/${seg.videoGenPath || ''}`
    }
  }
}

function onPromptChange(id: string, val: string) {
  const n = nodes.value.find((n: any) => n.id === id)
  if (n) n.data.prompt = val
}

async function handleImageUpload(files: any) {
  imageFiles.value = files
  if (files[0]?.raw && selectedNode.value) {
    try {
      const fd = new FormData()
      fd.append('file', files[0].raw)
      fd.append('projectId', projectId)
      fd.append('type', 'character_view')
      const res = await assetApi.upload(fd)
      selectedNode.value.data.imageUrl = `/${res.data.data.filePath}`
      MessagePlugin.success('图片已上传')
    } catch (err: any) {
      MessagePlugin.error(`上传失败: ${err.message}`)
    }
  }
}

function deleteNode() {
  if (selectedNode.value) {
    nodes.value = nodes.value.filter((n: any) => n.id !== selectedNode.value.id)
    selectedNode.value = null
  }
}

function generateFromNode(nodeProps: any) {
  const generateId = `generate_${Date.now()}`
  const generateNode: Node = {
    id: generateId,
    type: 'generate',
    position: {
      x: nodeProps.position.x + 350,
      y: nodeProps.position.y,
    },
    data: {
      label: '视频生成',
      prompt: '',
      status: 'pending',
    },
  }
  nodes.value.push(generateNode)

  // Create edge from source node to generate node
  edges.value.push({
    id: `e_${nodeProps.id}_${generateId}`,
    source: nodeProps.id,
    target: generateId,
    type: 'smoothstep',
    animated: true,
  })

  // Select the new generate node
  selectedNode.value = generateNode
  nodeForm.label = '视频生成'
  nodeForm.prompt = ''
}

function saveWorkbench() {
  // Save workbench state to localStorage for now
  const state = {
    nodes: nodes.value.map((n: any) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })),
    edges: edges.value.map((e: any) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  }
  localStorage.setItem(`workbench_${projectId}`, JSON.stringify(state))
  MessagePlugin.success('工作台已保存')
}

function truncate(s: string, len: number) {
  return s && s.length > len ? s.slice(0, len) + '...' : s || ''
}

function statusTheme(s: string) {
  switch (s) {
    case 'generating': return 'warning'
    case 'completed': return 'success'
    case 'failed': return 'danger'
    default: return 'default'
  }
}
function statusLabel(s: string) {
  switch (s) {
    case 'generating': return '生成中'
    case 'completed': return '完成'
    case 'failed': return '失败'
    default: return '待处理'
  }
}
</script>

<style scoped>
.workbench {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.workbench-toolbar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid var(--td-border-level-1-color);
  gap: 12px;
  z-index: 10;
}
.toolbar-title {
  font-weight: 600;
  flex: 1;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.workbench-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.canvas-area {
  flex: 1;
  position: relative;
  height: 100%;
}
.infinite-canvas {
  width: 100%;
  height: 100%;
}
.flow-node {
  background: #fff;
  border: 2px solid var(--td-border-level-1-color);
  border-radius: 8px;
  padding: 0;
  min-width: 200px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.flow-node:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
}
.flow-node.selected {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 2px rgba(0,100,255,0.15);
}
.node-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 600;
  background: var(--td-bg-color-secondary);
  border-radius: 6px 6px 0 0;
  color: var(--td-text-color-secondary);
}
.video-node .node-header { background: #e8f4fd; color: #0052d9; }
.image-node .node-header { background: #f0f5eb; color: #2ba471; }
.generate-node .node-header { background: #fff3e0; color: #e37318; }
.node-preview {
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.node-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--td-text-color-placeholder);
  font-size: 11px;
}
.node-label {
  padding: 4px 10px;
  font-size: 13px;
  font-weight: 500;
}
.node-prompt {
  padding: 0 10px 4px;
  font-size: 11px;
  color: var(--td-text-color-placeholder);
  line-height: 1.3;
}
.node-prompt-area {
  padding: 8px;
}
.prompt-input {
  width: 100%;
  border: 1px solid var(--td-border-level-1-color);
  border-radius: 4px;
  padding: 6px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
}
.prompt-input:focus {
  outline: none;
  border-color: var(--td-brand-color);
}
.node-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid var(--td-border-level-1-color);
}
.config-panel {
  width: 320px;
  background: #fff;
  border-left: 1px solid var(--td-border-level-1-color);
  padding: 16px;
  overflow-y: auto;
}
.config-panel h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
}
.panel-actions {
  margin-top: 16px;
}
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  padding: 4px 8px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.zoom-label {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  min-width: 36px;
  text-align: center;
}
</style>
