<template>
  <div class="workbench">
    <!-- Config Dialog -->
    <t-dialog
      v-model:visible="showConfigDialog"
      header="工作流配置"
      :confirm-btn="{ content: '确认并生成工作流', loading: configSaving }"
      :cancel-btn="true"
      @confirm="onConfigConfirm"
      :close-on-overlay-click="false"
      :close-btn="false"
    >
      <t-form :data="configForm" label-align="top" layout="vertical">
        <t-form-item label="替换角色数量" name="characterCount">
          <t-input-number
            v-model="configForm.characterCount"
            :min="1"
            :max="10"
            style="width: 120px"
          />
          <span class="config-hint">每个视频片段将生成对应数量的角色空位</span>
        </t-form-item>

        <t-form-item label="替换背景" name="replaceBackground">
          <t-switch v-model="configForm.replaceBackground" />
          <span class="config-hint">开启后每个片段会生成一个背景参考图空位</span>
        </t-form-item>

        <t-form-item label="提示词模板" name="promptTemplate">
          <t-textarea
            v-model="configForm.promptTemplate"
            :rows="4"
            placeholder="输入提示词模板..."
          />
          <span class="config-hint">
            可用变量：<code>{角色1}</code> <code>{角色2}</code> ... <code>{背景描述}</code>
            <t-link theme="primary" size="small" @click="loadDefaultTemplate">从设置加载默认模板</t-link>
          </span>
        </t-form-item>
      </t-form>
    </t-dialog>

    <!-- Top toolbar -->
    <div class="workbench-toolbar">
      <t-button variant="text" @click="router.push(`/project/${projectId}`)">
        <t-icon name="arrow-left" /> 返回项目
      </t-button>
      <span class="toolbar-title">视频工作台</span>
      <div class="toolbar-actions">
        <t-button variant="outline" @click="showConfigDialog = true">重新配置</t-button>
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
          :default-viewport="{ x: 0, y: 0, zoom: 0.7 }"
          :node-types="nodeTypes"
          :min-zoom="0.1"
          :max-zoom="3"
          fit-view-on-init
          class="infinite-canvas"
        >
          <!-- Video node -->
          <template #node-video="nodeProps">
            <div class="flow-node video-node" :class="{ selected: selectedNode?.id === nodeProps.id }" @click="selectNode(nodeProps)">
              <div class="node-header"><t-icon name="video" /> 视频</div>
              <div class="node-preview">
                <video v-if="nodeProps.data.videoUrl" :src="nodeProps.data.videoUrl" muted style="width:100%;height:80px;object-fit:cover" />
                <div v-else class="node-placeholder"><t-icon name="video" size="24px" /><span>参考视频</span></div>
              </div>
              <div class="node-label">{{ nodeProps.data.label || '视频片段' }}</div>
              <div class="node-meta" v-if="nodeProps.data.timeRange">{{ nodeProps.data.timeRange }}</div>
            </div>
          </template>

          <!-- Character slot node -->
          <template #node-character="nodeProps">
            <div class="flow-node character-node" :class="{ selected: selectedNode?.id === nodeProps.id, empty: !nodeProps.data.imageUrl }" @click="selectNode(nodeProps)">
              <div class="node-header"><t-icon name="user" /> 角色{{ nodeProps.data.charIndex }}</div>
              <div class="node-preview">
                <img v-if="nodeProps.data.imageUrl" :src="nodeProps.data.imageUrl" style="width:100%;height:80px;object-fit:cover" />
                <div v-else class="node-placeholder empty-slot">
                  <t-icon name="add-rectangle" size="24px" />
                  <span>拖入角色图片</span>
                </div>
              </div>
              <div class="node-label">{{ nodeProps.data.label || `角色${nodeProps.data.charIndex}` }}</div>
            </div>
          </template>

          <!-- Background slot node -->
          <template #node-background="nodeProps">
            <div class="flow-node background-node" :class="{ selected: selectedNode?.id === nodeProps.id, empty: !nodeProps.data.imageUrl }" @click="selectNode(nodeProps)">
              <div class="node-header"><t-icon name="image" /> 背景参考</div>
              <div class="node-preview">
                <img v-if="nodeProps.data.imageUrl" :src="nodeProps.data.imageUrl" style="width:100%;height:80px;object-fit:cover" />
                <div v-else class="node-placeholder empty-slot">
                  <t-icon name="add-rectangle" size="24px" />
                  <span>拖入背景图</span>
                </div>
              </div>
              <div class="node-label">{{ nodeProps.data.label || '背景参考' }}</div>
            </div>
          </template>

          <!-- Generate node -->
          <template #node-generate="nodeProps">
            <div class="flow-node generate-node" :class="{ selected: selectedNode?.id === nodeProps.id }" @click="selectNode(nodeProps)">
              <div class="node-header"><t-icon name="play-circle" /> 生成</div>
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
        <h3>{{ panelTitle }}</h3>
        <t-form :data="nodeForm" label-align="top" layout="vertical">
          <t-form-item label="名称">
            <t-input v-model="nodeForm.label" @change="updateNodeLabel" />
          </t-form-item>

          <!-- Video node settings -->
          <template v-if="selectedNode.type === 'video'">
            <t-form-item label="视频参考">
              <t-select v-model="nodeForm.segmentId" :options="segmentOptions" @change="updateNodeVideo" />
            </t-form-item>
          </template>

          <!-- Character/Background node settings -->
          <template v-if="selectedNode.type === 'character' || selectedNode.type === 'background'">
            <t-form-item label="上传图片">
              <t-upload
                :files="imageFiles"
                :auto-upload="false"
                theme="image"
                accept="image/*"
                @change="(files) => handleImageUpload(files, selectedNode)"
              />
            </t-form-item>
            <t-form-item label="从素材库选择" v-if="assets.length > 0">
              <div class="asset-grid">
                <div
                  v-for="asset in assets"
                  :key="asset.id"
                  class="asset-item"
                  :class="{ selected: nodeForm.assetId === asset.id }"
                  @click="selectAsset(asset, selectedNode)"
                >
                  <img :src="'/oss/' + asset.filePath" />
                  <span>{{ asset.fileName }}</span>
                </div>
              </div>
            </t-form-item>
          </template>

          <!-- Generate node settings -->
          <template v-if="selectedNode.type === 'generate'">
            <t-form-item label="提示词">
              <t-textarea v-model="nodeForm.prompt" :rows="6" @change="updateNodePrompt" />
            </t-form-item>
          </template>
        </t-form>
        <div class="panel-actions">
          <t-button theme="danger" variant="outline" size="small" @click="deleteNode">删除节点</t-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { VueFlow, useVueFlow, type Node, type Edge, Panel, Position } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { projectApi, segmentApi, assetApi, settingApi } from '../api'

const route = useRoute()
const router = useRouter()
const { projectId } = route.params as { projectId: string }

// ─── State ───────────────────────────────────────────────
const nodes = ref<Node[]>([])
const edges = ref<Edge[]>([])
const selectedNode = ref<any>(null)
const canvasWrapperRef = ref<HTMLElement | null>(null)
const imageFiles = ref<any[]>([])
const segments = ref<any[]>([])
const assets = ref<any[]>([])
const zoomLevel = ref(70)
const configSaving = ref(false)

// 只包含选中的片段
const segmentsToBuild = ref<any[]>([])

const nodeForm = reactive({ label: '', prompt: '', segmentId: '', assetId: null as number | null })

// Config dialog
const showConfigDialog = ref(false)
const configForm = reactive({
  characterCount: 2,
  replaceBackground: true,
  promptTemplate: '保持原视频的动作和运镜，将人物替换为{角色1}{角色2}，场景替换为{背景描述}',
})

const { zoomIn, zoomOut, fitView } = useVueFlow({ id: 'main-flow' })

const nodeTypes = markRaw({
  video: 'video',
  character: 'character',
  background: 'background',
  generate: 'generate',
})

const segmentOptions = computed(() =>
  segments.value.map((s: any, i: number) => ({
    label: `片段 ${i + 1} (${s.startTime}-${s.endTime}s)`,
    value: s.id,
  }))
)

const panelTitle = computed(() => {
  const map: Record<string, string> = {
    video: '视频节点',
    character: '角色节点',
    background: '背景参考节点',
    generate: '生成配置',
  }
  return map[selectedNode.value?.type] || '节点配置'
})

// ─── Lifecycle ───────────────────────────────────────────
onMounted(async () => {
  await loadSegments()
  await loadAssets()
  await loadWorkflowConfig()
})

// ─── Load ────────────────────────────────────────────────
async function loadSegments() {
  try {
    const res = await segmentApi.list(parseInt(projectId))
    const allSegments = res.data.data || []
    // 如果传入了 selected 参数，只加载选中的片段
    const selectedParam = route.query.selected as string
    if (selectedParam) {
      const selectedIds = selectedParam.split(',').map(Number)
      segments.value = allSegments.filter((s: any) => selectedIds.includes(s.id))
      segmentsToBuild.value = segments.value
    } else {
      segments.value = allSegments
      segmentsToBuild.value = allSegments
    }
  } catch {}
}

async function loadAssets() {
  try {
    const res = await assetApi.list(parseInt(projectId))
    assets.value = res.data.data || []
  } catch {}
}

async function loadWorkflowConfig() {
  try {
    const res = await projectApi.get(parseInt(projectId))
    const project = res.data.data
    if (project?.workflowConfig && project.workflowConfig !== '{}') {
      const cfg = typeof project.workflowConfig === 'string' ? JSON.parse(project.workflowConfig) : project.workflowConfig
      Object.assign(configForm, cfg)
      buildWorkflow(cfg)
    } else {
      // Load default template from settings
      try {
        const settingsRes = await settingApi.get('defaultPromptTemplate')
        if (settingsRes.data.data?.defaultPromptTemplate) {
          configForm.promptTemplate = settingsRes.data.data.defaultPromptTemplate
        }
      } catch {}
      showConfigDialog.value = true
    }
  } catch {
    showConfigDialog.value = true
  }
}

async function loadDefaultTemplate() {
  try {
    const res = await settingApi.get('defaultPromptTemplate')
    const template = res.data.data?.defaultPromptTemplate
    if (template) {
      configForm.promptTemplate = template
      MessagePlugin.success('已加载默认模板')
    }
  } catch {
    MessagePlugin.warning('未找到默认模板')
  }
}

// ─── Config Dialog ───────────────────────────────────────
async function onConfigConfirm() {
  configSaving.value = true
  try {
    const cfg = {
      characterCount: configForm.characterCount,
      replaceBackground: configForm.replaceBackground,
      promptTemplate: configForm.promptTemplate,
    }
    // Save to backend
    await projectApi.update({ id: parseInt(projectId), workflowConfig: cfg })
    // Build workflow
    buildWorkflow(cfg)
    showConfigDialog.value = false
    MessagePlugin.success('工作流已生成')
  } catch (err: any) {
    MessagePlugin.error(`保存失败: ${err.message}`)
  } finally {
    configSaving.value = false
  }
}

// ─── Build Workflow ──────────────────────────────────────
function buildWorkflow(cfg: { characterCount: number; replaceBackground: boolean; promptTemplate: string }) {
  const newNodes: Node[] = []
  const newEdges: Edge[] = []

  const buildSegments = segmentsToBuild.value.length > 0 ? segmentsToBuild.value : segments.value

  buildSegments.forEach((seg: any, segIndex: number) => {
    const baseY = segIndex * 350 + 50
    const label = `片段 ${seg.sortOrder + 1}`
    const timeRange = `${seg.startTime}s - ${seg.endTime}s`

    // 1. Video node
    const videoId = `video_${seg.id}`
    newNodes.push({
      id: videoId,
      type: 'video',
      position: { x: 50, y: baseY + 40 },
      data: {
        label,
        timeRange,
        videoUrl: seg.videoFilePath ? `/oss/${seg.videoFilePath}` : null,
        segmentId: seg.id,
      },
    })

    // 2. Character slots
    const charNodeIds: string[] = []
    for (let ci = 0; ci < cfg.characterCount; ci++) {
      const charId = `char_${seg.id}_${ci}`
      charNodeIds.push(charId)
      newNodes.push({
        id: charId,
        type: 'character',
        position: { x: 350, y: baseY + ci * 100 },
        data: {
          label: `角色${ci + 1}`,
          charIndex: ci + 1,
          imageUrl: null,
          segmentId: seg.id,
        },
      })
    }

    // 3. Background slot (if enabled)
    let bgNodeId: string | null = null
    if (cfg.replaceBackground) {
      bgNodeId = `bg_${seg.id}`
      newNodes.push({
        id: bgNodeId,
        type: 'background',
        position: { x: 350, y: baseY + cfg.characterCount * 100 + 20 },
        data: {
          label: '背景参考',
          imageUrl: null,
          segmentId: seg.id,
        },
      })
    }

    // 4. Generate node
    const genId = `gen_${seg.id}`
    const genX = 700
    let genY = baseY + 40
    if (cfg.replaceBackground) {
      // Center the generate node vertically relative to all inputs
      const totalHeight = cfg.characterCount * 100 + 120
      genY = baseY + 40 + totalHeight / 2 - 40
    }
    newNodes.push({
      id: genId,
      type: 'generate',
      position: { x: genX, y: genY },
      data: {
        label: `生成 ${label}`,
        prompt: fillPromptTemplate(cfg.promptTemplate, cfg.characterCount),
        status: 'pending',
        segmentId: seg.id,
      },
    })

    // 5. Edges: video → gen, each char → gen, bg → gen
    newEdges.push({
      id: `e_${videoId}_${genId}`,
      source: videoId,
      target: genId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#0052d9' },
    })
    for (const charId of charNodeIds) {
      newEdges.push({
        id: `e_${charId}_${genId}`,
        source: charId,
        target: genId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#2ba471' },
      })
    }
    if (bgNodeId) {
      newEdges.push({
        id: `e_${bgNodeId}_${genId}`,
        source: bgNodeId,
        target: genId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#e37318' },
      })
    }
  })

  nodes.value = newNodes
  edges.value = newEdges
}

function fillPromptTemplate(template: string, charCount: number): string {
  let result = template
  for (let i = 1; i <= charCount; i++) {
    result = result.replace(`{角色${i}}`, `角色${i}`)
  }
  result = result.replace('{背景描述}', '目标场景')
  return result
}

// ─── Node Actions ────────────────────────────────────────
function selectNode(nodeProps: any) {
  selectedNode.value = nodeProps
  nodeForm.label = nodeProps.data.label || ''
  nodeForm.prompt = nodeProps.data.prompt || ''
  nodeForm.segmentId = nodeProps.data.segmentId || ''
  nodeForm.assetId = null
}

function updateNodeLabel() {
  if (selectedNode.value) selectedNode.value.data.label = nodeForm.label
}

function updateNodePrompt() {
  if (selectedNode.value) selectedNode.value.data.prompt = nodeForm.prompt
}

function updateNodeVideo() {
  if (selectedNode.value) {
    selectedNode.value.data.segmentId = nodeForm.segmentId
    const seg = segments.value.find((s: any) => s.id === nodeForm.segmentId)
    if (seg) {
      selectedNode.value.data.videoUrl = seg.videoFilePath ? `/oss/${seg.videoFilePath}` : null
    }
  }
}

function onPromptChange(id: string, val: string) {
  const n = nodes.value.find((n: any) => n.id === id)
  if (n) n.data.prompt = val
}

async function handleImageUpload(files: any, targetNode: any) {
  imageFiles.value = files
  if (files[0]?.raw && targetNode) {
    try {
      const fd = new FormData()
      fd.append('file', files[0].raw)
      fd.append('projectId', projectId)
      fd.append('type', targetNode.type === 'background' ? 'background' : 'character_view')
      const res = await assetApi.upload(fd)
      targetNode.data.imageUrl = res.data.data.url
      MessagePlugin.success('图片已上传')
    } catch (err: any) {
      MessagePlugin.error(`上传失败: ${err.message}`)
    }
  }
}

function selectAsset(asset: any, targetNode: any) {
  targetNode.data.imageUrl = `/oss/${asset.filePath}`
  nodeForm.assetId = asset.id
  MessagePlugin.success(`已选择: ${asset.fileName}`)
}

function addImageNode() {
  const id = `image_${Date.now()}`
  const node: Node = {
    id,
    type: 'character',
    position: { x: 350, y: nodes.value.length * 100 + 50 },
    data: { label: '图片节点', imageUrl: null, charIndex: nodes.value.length },
  }
  nodes.value.push(node)
}

function deleteNode() {
  if (selectedNode.value) {
    nodes.value = nodes.value.filter((n: any) => n.id !== selectedNode.value.id)
    edges.value = edges.value.filter(
      (e: any) => e.source !== selectedNode.value.id && e.target !== selectedNode.value.id
    )
    selectedNode.value = null
  }
}

function generateFromNode(nodeProps: any) {
  const generateId = `generate_${Date.now()}`
  const generateNode: Node = {
    id: generateId,
    type: 'generate',
    position: { x: nodeProps.position.x + 350, y: nodeProps.position.y },
    data: { label: '视频生成', prompt: '', status: 'pending' },
  }
  nodes.value.push(generateNode)
  edges.value.push({
    id: `e_${nodeProps.id}_${generateId}`,
    source: nodeProps.id,
    target: generateId,
    type: 'smoothstep',
    animated: true,
  })
  selectedNode.value = generateNode
  nodeForm.label = '视频生成'
  nodeForm.prompt = ''
}

function saveWorkbench() {
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

// ─── Helpers ─────────────────────────────────────────────
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
.toolbar-title { font-weight: 600; flex: 1; }
.toolbar-actions { display: flex; gap: 8px; }
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
.infinite-canvas { width: 100%; height: 100%; }

/* ─── Nodes ─────────────────────────────────────── */
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
.flow-node:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
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
.character-node .node-header { background: #f0f5eb; color: #2ba471; }
.background-node .node-header { background: #fff3e0; color: #e37318; }
.generate-node .node-header { background: #f3e8ff; color: #722ed1; }

/* Empty slot styling */
.character-node.empty .node-preview,
.background-node.empty .node-preview {
  border: 2px dashed var(--td-border-level-2-color);
  background: var(--td-bg-color-secondary);
}
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
.node-meta {
  padding: 0 10px 6px;
  font-size: 11px;
  color: var(--td-text-color-placeholder);
}
.node-prompt-area { padding: 8px; }
.prompt-input {
  width: 100%;
  border: 1px solid var(--td-border-level-1-color);
  border-radius: 4px;
  padding: 6px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
  background: var(--td-bg-color-component);
}
.prompt-input:focus {
  outline: none;
  border-color: var(--td-brand-color);
  background: #fff;
}
.node-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid var(--td-border-level-1-color);
}

/* ─── Right Panel ───────────────────────────────── */
.config-panel {
  width: 320px;
  background: #fff;
  border-left: 1px solid var(--td-border-level-1-color);
  padding: 16px;
  overflow-y: auto;
  flex-shrink: 0;
}
.config-panel h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
}
.panel-actions { margin-top: 16px; }

/* ─── Zoom ───────────────────────────────────────── */
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

/* ─── Config Dialog ──────────────────────────────── */
.config-hint {
  font-size: 12px;
  color: var(--td-text-color-placeholder);
  display: block;
  margin-top: 4px;
}
.config-hint code {
  background: var(--td-bg-color-secondary);
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 11px;
}

/* ─── Asset Grid ─────────────────────────────────── */
.asset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}
.asset-item {
  border: 2px solid var(--td-border-level-1-color);
  border-radius: 6px;
  padding: 4px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.2s;
}
.asset-item:hover { border-color: var(--td-brand-color); }
.asset-item.selected { border-color: var(--td-brand-color); background: var(--td-brand-color-light); }
.asset-item img {
  width: 100%;
  height: 60px;
  object-fit: cover;
  border-radius: 4px;
}
.asset-item span {
  font-size: 10px;
  display: block;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>