<template>
  <div class="project-detail" v-if="project">
    <div class="page-header">
      <div class="header-left">
        <t-button variant="text" @click="router.push('/')">
          <t-icon name="arrow-left" /> 返回
        </t-button>
        <h1>{{ project.name }}</h1>
        <t-tag :theme="statusTheme(project.status)" size="small">{{ statusLabel(project.status) }}</t-tag>
      </div>
      <div class="header-right">
        <t-button v-if="!project.videoFilePath" theme="primary" @click="showUploadDialog = true">上传视频</t-button>
        <t-button v-else variant="outline" @click="showUploadDialog = true">重新上传</t-button>
      </div>
    </div>

    <div class="content-area">
      <!-- Video Info -->
      <t-card v-if="project.videoFilePath" title="视频信息" class="info-card">
        <div class="video-preview-row">
          <div class="video-preview-thumb" @click="previewOriginalVideo">
            <video :src="getOriginalVideoUrl" muted preload="metadata" />
            <div class="play-overlay"><t-icon name="play-circle" size="40px" /></div>
          </div>
          <t-descriptions :column="2" bordered style="flex:1">
            <t-descriptions-item label="文件名">{{ project.videoFileName }}</t-descriptions-item>
            <t-descriptions-item label="时长">{{ formatDuration(project.videoDuration || 0) }}</t-descriptions-item>
            <t-descriptions-item label="分辨率">{{ project.videoWidth }}x{{ project.videoHeight }}</t-descriptions-item>
            <t-descriptions-item label="帧率">{{ project.videoFps?.toFixed(1) }}fps</t-descriptions-item>
            <t-descriptions-item label="分段模式">
              <t-tag size="small">{{ modeLabel(project.segmentationMode || 'auto') }}</t-tag>
            </t-descriptions-item>
          </t-descriptions>
        </div>
        <div v-if="segments.length > 0" style="margin-top:12px;text-align:right">
          <t-button variant="outline" size="small" @click="showResegmentDialog = true">重新分段</t-button>
        </div>
      </t-card>

      <!-- Segments -->
      <div v-if="segments.length > 0" class="segment-section">
        <div class="segment-toolbar">
          <h2>视频片段（{{ segments.length }} 段）</h2>
          <div class="segment-toolbar-right">
            <t-checkbox v-model="selectAll" @change="toggleSelectAll">全选</t-checkbox>
            <span class="selected-count">已选 {{ selectedIds.size }} 项</span>
            <t-button size="small" theme="primary" @click="importSelectedToCanvas">导入到画布</t-button>
          </div>
        </div>

        <!-- Segment grid -->
        <div class="segment-grid">
          <div
            v-for="(seg, index) in segments"
            :key="seg.id"
            class="segment-card"
            :class="{ selected: selectedIds.has(seg.id) }"
          >
            <div class="segment-check">
              <t-checkbox :checked="selectedIds.has(seg.id)" @click.stop="toggleSelect(seg.id)" />
            </div>
            <div class="segment-thumb" @click="previewVideo(seg)">
              <video
                :src="getSegmentClipUrl(seg)"
                muted
                preload="metadata"
                ref="videoRefs"
                @mouseenter="($event) => { try { ($event.target as HTMLVideoElement).play(); } catch(e) {} }"
                @mouseleave="($event) => { const v = $event.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }"
              />
              <div class="segment-duration">{{ formatTime(seg.startTime) }} - {{ formatTime(seg.endTime) }}</div>
              <div class="play-overlay">
                <t-icon name="play-circle" size="32px" />
              </div>
              <div v-if="seg.videoGenPath && seg.videoGenState === 'completed'" class="gen-video-badge" @click.stop="previewGeneratedVideo(seg)">
                <t-icon name="video" size="14px" /> 生成视频
              </div>
            </div>
            <div class="segment-info">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <span class="segment-title">片段 {{ index + 1 }}</span>
                <span class="segment-meta">{{ seg.duration.toFixed(1) }}s</span>
              </div>
              <div style="margin-top:4px;font-size:11px;line-height:1.8">
                <span style="color:var(--td-brand-color);cursor:pointer" @click.stop="openCanvas(seg)">画布</span>
                <span style="margin-left:12px;color:var(--td-text-color-placeholder);cursor:pointer" @click.stop="exportFrame(seg,'first')">首帧</span>
                <span style="margin-left:12px;color:var(--td-text-color-placeholder);cursor:pointer" @click.stop="exportFrame(seg,'last')">尾帧</span>
              </div>
            </div>
            <!-- Generated video section removed to separate grid below -->
          </div>
        </div>
      </div>


      <!-- Generated video results -->
      <div v-if="segments.length > 0" class="gen-results-section">
        <div class="segment-toolbar" style="margin-top:24px">
          <h2>生成视频结果（{{ segments.length }} 个）</h2>
        </div>
        <div class="segment-grid">
          <div v-for="(seg, index) in segments" :key="'gen-'+seg.id" class="segment-card">
            <div v-if="seg.videoGenPath && seg.videoGenState === 'completed'" class="segment-thumb" style="cursor:pointer" @click="previewGeneratedVideo(seg)">
              <video :key="'gv-'+seg.id+'-'+genRefreshKey" :src="getGeneratedVideoUrl(seg)" muted preload="metadata" />
              <div class="play-overlay"><t-icon name="play-circle" size="32px" /></div>
              <div class="gen-replace" @click.stop="triggerGenUpload(seg)">替换</div>
            </div>
            <div v-else class="gen-upload-area" @click="triggerGenUpload(seg)" @dragover.prevent @drop.prevent="handleGenDrop($event, seg)" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:130px;text-align:center">
              <t-icon name="upload" size="24px" style="color:var(--td-brand-color)" />
              <span style="font-size:12px;color:var(--td-text-color-placeholder)">上传或等待生成</span>
            </div>
            <div class="segment-info">
              <div style="font-weight:600;font-size:13px">结果 {{ index + 1 }}</div>
              <div style="font-size:11px;line-height:1.8">
                <span style="color:var(--td-brand-color);cursor:pointer" @click.stop="openCanvas(seg)">画布</span>
                <span style="margin-left:12px;color:var(--td-text-color-placeholder);cursor:pointer" @click.stop="exportFrame(seg,'first','generated')">首帧</span>
                <span style="margin-left:12px;color:var(--td-text-color-placeholder);cursor:pointer" @click.stop="exportFrame(seg,'last','generated')">尾帧</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div v-if="!project.videoFilePath" class="empty-state">
        <t-icon name="video" size="48px" />
        <p>上传一段视频开始创作</p>
      </div>
    </div>

    <!-- Upload Dialog -->
    <t-dialog v-model:visible="showUploadDialog" header="上传参考视频"
      :confirm-btn="{ content: '上传并分段', theme: 'primary' }"
      @confirm="handleVideoUpload">
      <div class="upload-dropzone" @click="$refs.fileInput?.click()" @dragover.prevent @drop.prevent="onFileDrop">
        <t-icon v-if="!selectedFileName" name="upload" size="48px" style="color:var(--td-brand-color)" />
        <p v-if="!selectedFileName">点击或拖拽视频文件到此处</p>
        <p v-else style="font-weight:500">{{ selectedFileName }}</p>
        <t-button v-if="selectedFileName" variant="text" theme="danger" size="small" @click.stop="selectedFileName='';uploadFiles=[]">移除</t-button>
      </div>
      <input ref="fileInput" type="file" accept="video/*" style="display:none" @change="onNativeFileSelect" />
      <div class="segmentation-mode-selector">
        <p class="mode-label">分段方式</p>
        <div class="mode-radio-group">
          <t-radio v-for="opt in modeOptions" :key="opt.value" :value="opt.value" :checked="segmentationMode === opt.value" :disabled="opt.disabled" name="segmentationMode" @change="segmentationMode = opt.value">
            {{ opt.label }}
          </t-radio>
        </div>
        <div v-if="segmentationMode === 'fixed'" class="fixed-interval-input">
          <label>间隔（秒）:</label>
          <t-input v-model="fixedInterval" type="number" :min="3" :max="15" style="width:80px;margin-left:8px" />
        </div>
        <div v-if="segmentationMode === 'custom'" class="fixed-interval-input">
          <label>自定义范围:</label>
          <t-input v-model="customRanges" placeholder="例: 0,5|6,10|11," style="width:260px;margin-left:8px;font-size:12px" />
          <p style="margin:4px 0 0 0;font-size:11px;color:var(--td-text-color-placeholder)">| 分隔段落，逗号分隔起止秒数，空到尾=到结束</p>
        </div>
        <p class="mode-hint">{{ modeHint }}</p>
      </div>
    </t-dialog>

    <!-- Processing Progress Dialog -->
    <t-dialog v-model:visible="showProcessing" header="视频处理中" :footer="false" :close-btn="false" :mask-closable="false" destroy-on-close>
      <div style="padding:16px 0">
        <div v-for="s in processSteps" :key="s.key" class="process-step" style="display:flex;align-items:center;margin:8px 0;gap:8px">
          <t-icon v-if="s.done" name="check-circle" style="color:var(--td-success-color);font-size:18px" />
          <t-icon v-else-if="s.active" name="loading" style="color:var(--td-brand-color);font-size:18px" />
          <t-icon v-else name="ellipsis" style="color:var(--td-text-color-disabled);font-size:18px" />
          <span :style="{ color: s.done ? 'var(--td-success-color)' : s.active ? '' : 'var(--td-text-color-disabled)' }">{{ s.label }}</span>
          <t-progress v-if="s.active" :percentage="s.percent" style="flex:1;margin-left:8px" />
        </div>
      </div>
    </t-dialog>

    <!-- Generation Progress Dialog -->
    <t-dialog v-model:visible="showGenProgress" header="生成进度" :footer="false" :close-btn="true">
      <div v-for="seg in segments" :key="seg.id" class="gen-item">
        <span>片段 {{ seg.sortOrder + 1 }}</span>
        <t-progress :percentage="genPercent(seg)" :label="genPercentLabel(seg)" />
      </div>
      <div v-if="genStore.outputUrl" class="output-section">
        <t-divider /><h4>生成完成!</h4>
        <video :src="genStore.outputUrl" controls style="width:100%; max-height:300px" />
      </div>
    </t-dialog>

    <!-- Video Preview Dialog -->
    <t-dialog v-model:visible="showVideoPreview" header="视频预览" width="800px" :footer="false" :close-btn="true" destroy-on-close>
      <video v-if="previewUrl" :src="previewUrl" controls autoplay style="width:100%; max-height:70vh" />
    </t-dialog>

    <!-- Re-segment Dialog -->
    <t-dialog v-model:visible="showResegmentDialog" header="选择分段方式"
      :confirm-btn="{ content: '开始重新分段', theme: 'primary' }"
      @confirm="handleResegment">
      <div class="segmentation-mode-selector">
        <p class="mode-label">当前分段方式: <t-tag size="small">{{ modeLabel(project.segmentationMode || 'auto') }}</t-tag></p>
        <div class="mode-radio-group">
          <t-radio v-for="opt in modeOptions" :key="opt.value" :value="opt.value" :checked="segmentationMode === opt.value" :disabled="opt.disabled" name="segmentationMode" @change="segmentationMode = opt.value">
            {{ opt.label }}
          </t-radio>
        </div>
        <div v-if="segmentationMode === 'fixed'" class="fixed-interval-input">
          <label>间隔（秒）:</label>
          <t-input v-model="fixedInterval" type="number" :min="3" :max="15" style="width:80px;margin-left:8px" />
        </div>
        <div v-if="segmentationMode === 'custom'" class="fixed-interval-input">
          <label>自定义范围:</label>
          <t-input v-model="customRanges" placeholder="例: 0,5|6,10|11," style="width:260px;margin-left:8px;font-size:12px" />
          <p style="margin:4px 0 0 0;font-size:11px;color:var(--td-text-color-placeholder)">| 分隔段落，逗号分隔起止秒数，空到尾=到结束</p>
        </div>
        <p class="mode-hint">{{ modeHint }}</p>
      </div>
    </t-dialog>
  </div>
  <div v-else class="loading-state"><t-loading :loading="true" text="加载中..." /></div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useProjectStore, type Segment } from '../stores/project'
import { useGenerationStore } from '../stores/generation'
import { videoApi, segmentApi } from '../api'

const route = useRoute()
const router = useRouter()
const store = useProjectStore()
const genStore = useGenerationStore()
const projectId = computed(() => parseInt(route.params.id as string))
const project = computed(() => store.currentProject)
const segments = ref<Segment[]>([])
const segmentProgress = ref<Record<number, string>>({})
const selectedIds = ref(new Set<number>())
const selectAll = ref(false)

const showUploadDialog = ref(false)
const uploadFiles = ref<any[]>([])
const showGenProgress = ref(false)
const showVideoPreview = ref(false)
const previewUrl = ref('')
const videoRefs = ref<any[]>([])
const fileInput = ref<any>(null)
const selectedFileName = ref('')
const segmentationMode = ref('auto')
const fixedInterval = ref(10)
const customRanges = ref('0,5|6,10|11,')
const showResegmentDialog = ref(false)
const hasAudio = ref(true)

function onNativeFileSelect(e: any) {
  const file = e.target?.files?.[0]
  if (file) { uploadFiles.value = [{ raw: file, name: file.name }]; selectedFileName.value = file.name }
}
function onFileDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file?.type.startsWith('video/')) { uploadFiles.value = [{ raw: file, name: file.name }]; selectedFileName.value = file.name }
}

const showProcessing = ref(false)
const genRefreshKey = ref(0)
const processSteps = ref<Array<{key:string;label:string;active:boolean;done:boolean;percent:number}>>([])

function resetProcess(fbEnabled: boolean) {
  processSteps.value = [
    { key:'upload', label:'上传视频', active:false, done:false, percent:0 },
    { key:'analyze', label:'视频分析', active:false, done:false, percent:0 },
    { key:'segment', label:'视频分段', active:false, done:false, percent:0 },
    { key:'resolution', label:'像素检测', active:false, done:false, percent:0 },
  ]
  if (fbEnabled) {
    processSteps.value.push({ key:'faceblur', label:'人脸马赛克', active:false, done:false, percent:0 })
  }
}

async function handleVideoUpload() {
  const file = uploadFiles.value[0]?.raw
  if (!file) { MessagePlugin.warning('请先选择视频文件'); return }
  showUploadDialog.value = false
  showProcessing.value = true

  // Read face blur setting before processing
  let fbEnabled = false
  try {
    const r = await fetch('/api/setting/getSetting?key=faceBlurEnabled')
    const d = await r.json()
    fbEnabled = d.success && d.data?.faceBlurEnabled === 'true'
  } catch {}
  resetProcess(fbEnabled)
  processSteps.value[0].active = true
  processSteps.value[0].percent = 30

  try {
    // 1. Upload
    processSteps.value[0].percent = 70
    const formData = new FormData()
    formData.append('video', file)
    formData.append('projectId', projectId.value.toString())
    await videoApi.upload(formData)
    processSteps.value[0].percent = 100
    processSteps.value[0].done = true
    processSteps.value[0].active = false

    // 2. Analyze (progress via socket: video:progress)
    processSteps.value[1].active = true
    const analyzeResult = await videoApi.analyze(projectId.value)
    hasAudio.value = analyzeResult.data.data?.hasAudio !== false
    processSteps.value[1].done = true
    processSteps.value[1].active = false

    // 3. Segment with selected mode
    processSteps.value[2].active = true
    await videoApi.segment(projectId.value, segmentationMode.value, fixedInterval.value, customRanges.value)
    processSteps.value[2].done = true
    processSteps.value[2].active = false

    // Pipeline done via socket events
    const pipelineIdx = 3
    processSteps.value[pipelineIdx].done = true
    if (fbEnabled && processSteps.value.length > pipelineIdx + 1) {
      processSteps.value[pipelineIdx + 1].done = true
    }
    await loadSegments()
    await store.fetchProject(projectId.value)

    setTimeout(() => { showProcessing.value = false }, 1000)
    MessagePlugin.success('处理完成')
  } catch (err: any) {
    MessagePlugin.error('处理失败: ' + (err.message || err))
    showProcessing.value = false
  }
}

let socket: any = null

onMounted(async () => {
  await store.fetchProject(projectId.value)
  if (project.value) await loadSegments()
  connectSocket()
})

onUnmounted(() => { if (socket) { socket.disconnect(); socket = null } })

function connectSocket() {
  try {
    const { io } = require('socket.io-client')
    socket = io('/', { transports: ['websocket', 'polling'] })
    socket.on('connect', () => socket.emit('join:project', projectId.value))
    socket.on('generation:segment:imageCompleted', () => loadSegments())
    socket.on('generation:segment:videoCompleted', () => loadSegments())
    socket.on('generation:stitch:completed', (d: any) => genStore.setOutput(d.outputUrl))
    socket.on('generation:completed', () => genStore.setOutput(genStore.outputUrl || ''))
    socket.on('segment:progress', (d: any) => {
      if (d.done || d.error) setTimeout(() => loadSegments(), 500)
      if (d.error) { segmentProgress.value[d.segmentId] = '处理失败'; return }
      if (d.done) { delete segmentProgress.value[d.segmentId]; return }
      segmentProgress.value[d.segmentId] = d.message
    })
    socket.on('video:progress', (d: any) => {
      if (d.step === 'analyze') {
        processSteps.value[1].active = true
        processSteps.value[1].label = d.message
      }
      if (d.step === 'segment') {
        processSteps.value[2].label = d.message
      }
      if (d.step === 'pipeline') {
        // pipeline step is at index 3 (resolution), faceblur at index 4
        const idx = processSteps.value.findIndex(s => s.key === d.subStep || s.key === 'resolution')
        if (idx >= 0) {
          processSteps.value[idx].active = true
          processSteps.value[idx].label = d.message
        }
      }
    })
  } catch {}
}

async function loadSegments() {
  const res = await segmentApi.list(projectId.value)
  segments.value = res.data.data || []
}

function toggleSelect(id: number) {
  const s = new Set(selectedIds.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  selectedIds.value = s
  selectAll.value = s.size === segments.value.length
}

function toggleSelectAll() {
  if (selectedIds.value.size === segments.value.length) {
    selectedIds.value = new Set()
    selectAll.value = false
  } else {
    selectedIds.value = new Set(segments.value.map(s => s.id))
    selectAll.value = true
  }
}

async function handleResegment() {
  if (!segmentationMode.value) { MessagePlugin.warning('请选择分段方式'); return }
  showResegmentDialog.value = false
  showProcessing.value = true

  let fbEnabled = false
  try {
    const r = await fetch('/api/setting/getSetting?key=faceBlurEnabled')
    const d = await r.json()
    fbEnabled = d.success && d.data?.faceBlurEnabled === 'true'
  } catch {}
  resetProcess(fbEnabled)
  processSteps.value[2].active = true

  try {
    await videoApi.segment(projectId.value, segmentationMode.value, fixedInterval.value, customRanges.value)
    processSteps.value[2].done = true
    processSteps.value[2].active = false

    const pipelineIdx = 3
    processSteps.value[pipelineIdx].done = true
    if (fbEnabled && processSteps.value.length > pipelineIdx + 1) {
      processSteps.value[pipelineIdx + 1].done = true
    }
    await loadSegments()
    await store.fetchProject(projectId.value)

    setTimeout(() => { showProcessing.value = false }, 1000)
    MessagePlugin.success('重新分段完成')
  } catch (err: any) {
    MessagePlugin.error('分段失败: ' + (err.message || err))
    showProcessing.value = false
  }
}

async function importSelectedToCanvas() {
  if (selectedIds.value.size === 0) {
    MessagePlugin.warning('请先选择要导入的视频片段')
    return
  }
  const selected = segments.value.filter(s => selectedIds.value.has(s.id))
  const nodes = selected.map((seg, i) => ({
    id: `video-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'video',
    title: `片段 ${seg.sortOrder + 1}`,
    position: { x: 100 + (i % 3) * 480, y: 100 + Math.floor(i / 3) * 300 },
    width: 420,
    height: 236,
    metadata: {
      content: getSegmentClipUrl(seg),
      storageKey: '',
      status: 'success',
      mimeType: 'video/mp4',
      prompt: seg.prompt || '',
    },
  }))

  try {
    // If there's an existing canvas, navigate to import-bridge with canvasId to add nodes
    const bindRes = await fetch(`/api/import/bindings?projectId=${projectId.value}`)
    const bindData = await bindRes.json()
    const bindings = bindData.success && bindData.data ? bindData.data : []
    const existingCanvasId = bindings.length > 0 ? bindings[0].canvasId : ''

    const res = await fetch('/api/import/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes, connections: [] }),
    })
    const data = await res.json()
    if (data.success) {
      let path = 'import:' + data.data.token
      if (existingCanvasId) path += '&canvasId=' + existingCanvasId
      MessagePlugin.success(`已导入 ${nodes.length} 个素材到画布`)
      router.push('/canvas-proxy?path=' + encodeURIComponent(path) + '&projectId=' + projectId.value)
    } else {
      MessagePlugin.error('导入失败')
    }
  } catch (err: any) {
    MessagePlugin.error(`导入失败: ${err.message}`)
  }
}

async function exportFrame(seg: any, frameType: "first" | "last", source: string = "segment") {
  try {
    const res = await fetch('/api/video/extractFrame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: projectId.value, segmentId: seg.id, frameType, source }),
    })
    const data = await res.json()
    if (data.success && data.data.url) {
      const a = document.createElement('a')
      a.href = data.data.url
      a.download = `${source}_${seg.sortOrder + 1}_${frameType}.jpg`
      a.click()
    } else {
      MessagePlugin.error('导出失败')
    }
  } catch (err: any) {
    MessagePlugin.error(`导出失败: ${err.message}`)
  }
}

async function openCanvas(seg: any) {
  // Open the canvas associated with this project, or create one if needed
  try {
    const bindRes = await fetch(`/api/import/bindings?projectId=${projectId.value}`)
    const bindData = await bindRes.json()
    const bindings = bindData.success && bindData.data ? bindData.data : []
    const existingCanvasId = bindings.length > 0 ? bindings[0].canvasId : ''

    if (existingCanvasId) {
      router.push(`/canvas-proxy?path=${encodeURIComponent('/canvas/' + existingCanvasId)}`)
    } else {
      // No canvas yet, auto-select all and import
      MessagePlugin.info('还没有画布，正在创建...')
      selectedIds.value = new Set(segments.value.map(s => s.id))
      await importSelectedToCanvas()
    }
  } catch (err: any) {
    MessagePlugin.error(`打开画布失败: ${err.message}`)
  }
}

function getSegmentClipUrl(seg: Segment): string {
  return `${window.location.origin}/oss/project_${projectId.value}/segments/segment_${seg.sortOrder}.mp4?t=${seg.updateTime || Date.now()}`
}

function getGeneratedVideoUrl(seg: Segment): string {
  if (seg.videoGenPath) return `${window.location.origin}/oss/${seg.videoGenPath}`
  return ''
}

const genUploadRefs = ref<Record<number, any>>({})

function triggerGenUpload(seg: any) {
  if (!genUploadRefs.value[seg.id]) genUploadRefs.value[seg.id] = { click: () => {} }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'video/*'
  input.onchange = (e: any) => handleGenUpload(e, seg)
  input.click()
}

function handleGenDrop(e: DragEvent, seg: any) {
  const file = e.dataTransfer?.files?.[0]
  if (file?.type.startsWith('video/')) uploadVideoFile(file, seg)
}

function uploadVideoFile(file: File, seg: any) {
  const fd = new FormData()
  fd.append('video', file)
  fd.append('projectId', projectId.value.toString())
  fd.append('segmentId', seg.id.toString())
  fetch('/api/video/uploadGenerated', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(d => {
      if (d.success) {
        MessagePlugin.success('上传成功');
        genRefreshKey.value++;
        loadSegments();
      } else {
        MessagePlugin.error('上传失败');
      }
    })
    .catch(() => MessagePlugin.error('上传失败'))
}

async function handleGenUpload(e: any, seg: any) {
  const file = e.target?.files?.[0]
  if (file) uploadVideoFile(file, seg)
  e.target.value = ''
}

function previewVideo(seg: Segment) {
  previewUrl.value = getSegmentClipUrl(seg)
  showVideoPreview.value = true
}

function previewGeneratedVideo(seg: Segment) {
  if (seg.videoGenPath) {
    previewUrl.value = `${window.location.origin}/oss/${seg.videoGenPath}`
    showVideoPreview.value = true
  }
}

const getOriginalVideoUrl = computed(() => {
  if (!project.value?.videoFilePath) return ''
  return `${window.location.origin}/oss/${project.value.videoFilePath}`
})

function previewOriginalVideo() {
  previewUrl.value = getOriginalVideoUrl.value
  showVideoPreview.value = true
}

function statusTheme(s: string) { const m: Record<string,string>={ draft:'default', analyzing:'warning', ready:'success', generating:'warning', completed:'success', failed:'danger' }; return m[s]||'default' }
function statusLabel(s: string) { const m: Record<string,string>={ draft:'草稿', analyzing:'分析中', ready:'就绪', generating:'生成中', completed:'已完成', failed:'失败' }; return m[s]||s }
function formatTime(s: number) { const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}` }
function formatDuration(s: number) { const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}分${sec}秒` }
const modeLabels: Record<string, string> = { auto: '自动检测', scene: '场景切换', dialogue: '对话停顿', hybrid: '混合模式', fixed: '固定时长', custom: '自定义' }
const modeHints: Record<string, string> = { auto: '基于场景切换检测，每段最长 15 秒', scene: '纯场景切换分段，适合有频繁场景变化的视频（最长 15 秒）', dialogue: '检测人声停顿分段，适合对话/访谈类视频（最长 15 秒）', hybrid: '结合场景切换和对话停顿，适合有多种内容的视频（最长 15 秒）', fixed: '按固定时长切分，适合节奏均匀的视频（最长 15 秒）', custom: '按自定义范围切分' }
function modeLabel(m: string) { return modeLabels[m] || '自动检测' }
const modeHint = computed(() => modeHints[segmentationMode.value] || '')
const modeOptions = computed(() => [
  { value: 'auto', label: '自动检测（场景+15秒限制）', disabled: false },
  { value: 'scene', label: '场景切换', disabled: false },
  { value: 'dialogue', label: `对话停顿${hasAudio.value ? '' : '（无音频）'}`, disabled: !hasAudio.value },
  { value: 'hybrid', label: `混合模式${hasAudio.value ? '' : '（无音频）'}`, disabled: !hasAudio.value },
  { value: 'fixed', label: '固定时长', disabled: false },
  { value: 'custom', label: '自定义', disabled: false },
])
function genTheme(s: string) { switch(s) { case 'completed': return 'success'; case 'failed': return 'danger'; case 'generating': return 'warning'; default: return 'default' } }
function genLabel(s: string) { switch(s) { case 'completed': return '✅完成'; case 'failed': return '❌失败'; case 'generating': return '⏳中'; case 'queued': return '排队'; default: return '待处理' } }
function progressTheme(msg?: string) { if (!msg) return 'default'; if (msg.includes('失败')) return 'danger'; if (msg.includes('完成')) return 'success'; return 'warning' }
function genPercent(seg: Segment) { const st = ['queued','generating','completed']; const ii = st.indexOf(seg.imageGenState); const vi = st.indexOf(seg.videoGenState); if (vi===2) return 100; if (ii===2) return 50; if (ii===1) return 25; return 0 }
function genPercentLabel(seg: Segment) { if (seg.videoGenState==='completed') return '视频完成'; if (seg.imageGenState==='completed') return '图像完成'; if (seg.imageGenState==='generating') return '生成图像...'; return '等待' }
</script>

<style scoped>
.project-detail { padding: 24px; max-width: 1200px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.header-left h1 { font-size: 20px; font-weight: 600; }
.content-area { display: flex; flex-direction: column; gap: 24px; }
.info-card { width: 100%; }
.segment-section {  }
.segment-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.segment-toolbar h2 { font-size: 18px; font-weight: 600; }
.segment-toolbar-right { display: flex; align-items: center; gap: 12px; }
.selected-count { font-size: 12px; color: var(--td-text-color-placeholder); }
.segment-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.segment-card {
  background: #fff; border: 1px solid var(--td-border-level-1-color); border-radius: 8px;
  overflow: hidden; cursor: pointer; transition: all 0.2s; position: relative;
}
.segment-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.segment-card.selected { border-color: var(--td-brand-color); box-shadow: 0 0 0 2px rgba(0,100,255,0.12); }
.segment-check { position: absolute; top: 6px; left: 6px; z-index: 2; }
.segment-thumb { height: 130px; background: #f0f0f0; position: relative; overflow: hidden; }
.video-preview-row { display: flex; gap: 16px; align-items: flex-start; }
.video-preview-thumb {
  width: 200px; height: 120px; background: #f0f0f0; position: relative; overflow: hidden;
  border-radius: 6px; cursor: pointer; flex-shrink: 0;
}
.video-preview-thumb video { width: 100%; height: 100%; object-fit: cover; }
.video-preview-thumb:hover .play-overlay { opacity: 1; }
.segment-thumb video { width: 100%; height: 100%; object-fit: cover; }
.play-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.15); opacity: 0; transition: opacity 0.2s; cursor: pointer;
  color: #fff;
}
.segment-thumb:hover .play-overlay { opacity: 1; }
.segment-duration { position: absolute; bottom: 6px; left: 6px; background: rgba(0,0,0,0.6); color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; }
.gen-video-badge {
  position: absolute; bottom: 6px; right: 6px; background: var(--td-brand-color); color: #fff;
  font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 3px;
  z-index: 3; opacity: 0.9; transition: opacity 0.2s;
}
.gen-video-badge:hover { opacity: 1; }
.segment-info { padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.segment-title { font-weight: 600; font-size: 14px; }
.segment-meta { font-size: 12px; color: var(--td-text-color-placeholder); }
.segment-tags { display: flex; gap: 4px; }
.empty-state { text-align: center; padding: 80px 20px; color: var(--td-text-color-placeholder); }
.empty-state p { margin: 16px 0; }
.loading-state { display: flex; justify-content: center; align-items: center; height: 60vh; }
.gen-item { margin-bottom: 8px; }
.gen-item span { font-size: 13px; display: block; margin-bottom: 4px; }
.output-section { text-align: center; }
.segmentation-mode-selector { margin-top: 16px; padding: 12px; background: var(--td-bg-color-secondary); border-radius: 8px; }
.segmentation-mode-selector .mode-label { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
.segmentation-mode-selector .mode-radio-group { display: flex; flex-direction: column; gap: 10px; }
.segmentation-mode-selector .mode-hint { font-size: 12px; color: var(--td-text-color-placeholder); margin-top: 8px; }
.fixed-interval-input { display: flex; align-items: center; margin-top: 8px; margin-left: 24px; font-size: 13px; }
.upload-dropzone {
  border: 2px dashed var(--td-border-level-2-color); border-radius: 8px;
  padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.upload-dropzone:hover { border-color: var(--td-brand-color); background: var(--td-brand-color-light); }
.gen-replace {
  position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.5); color: #fff;
  font-size: 10px; padding: 1px 6px; border-radius: 3px; cursor: pointer; z-index: 4; opacity: 0.8;
}
.gen-replace:hover { opacity: 1; background: rgba(0,0,0,0.7); }
</style>
.gen-results-section { margin-top: 8px; }
.gen-upload-area { cursor: pointer; border: 2px dashed var(--td-border-level-2-color); background: var(--td-bg-color-secondary); box-sizing: border-box; }
.gen-upload-area:hover { border-color: var(--td-brand-color); background: var(--td-brand-color-light); }



.segment-tags { min-height: 0; }
