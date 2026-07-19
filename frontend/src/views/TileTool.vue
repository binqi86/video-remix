<template>
  <div class="tool-page">
    <div class="tool-header">
      <h1>拼图工具</h1>
      <p class="desc">将多张正面照拼合成一张图片，统一间距，不裁剪人物</p>
    </div>

    <div class="tool-body">
      <!-- Upload area -->
      <div class="upload-area" @drop.prevent="onDrop" @dragover.prevent>
        <input ref="fileInput" type="file" multiple accept="image/*" style="display:none" @change="onFileSelect" />
        <div class="upload-hint" @click="$refs.fileInput.click()">
          <t-icon name="upload" size="32px" style="color:var(--td-brand-color)" />
          <p>拖拽图片到此处，或点击选择</p>
          <p class="sub">支持 jpg / png / webp，建议使用已裁好的正面全身照</p>
        </div>
      </div>

      <!-- Selected files -->
      <div v-if="files.length > 0" class="file-list">
        <div v-for="(f, i) in files" :key="i" class="file-item">
          <img :src="f.url" class="file-thumb" />
          <span class="file-name">{{ f.file.name }}</span>
          <t-button variant="text" theme="danger" size="small" @click="removeFile(i)">移除</t-button>
        </div>
        <t-button size="small" variant="outline" @click="$refs.fileInput.click()" style="margin-top:8px">+ 添加更多</t-button>
      </div>

      <!-- Tile button -->
      <div v-if="files.length >= 2" style="margin-top:16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:13px;white-space:nowrap">每行:</span>
        <t-radio-group v-model="tileCols">
          <t-radio-button :value="files.length">1 行</t-radio-button>
          <t-radio-button :value="2">2 列</t-radio-button>
          <t-radio-button :value="3">3 列</t-radio-button>
          <t-radio-button :value="4">4 列</t-radio-button>
        </t-radio-group>
        <t-button theme="primary" :loading="loading" @click="doTile">拼图 ({{ files.length }} 张)</t-button>
      </div>

      <!-- Result -->
      <div v-if="resultUrl" class="result-section">
        <t-divider />
        <h3>拼图结果</h3>
        <img :src="resultUrl" class="result-img" />
        <div style="margin-top:8px">
          <t-button @click="downloadResult">下载图片</t-button>
          <t-button variant="outline" @click="reset" style="margin-left:8px">重新开始</t-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

const fileInput = ref<any>(null)
const files = ref<Array<{ file: File; url: string }>>([])
const loading = ref(false)
const resultUrl = ref('')
const tileCols = ref(4)

function onDrop(e: DragEvent) {
  const items = Array.from(e.dataTransfer?.files || [])
  addFiles(items)
}

function onFileSelect(e: any) {
  addFiles(Array.from(e.target?.files || []))
  e.target.value = ''
}

function addFiles(newFiles: File[]) {
  for (const f of newFiles) {
    if (!f.type.startsWith('image/')) continue
    if (files.value.some(x => x.file.name === f.name && x.file.size === f.size)) continue
    files.value.push({ file: f, url: URL.createObjectURL(f) })
  }
}

function removeFile(i: number) {
  URL.revokeObjectURL(files.value[i].url)
  files.value.splice(i, 1)
}

async function doTile() {
  if (files.value.length < 2) { MessagePlugin.warning('至少 2 张图片'); return }
  loading.value = true
  const fd = new FormData()
  for (const f of files.value) fd.append('images', f.file)
  fd.append('cols', tileCols.value.toString())
  try {
    const r = await fetch('/api/tools/tile', { method: 'POST', body: fd })
    const d = await r.json()
    if (d.success) {
      resultUrl.value = d.data.url
      MessagePlugin.success(`拼图完成: ${d.data.width}x${d.data.height}`)
    } else {
      MessagePlugin.error(d.message || '拼图失败')
    }
  } catch (e: any) {
    MessagePlugin.error('拼图失败: ' + e.message)
  }
  loading.value = false
}

function downloadResult() {
  const a = document.createElement('a')
  a.href = resultUrl.value
  a.download = 'tiled.jpg'
  a.click()
}

function reset() {
  files.value.forEach(f => URL.revokeObjectURL(f.url))
  files.value = []
  resultUrl.value = ''
}
</script>

<style scoped>
.tool-page { padding: 24px; max-width: 800px; margin: 0 auto; }
.tool-header h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
.desc { color: var(--td-text-color-placeholder); font-size: 13px; margin-top: 0; }
.tool-body { margin-top: 24px; }
.upload-area { border: 2px dashed var(--td-border-level-2-color); border-radius: 8px; padding: 40px; text-align: center; cursor: pointer; transition: all 0.2s; }
.upload-area:hover { border-color: var(--td-brand-color); background: var(--td-brand-color-light); }
.upload-hint { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.upload-hint p { margin: 0; font-size: 14px; color: var(--td-text-color-primary); }
.upload-hint .sub { font-size: 12px; color: var(--td-text-color-placeholder); }
.file-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.file-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--td-bg-color-secondary); border-radius: 6px; }
.file-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 4px; }
.file-name { font-size: 12px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-section { margin-top: 16px; }
.result-img { max-width: 100%; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
</style>
