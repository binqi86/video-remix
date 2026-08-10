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
              <t-tag size="small">{{ modeLabel(project.segmentationMode || 'shot') }}</t-tag>
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
                <span class="segment-meta" style="display:flex;align-items:center;gap:6px">
                  <span v-if="seg.duration < 4" class="short-badge" title="生成最短 4 秒，建议与相邻片段合并">过短</span>
                  {{ seg.duration.toFixed(1) }}s
                </span>
              </div>
              <div style="margin-top:4px;font-size:11px;line-height:1.8">
                <span style="color:var(--td-brand-color);cursor:pointer" @click.stop="openCanvas(seg)">画布</span>
                <span style="margin-left:12px;color:var(--td-text-color-placeholder);cursor:pointer" @click.stop="exportFrame(seg,'first')">首帧</span>
                <span style="margin-left:12px;color:var(--td-text-color-placeholder);cursor:pointer" @click.stop="exportFrame(seg,'last')">尾帧</span>
                <span v-if="index < segments.length - 1 && !isGenerating && mergingId !== seg.id" style="margin-left:12px;color:var(--td-brand-color);cursor:pointer" @click.stop="mergeSegment(seg, segments[index + 1])">{{ mergingId === seg.id ? '合并中...' : '与下段合并' }}</span>
                <span v-if="seg.splitPoints && seg.splitPoints.length > 0 && !isGenerating" style="margin-left:12px;color:var(--td-brand-color);cursor:pointer" @click.stop="splitSegment(seg)">{{ splittingId === seg.id ? '拆分中...' : '拆分' }}</span>
              </div>
              <!-- 对话音频（按说话顺序添加，导入画布时自动带音频与绑定提示词） -->
              <div v-if="seg.speechAudios && seg.speechAudios.length" class="segment-audios">
                <div v-for="(au, ai) in seg.speechAudios" :key="au.path" class="audio-chip">
                  <span class="audio-num">{{ ['①','②','③'][ai] ?? ai + 1 }}</span>
                  <t-icon name="sound" size="14px" class="audio-play" @click.stop="playSpeechAudio(au)" />
                  <span class="audio-name" :title="au.fileName">{{ au.fileName }}</span>
                  <span class="audio-dur">{{ (au.durationMs / 1000).toFixed(1) }}s</span>
                  <span v-if="!isGenerating" class="audio-op" title="前移" @click.stop="reorderSpeech(seg, ai, ai - 1)">↑</span>
                  <span v-if="!isGenerating" class="audio-op" title="后移" @click.stop="reorderSpeech(seg, ai, ai + 1)">↓</span>
                  <span v-if="!isGenerating" class="audio-op audio-del" title="移除" @click.stop="removeSpeech(seg, ai)">✕</span>
                </div>
              </div>
              <div v-if="!isGenerating" class="segment-audio-add">
                <input type="file" accept="audio/*" style="display:none" :ref="(el) => audioInputRefs[seg.id] = el as HTMLInputElement | null" @change="onSpeechAudioChange(seg, $event)" />
                <span class="audio-add-btn" @click.stop="openAudioPicker(seg)"><t-icon name="plus" size="12px" /> 添加对话音频（{{ (seg.speechAudios || []).length }}/3）</span>
              </div>
            </div>
            <!-- Generated video section removed to separate grid below -->
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
        <div v-if="segmentationMode === 'custom'" class="fixed-interval-input">
          <label>自定义范围:</label>
          <t-input v-model="customRanges" placeholder="例: 0,5|6,10|11," style="width:260px;margin-left:8px;font-size:12px" />
          <p style="margin:4px 0 0 0;font-size:11px;color:var(--td-text-color-placeholder)">| 分隔段落，逗号分隔起止秒数，空到尾=到结束</p>
        </div>
        <p class="mode-hint">{{ modeHint }}</p>
      </div>
    </t-dialog>

    <!-- 导入画布配置弹窗 -->
    <t-dialog v-model:visible="showImportConfigDialog" header="导入到画布 — 替换配置"
      :confirm-btn="{ content: '导入并打开画布', theme: 'primary', loading: importLoading }"
      @confirm="handleImportConfirm"
      :close-on-overlay-click="false"
    >
      <p style="margin-bottom:12px;font-size:13px;color:var(--td-text-color-placeholder)">
        已选 {{ selectedIds.size }} 个片段。选好替换场景、上传角色图/背景图、加对话音频，提示词会自动生成。
      </p>
      <t-form :data="importConfig" label-align="top" layout="vertical">
        <t-form-item label="替换场景" name="scenario">
          <div class="scenario-grid">
            <div v-for="opt in scenarioOptions" :key="opt.value" class="scenario-option" :class="{ active: importConfig.scenario === opt.value }" @click="selectScenario(opt.value)">
              <div class="scenario-name">{{ opt.label }}</div>
              <div class="scenario-desc">{{ opt.desc }}</div>
            </div>
          </div>
        </t-form-item>
        <t-form-item v-if="importConfig.scenario !== 'scene'" label="替换角色数量" name="characterCount">
          <t-input-number v-model="importConfig.characterCount" :min="1" :max="10" style="width:120px" />
          <span class="config-hint">每个片段生成对应数量的角色图空位</span>
        </t-form-item>
        <t-form-item label="替换背景" name="replaceBackground">
          <t-switch v-model="importConfig.replaceBackground" />
          <span class="config-hint">每个片段生成一个背景参考图空位</span>
        </t-form-item>
        <t-form-item label="自动提示词（可微调）" name="promptOverride">
          <div class="prompt-preview">
            <textarea v-model="importConfig.promptOverride" rows="6" class="prompt-textarea"></textarea>
            <div class="prompt-actions">
              <span class="prompt-advice">有对话音频的片段会自动追加「音频N 对应说话人 + 口型同步」绑定提示词</span>
              <t-button size="small" variant="outline" @click="importConfig.promptOverride = autoPrompt">重置为推荐</t-button>
            </div>
          </div>
        </t-form-item>
      </t-form>
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

    <!-- Video Preview Dialog -->
    <t-dialog v-model:visible="showVideoPreview" header="视频预览" width="800px" :footer="false" :close-btn="true" destroy-on-close>
      <video v-if="previewUrl" :src="previewUrl" controls autoplay style="width:100%; max-height:70vh" />
    </t-dialog>

    <!-- Re-segment Dialog -->
    <t-dialog v-model:visible="showResegmentDialog" header="选择分段方式"
      :confirm-btn="{ content: '开始重新分段', theme: 'primary' }"
      @confirm="handleResegment">
      <div class="segmentation-mode-selector">
        <p class="mode-label">当前分段方式: <t-tag size="small">{{ modeLabel(project.segmentationMode || 'shot') }}</t-tag></p>
        <div class="mode-radio-group">
          <t-radio v-for="opt in modeOptions" :key="opt.value" :value="opt.value" :checked="segmentationMode === opt.value" :disabled="opt.disabled" name="segmentationMode" @change="segmentationMode = opt.value">
            {{ opt.label }}
          </t-radio>
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
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
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
const showVideoPreview = ref(false)
const previewUrl = ref('')
const videoRefs = ref<any[]>([])
const fileInput = ref<any>(null)
const selectedFileName = ref('')
const segmentationMode = ref('shot')
const customRanges = ref('0,5|6,10|11,')
const showResegmentDialog = ref(false)

// 导入画布配置
const showImportConfigDialog = ref(false)
const importLoading = ref(false)
const importConfig = reactive({
  scenario: 'characters',
  characterCount: 2,
  replaceBackground: false,
  promptOverride: '',
})

const scenarioOptions = [
  { value: 'characters', label: '人物替换', desc: '替换人物，动作/运镜不变' },
  { value: 'scene', label: '场景替换', desc: '只换背景场景' },
  { value: 'both', label: '人物+场景', desc: '人物与背景一起替换' },
  { value: 'dialogue', label: '对话替换', desc: '同步对话音频与口型' },
]

function buildPrompt(scenario: string, characterCount: number, replaceBackground: boolean): string {
  const sections: string[] = []
  if (scenario === 'scene') {
    sections.push('保持原视频的人物、动作、运镜、构图不变，不做人物替换。')
  } else {
    const charList: string[] = []
    for (let ci = 0; ci < characterCount; ci++) {
      charList.push(`人物${ci + 1} → 替换为【在此 @ 引用角色${ci + 1}图片】`)
    }
    sections.push('将【在此 @ 引用原视频】画面中的人物按站位顺序替换为指定角色，动作、运镜、画面构图保持原样不变：')
    sections.push(charList.join('\n'))
    sections.push('所有替换角色容貌、发型、服饰、妆容全程保持稳定一致，不漂移、不变形。')
  }
  if (replaceBackground) {
    sections.push('将画面背景替换为指定场景，空间透视、光线方向、地面纵深与参考图一致，人物与动作保持不变：')
    sections.push('背景 → 【在此 @ 引用背景参考图】')
  }
  if (scenario === 'dialogue') {
    sections.push('人物对话音频按说话顺序编号（音频1、音频2、音频3…），说话口型与对应音频严格同步，内容、语气、情绪与音频一致：')
    sections.push('对话1 → 【在此 @ 引用音频1】')
    sections.push('对话2 → 【在此 @ 引用音频2】')
  }
  sections.push('画质要求：画面清晰流畅，无卡顿、无闪烁、无撕裂变形，整体光影、色调统一协调。')
  sections.push('禁止：肢体畸形、穿模穿插、手脚畸变、人物样貌漂移、五官崩坏、背景残留、场景碎片、模糊噪点、水印文字、多余杂物路人、光影突变、色彩失真。')
  return sections.join('\n')
}

const autoPrompt = computed(() => buildPrompt(importConfig.scenario, importConfig.characterCount, importConfig.replaceBackground))

function selectScenario(value: string) {
  importConfig.scenario = value
  if (value === 'characters') { importConfig.characterCount = 2; importConfig.replaceBackground = false }
  else if (value === 'scene') { importConfig.characterCount = 0; importConfig.replaceBackground = true }
  else if (value === 'both') { importConfig.characterCount = 2; importConfig.replaceBackground = true }
  else if (value === 'dialogue') { importConfig.characterCount = 1; importConfig.replaceBackground = true }
  importConfig.promptOverride = buildPrompt(value, importConfig.characterCount, importConfig.replaceBackground)
}

// 角色数量 / 背景开关变化时同步刷新自动提示词，避免导入到画布的提示词仍是旧配置
watch(
  () => [importConfig.characterCount, importConfig.replaceBackground],
  () => {
    importConfig.promptOverride = autoPrompt.value
  }
)

function onNativeFileSelect(e: any) {
  const file = e.target?.files?.[0]
  if (file) { uploadFiles.value = [{ raw: file, name: file.name }]; selectedFileName.value = file.name }
}
function onFileDrop(e: DragEvent) {
  const file = e.dataTransfer?.files?.[0]
  if (file?.type.startsWith('video/')) { uploadFiles.value = [{ raw: file, name: file.name }]; selectedFileName.value = file.name }
}

const showProcessing = ref(false)
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
    processSteps.value[1].done = true
    processSteps.value[1].active = false

    // 3. Segment with selected mode
    processSteps.value[2].active = true
    await videoApi.segment(projectId.value, segmentationMode.value, customRanges.value)
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

const mergingId = ref<number | null>(null)
const splittingId = ref<number | null>(null)
const isGenerating = computed(() =>
  project.value?.status === 'generating' ||
  segments.value.some(s => s.imageGenState === 'generating' || s.videoGenState === 'generating')
)

async function mergeSegment(seg: Segment, next: Segment) {
  if (isGenerating.value) { MessagePlugin.warning('生成进行中，无法合并'); return }
  mergingId.value = seg.id
  try {
    await segmentApi.merge(projectId.value, [seg.id, next.id])
    MessagePlugin.success('合并成功')
    await loadSegments()
    await store.fetchProject(projectId.value)
  } catch (e: any) {
    MessagePlugin.error('合并失败: ' + (e?.response?.data?.message || e.message))
  } finally {
    mergingId.value = null
  }
}

async function splitSegment(seg: Segment) {
  if (isGenerating.value) { MessagePlugin.warning('生成进行中，无法拆分'); return }
  splittingId.value = seg.id
  try {
    await segmentApi.split(projectId.value, seg.id)
    MessagePlugin.success('拆分成功')
    await loadSegments()
    await store.fetchProject(projectId.value)
  } catch (e: any) {
    MessagePlugin.error('拆分失败: ' + (e?.response?.data?.message || e.message))
  } finally {
    splittingId.value = null
  }
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
    await videoApi.segment(projectId.value, segmentationMode.value, customRanges.value)
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
  // 初始化提示词预览为当前场景的推荐提示词
  importConfig.promptOverride = autoPrompt.value
  // 显示配置弹窗
  showImportConfigDialog.value = true
}

async function handleImportConfirm() {
  importLoading.value = true
  try {
    const selected = segments.value.filter(s => selectedIds.value.has(s.id))
    const nodes: any[] = []
    const connections: any[] = []
    let connIndex = 0
    let firstPromptTemplate = ''

    // 为每个选中的片段创建节点和连线，从上到下依次排列
    const CHAR_COL_WIDTH = 220  // 每列宽度
    const CHAR_ROW_HEIGHT = 130 // 每行高度
    const charsPerCol = Math.max(1, Math.min(importConfig.characterCount || 1, 4)) // 每列最多4个
    const charGridHeight = charsPerCol * CHAR_ROW_HEIGHT  // 角色网格高度
    const maxAudioRows = Math.max(0, ...selected.map((s: any) => (s.speechAudios || []).length))
    const segmentHeight = Math.max(280, charGridHeight + 50) + maxAudioRows * 52  // 每个片段占高（含对话音频行）
    selected.forEach((seg, i) => {
      const label = `片段 ${seg.sortOrder + 1}`
      const videoUrl = getSegmentClipUrl(seg)
      const audios = seg.speechAudios || []
      const baseY = 100 + i * segmentHeight
      const baseX = 100

      // 视频节点
      const videoId = `video-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
      const imageNodeIds: string[] = []
      nodes.push({
        id: videoId,
        type: 'video',
        title: label,
        position: { x: baseX, y: baseY },
        width: 420,
        height: 236,
        metadata: {
          content: videoUrl,
          storageKey: '',
          status: 'success',
          mimeType: 'video/mp4',
          prompt: seg.prompt || '',
        },
      })

      // 角色占位图节点（不连视频，待会统一连向配置节点）
      for (let ci = 0; ci < importConfig.characterCount; ci++) {
        const charId = `char-${Date.now()}-${i}-${ci}-${Math.random().toString(36).slice(2, 7)}`
        const col = Math.floor(ci / charsPerCol)
        const row = ci % charsPerCol
        nodes.push({
          id: charId,
          type: 'image',
          title: `角色${ci + 1} - ${label}`,
          position: { x: baseX + 440 + col * CHAR_COL_WIDTH, y: baseY + row * CHAR_ROW_HEIGHT },
          width: 200,
          height: 110,
          metadata: {
            content: '',
            storageKey: '',
            status: 'empty',
            mimeType: 'image/png',
            prompt: `角色${ci + 1}占位 - 请替换为角色图片`,
          },
        })
        imageNodeIds.push(charId)
      }

      // 背景参考图节点（如果开启）
      if (importConfig.replaceBackground) {
        const bgId = `bg-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
        const bgCol = Math.floor(importConfig.characterCount / charsPerCol)
        const bgRow = importConfig.characterCount % charsPerCol
        nodes.push({
          id: bgId,
          type: 'image',
          title: `背景参考 - ${label}`,
          position: { x: baseX + 440 + bgCol * CHAR_COL_WIDTH, y: baseY + bgRow * CHAR_ROW_HEIGHT + 10 },
          width: 200,
          height: 110,
          metadata: {
            content: '',
            storageKey: '',
            status: 'empty',
            mimeType: 'image/png',
            prompt: '背景参考占位 - 请替换为背景图',
          },
        })
        imageNodeIds.push(bgId)
      }

      // 对话音频节点（按上传顺序，导入后画布自动编号 音频1/2/3）
      const audioNodeIds: string[] = []
      audios.forEach((au: any, k: number) => {
        const audioId = `audio-${Date.now()}-${i}-${k}-${Math.random().toString(36).slice(2, 7)}`
        nodes.push({
          id: audioId,
          type: 'audio',
          title: `对话音频${k + 1} - ${label}`,
          position: { x: baseX, y: baseY + 248 + k * 50 },
          width: 210,
          height: 44,
          metadata: {
            content: `${window.location.origin}/oss/${au.path}`,
            storageKey: '',
            status: 'success',
            mimeType: 'audio/mpeg',
            durationMs: au.durationMs,
          },
        })
        audioNodeIds.push(audioId)
      })

      // 生成配置节点（所有节点都连向它，因为配置节点里有生成按钮）
      const configId = `config-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
      // 计算所有图片占用的总列数（角色列 + 可能单独占一列的背景图）
      const charCols = Math.ceil(importConfig.characterCount / charsPerCol)
      const bgCol = Math.floor(importConfig.characterCount / charsPerCol)
      const totalImgCols = importConfig.replaceBackground ? Math.max(charCols, bgCol + 1) : charCols
      const configX = baseX + 440 + totalImgCols * CHAR_COL_WIDTH + 40
      const configY = baseY + 20

      // 生成提示词：场景预设基础 + 对话音频绑定
      let prompt = (importConfig.promptOverride || autoPrompt.value).trim()
      if (audios.length > 0) {
        const audioLabels = audios.map((_: any, k: number) => `音频${k + 1}`).join('、')
        prompt += `\n\n本片段包含 ${audios.length} 段对话音频，按说话顺序：${audioLabels}。各音频由对应说话人说出口型与音频严格同步，语气情绪与音频保持一致。`
      }
      if (i === 0) firstPromptTemplate = prompt
      nodes.push({
        id: configId,
        type: 'config',
        title: `生成配置 - ${label}`,
        position: { x: configX, y: configY },
        width: 340,
        height: 240,
        metadata: {
          model: '',
          size: '1024x1024',
          count: 1,
          prompt: prompt,
          status: 'idle',
          generationMode: 'image',
        },
      })
      // 视频节点 → 配置节点
      connections.push({
        id: `conn-${Date.now()}-${connIndex++}`,
        fromNodeId: videoId,
        toNodeId: configId,
      })
      // 每个图片节点 → 配置节点
      imageNodeIds.forEach((imgId) => {
        connections.push({
          id: `conn-${Date.now()}-${connIndex++}`,
          fromNodeId: imgId,
          toNodeId: configId,
        })
      })
      // 每个音频节点 → 配置节点（按说话顺序，顺序即画布编号）
      audioNodeIds.forEach((aid) => {
        connections.push({
          id: `conn-${Date.now()}-${connIndex++}`,
          fromNodeId: aid,
          toNodeId: configId,
        })
      })
    })

    // 通过 import-bridge 导入
    const res = await fetch('/api/import/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes, connections }),
    })
    const data = await res.json()
    if (data.success) {
      showImportConfigDialog.value = false
      MessagePlugin.success(`已导入 ${nodes.length} 个素材到画布`)
      // 保存工作流配置到项目
      await fetch('/api/project/editProject', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: projectId.value,
          workflowConfig: {
            scenario: importConfig.scenario,
            characterCount: importConfig.characterCount,
            replaceBackground: importConfig.replaceBackground,
            promptTemplate: firstPromptTemplate,
            promptOverride: importConfig.promptOverride,
          },
        }),
      })
      // 检查是否有已有画布绑定，有则传入 canvasId 以复用
      let canvasParam = ''
      try {
        const bindRes = await fetch(`/api/import/bindings?projectId=${projectId.value}`)
        const bindData = await bindRes.json()
        const bindings = bindData.success && bindData.data ? bindData.data : []
        if (bindings.length > 0) {
          canvasParam = '&canvasId=' + encodeURIComponent(bindings[0].canvasId)
        }
      } catch {}
      router.push('/canvas-proxy?path=' + encodeURIComponent('import:' + data.data.token) + '&projectId=' + projectId.value + canvasParam)
    } else {
      MessagePlugin.error('导入失败')
    }
  } catch (err: any) {
    MessagePlugin.error(`导入失败: ${err.message}`)
  } finally {
    importLoading.value = false
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

const audioInputRefs = ref<Record<number, HTMLInputElement | null>>({})

function openAudioPicker(seg: Segment) {
  audioInputRefs.value[seg.id]?.click()
}

async function onSpeechAudioChange(seg: Segment, e: any) {
  const file = e.target?.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('audio/')) { MessagePlugin.warning('请上传音频文件'); return }
  const fd = new FormData()
  fd.append('audio', file)
  fd.append('projectId', projectId.value.toString())
  fd.append('segmentId', seg.id.toString())
  try {
    const res = await segmentApi.uploadSpeechAudio(fd)
    MessagePlugin.success('音频已添加')
    await loadSegments()
  } catch (err: any) {
    MessagePlugin.error(err?.response?.data?.message || '上传失败')
  }
}

function playSpeechAudio(au: any) {
  const a = new Audio(`${window.location.origin}/oss/${au.path}`)
  a.play().catch(() => {})
}

async function removeSpeech(seg: Segment, index: number) {
  try {
    await segmentApi.removeSpeechAudio(projectId.value, seg.id, index)
    MessagePlugin.success('已移除')
    await loadSegments()
  } catch (err: any) {
    MessagePlugin.error(err?.response?.data?.message || '移除失败')
  }
}

async function reorderSpeech(seg: Segment, from: number, to: number) {
  if (to < 0 || to >= (seg.speechAudios?.length || 0) || from === to) return
  try {
    await segmentApi.reorderSpeechAudio(projectId.value, seg.id, from, to)
    await loadSegments()
  } catch (err: any) {
    MessagePlugin.error(err?.response?.data?.message || '排序失败')
  }
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
const modeLabels: Record<string, string> = { shot: '镜头', custom: '自定义' }
const modeHints: Record<string, string> = { shot: '基于镜头切换检测，每个镜头一段（可手动合并/拆分）', custom: '按自定义范围切分' }
function modeLabel(m: string) { return modeLabels[m] || '镜头' }
const modeHint = computed(() => modeHints[segmentationMode.value] || '')
const modeOptions = computed(() => [
  { value: 'shot', label: '镜头', disabled: false },
  { value: 'custom', label: '自定义', disabled: false },
])
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

/* 短段徽标 */
.short-badge {
  background: rgba(245,158,11,0.16); color: #D97706; border: 1px solid rgba(245,158,11,0.35);
  font-size: 10px; line-height: 1; padding: 2px 5px; border-radius: 4px; cursor: help;
}
/* 对话音频芯片 */
.segment-audios { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.audio-chip {
  display: flex; align-items: center; gap: 6px; font-size: 11px;
  background: rgba(236,72,153,0.08); border: 1px solid rgba(236,72,153,0.25);
  border-radius: 8px; padding: 3px 8px; color: var(--td-text-color-primary);
}
.audio-num { font-size: 11px; color: var(--td-brand-color); font-weight: 600; }
.audio-play { color: var(--td-brand-color); cursor: pointer; flex-shrink: 0; }
.audio-play:hover { transform: scale(1.15); }
.audio-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--td-text-color-primary); }
.audio-dur { color: var(--td-text-color-placeholder); flex-shrink: 0; }
.audio-op { cursor: pointer; color: var(--td-text-color-placeholder); padding: 0 1px; font-size: 12px; flex-shrink: 0; }
.audio-op:hover { color: var(--td-brand-color); }
.audio-del:hover { color: var(--td-error-color); }
.segment-audio-add { margin-top: 6px; }
.audio-add-btn {
  display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
  color: var(--td-brand-color); font-size: 12px; padding: 3px 10px;
  border: 1px dashed var(--td-brand-color); border-radius: 8px; opacity: 0.9; transition: all 0.2s;
}
.audio-add-btn:hover { background: var(--td-brand-color-light); opacity: 1; }
/* 导入配置：场景预设 + 提示词预览 */
.scenario-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; width: 100%; }
.scenario-option {
  border: 1px solid var(--td-border-level-2-color); border-radius: 8px; padding: 8px 10px;
  cursor: pointer; transition: all 0.2s; background: var(--td-bg-color-container);
}
.scenario-option:hover { border-color: var(--td-brand-color); }
.scenario-option.active { border-color: var(--td-brand-color); background: var(--td-brand-color-light); box-shadow: 0 0 0 1px var(--td-brand-color) inset; }
.scenario-name { font-weight: 600; font-size: 13px; color: var(--td-text-color-primary); }
.scenario-desc { font-size: 11px; color: var(--td-text-color-placeholder); margin-top: 2px; line-height: 1.4; }
.prompt-preview { width: 100%; }
.prompt-textarea {
  width: 100%; min-height: 130px; resize: vertical; box-sizing: border-box;
  border: 1px solid var(--td-border-level-2-color); border-radius: 8px; padding: 8px 10px;
  font-size: 12px; line-height: 1.6; font-family: inherit; color: var(--td-text-color-primary);
  background: var(--td-bg-color-container);
}
.prompt-textarea:focus { outline: none; border-color: var(--td-brand-color); }
.prompt-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.prompt-advice { font-size: 11px; color: var(--td-text-color-placeholder); }
</style>
.gen-results-section { margin-top: 8px; }
.gen-upload-area { cursor: pointer; border: 2px dashed var(--td-border-level-2-color); background: var(--td-bg-color-secondary); box-sizing: border-box; }
.gen-upload-area:hover { border-color: var(--td-brand-color); background: var(--td-brand-color-light); }

.config-hint { font-size: 12px; color: var(--td-text-color-placeholder); display: block; margin-top: 4px; }



.segment-tags { min-height: 0; }
