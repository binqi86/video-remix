<template>
  <div class="settings-page">
    <div class="settings-sidebar">
      <div class="nav-list">
        <div class="nav-item" :class="{ active: activeTab === 'suppliers' }" @click="activeTab = 'suppliers'">
          <t-icon name="setting" size="18px" /> 供应商管理
        </div>
        <div class="nav-item" :class="{ active: activeTab === 'tunnel' }" @click="activeTab = 'tunnel'">
          <t-icon name="link" size="18px" /> 网络隧道
        </div>
        <div class="nav-item" :class="{ active: activeTab === 'port' }" @click="activeTab = 'port'">
          <t-icon name="layers" size="18px" /> 端口设置
        </div>
        <div class="nav-item" :class="{ active: activeTab === 'video' }" @click="activeTab = 'video'">
          <t-icon name="video" size="18px" /> 视频处理
        </div>
        <div class="nav-item" :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">
          <t-icon name="info-circle" size="18px" /> 关于
        </div>
      </div>
    </div>

    <div class="settings-content">
      <!-- 供应商管理 -->
      <div v-if="activeTab === 'suppliers'" class="supplier-page">
        <div class="supplier-list-panel">
          <div class="panel-header">
            <h3>供应商</h3>
            <t-button size="small" @click="addSupplier">+ 添加</t-button>
          </div>
          <div class="supplier-list">
            <div
              v-for="s in suppliers"
              :key="s.id"
              class="supplier-item"
              :class="{ active: selectedSupplier?.id === s.id }"
              @click="selectSupplier(s)"
            >
              <div>
                <div class="supplier-name">{{ s.name || '未命名' }}</div>
              </div>
              <t-switch :model-value="s.enabled" size="small" @click.stop @change="toggleSupplier(s)" />
            </div>
            <div v-if="suppliers.length === 0" class="empty-hint">暂无供应商，点击"添加"创建</div>
          </div>
        </div>

        <div class="supplier-form-panel" v-if="selectedSupplier">
          <div class="form-header">
            <h3>供应商配置</h3>
            <t-button size="small" theme="danger" variant="outline" @click="deleteSupplier">删除</t-button>
          </div>

          <t-form :data="selectedSupplier" label-align="top" layout="vertical">
            <div class="form-row">
              <t-form-item label="名称">
                <t-input v-model="selectedSupplier.name" placeholder="例如: ApiMart" />
              </t-form-item>
            </div>

            <t-form-item label="API 地址">
              <t-input v-model="selectedSupplier.baseUrl" placeholder="https://api.aishuch.com/v1" />
              <p class="hint">真实 API 地址，代理将转发到此地址</p>
            </t-form-item>

            <t-form-item label="API Key">
              <t-input v-model="selectedSupplier.apiKey" type="password" placeholder="sk-..." />
              <p class="hint">画布那边的 API Key 可以随便填，以这里配置的为准</p>
            </t-form-item>

            <t-form-item label="隧道">
              <t-switch v-model="selectedSupplier.tunnelEnabled" />
              <span class="hint">需要在左侧「网络隧道」中也启用才能生效</span>
            </t-form-item>

            <t-form-item label="异步轮询超时（秒）">
              <t-input v-model.number="selectedSupplier.pollTimeout" type="number" placeholder="1800" />
              <p class="hint">API 异步任务最长等待时间，默认 1800 秒（30 分钟）</p>
            </t-form-item>

            <t-divider />

            <t-form-item label="端点映射">
              <p class="hint">将不支持的 API 路径映射到支持的路径。例如 edits → generations</p>
              <table class="mapping-table" v-if="selectedSupplier.endpointMappings?.length">
                <tr v-for="(em, ei) in selectedSupplier.endpointMappings" :key="ei">
                  <td><t-input v-model="em.from" placeholder="来源路径" size="small" /></td>
                  <td class="map-arrow">→</td>
                  <td><t-input v-model="em.to" placeholder="目标路径" size="small" /></td>
                  <td><t-button variant="text" theme="danger" size="small" @click="removeMapping(ei)">删除</t-button></td>
                </tr>
              </table>
              <div style="margin-top:8px"><t-button size="small" variant="outline" @click="addMapping">+ 添加映射</t-button></div>
            </t-form-item>
          </t-form>

          <div class="form-actions">
            <t-button theme="primary" @click="saveSuppliers">保存供应商</t-button>
          </div>
        </div>
        <div v-else class="form-empty">
          <p>选择一个供应商查看和编辑配置</p>
        </div>
      </div>

      <!-- 网络隧道 -->
      <div v-if="activeTab === 'tunnel'" class="settings-section">
        <h2>网络隧道</h2>
        <p class="desc">用于将本地文件暴露到公网，供 AI 模型访问。供应商开启了隧道时此项必须启用。</p>
        <t-form :data="tunnelConfig" label-align="top">
          <t-form-item label="隧道类型">
            <t-radio-group v-model="tunnelConfig.provider">
              <t-radio-button value="none">关闭</t-radio-button>
              <t-radio-button value="cloudflared">Cloudflared</t-radio-button>
            </t-radio-group>
          </t-form-item>
          <t-alert v-if="tunnelConfig.provider === 'cloudflared' && !hasCloudflared" theme="warning" message="未检测到 cloudflared，请先安装: brew install cloudflared" />
          <t-alert v-if="tunnelActive" theme="success" :message="'隧道已激活: ' + tunnelUrl" />
          <t-button @click="saveTunnelConfig">保存隧道配置</t-button>
        </t-form>
      </div>

      <!-- 端口设置 -->
      <div v-if="activeTab === 'port'" class="settings-section">
        <h2>端口设置</h2>
        <t-form :data="portConfig" label-align="top">
          <t-form-item label="后端端口">
            <t-input v-model="portConfig.appPort" type="number" placeholder="3001" />
            <p class="hint">修改后需重启生效</p>
          </t-form-item>
          <t-form-item label="Infinite Canvas 端口">
            <t-input v-model="portConfig.canvasPort" type="number" placeholder="3000" />
          </t-form-item>
          <t-button @click="savePortConfig">保存端口</t-button>
        </t-form>
      </div>

      <!-- 视频处理 -->
      <div v-if="activeTab === 'video'" class="settings-section">
        <h2>视频处理</h2>
        <p class="desc">分段视频的后处理配置，每次分段时自动执行。</p>
        <t-form :data="videoConfig" label-align="top">
          <t-form-item label="人脸马赛克">
            <t-switch v-model="videoConfig.faceBlurEnabled" @change="saveVideoConfig" />
            <span class="hint" style="margin-left:8px">启用后自动检测人脸并打马赛克，处理耗时约 5-15 秒/段</span>
          </t-form-item>
        </t-form>
      </div>

      <!-- 关于 -->
      <div v-if="activeTab === 'about'" class="settings-section">
        <h2>关于</h2>
        <t-descriptions>
          <t-descriptions-item label="版本">1.0.0</t-descriptions-item>
          <t-descriptions-item label="视频引擎">FFmpeg 场景检测</t-descriptions-item>
          <t-descriptions-item label="数据库">SQL.js (SQLite WASM)</t-descriptions-item>
        </t-descriptions>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

const activeTab = ref('suppliers')

const suppliers = ref<any[]>([])
const selectedSupplier = ref<any>(null)
const tunnelConfig = ref({ provider: 'none', port: 3001 })
const hasCloudflared = ref(false)
const tunnelActive = ref(false)
const tunnelUrl = ref('')
const portConfig = ref({ appPort: '3001', canvasPort: '3000' })
const videoConfig = ref({ faceBlurEnabled: false })

onMounted(() => { loadSuppliers(); loadTunnelConfig(); loadPortConfig(); loadVideoConfig() })

async function loadSuppliers() {
  try { const r = await fetch('/api/supplier/list'); const d = await r.json(); if (d.success) suppliers.value = d.data } catch {}
}

function selectSupplier(s: any) { selectedSupplier.value = JSON.parse(JSON.stringify(s)) }

function addSupplier() {
  const s = { id: 's_' + Date.now(), name: '新供应商', enabled: false, baseUrl: '', apiKey: '', tunnelEnabled: false, pollTimeout: 1800, endpointMappings: [] }
  suppliers.value.push(s); selectedSupplier.value = { ...s }
}

function toggleSupplier(s: any) {
  s.enabled = !s.enabled
  fetch('/api/supplier/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suppliers: suppliers.value }) })
    .then(r => r.json()).then(d => { if (!d.success) MessagePlugin.error('保存失败') })
    .catch(() => MessagePlugin.error('保存失败'))
}

function addMapping() {
  if (!selectedSupplier.value.endpointMappings) selectedSupplier.value.endpointMappings = []
  selectedSupplier.value.endpointMappings.push({ from: '', to: '' })
}
function removeMapping(i: number) { selectedSupplier.value.endpointMappings.splice(i, 1) }

async function saveSuppliers() {
  const idx = suppliers.value.findIndex((s: any) => s.id === selectedSupplier.value.id)
  if (idx >= 0) suppliers.value[idx] = { ...selectedSupplier.value }
  try {
    await fetch('/api/supplier/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ suppliers: suppliers.value }) })
    MessagePlugin.success('已保存')
  } catch { MessagePlugin.error('保存失败') }
}

async function deleteSupplier() {
  suppliers.value = suppliers.value.filter((s: any) => s.id !== selectedSupplier.value?.id)
  await saveSuppliers(); selectedSupplier.value = null
}

async function loadTunnelConfig() {
  try {
    const r = await fetch('/api/tunnel/config'); const d = await r.json()
    if (d.success) { tunnelConfig.value.provider = d.data.provider; hasCloudflared.value = d.data.hasCloudflared }
    const u = await fetch('/api/tunnel/url'); const ud = await u.json()
    if (ud.success && ud.data.active) { tunnelActive.value = true; tunnelUrl.value = ud.data.url }
  } catch {}
}
async function saveTunnelConfig() {
  await fetch('/api/tunnel/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tunnelConfig.value) })
  MessagePlugin.success('已保存')
}

async function loadPortConfig() {
  try { const r = await fetch('/api/app/config'); const d = await r.json()
    if (d.success) { if (d.data.appPort) portConfig.value.appPort = String(d.data.appPort); if (d.data.canvasPort) portConfig.value.canvasPort = String(d.data.canvasPort) } } catch {}
}
async function savePortConfig() {
  await fetch('/api/app/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appPort: parseInt(portConfig.value.appPort), canvasPort: parseInt(portConfig.value.canvasPort) }) })
  MessagePlugin.success('已保存')
}

async function loadVideoConfig() {
  try {
    const r = await fetch('/api/setting/getSetting?key=faceBlurEnabled'); const d = await r.json()
    if (d.success && d.data) videoConfig.value.faceBlurEnabled = d.data.faceBlurEnabled === 'true'
  } catch {}
}
async function saveVideoConfig() {
  await fetch('/api/setting/updateSetting', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'faceBlurEnabled', value: videoConfig.value.faceBlurEnabled ? 'true' : 'false' }) })
  MessagePlugin.success('已保存')
}
</script>

<style scoped>
.settings-page { display: flex; height: 100%; background: #fff; }
.settings-sidebar { width: 160px; min-width: 160px; border-right: 1px solid var(--td-border-level-1-color); padding: 16px 0; }
.nav-item { display: flex; align-items: center; gap: 8px; padding: 10px 16px; cursor: pointer; color: var(--td-text-color-secondary); font-size: 14px; }
.nav-item:hover { background: var(--td-bg-color-secondary); color: var(--td-text-color-primary); }
.nav-item.active { background: var(--td-brand-color-light); color: var(--td-brand-color); font-weight: 500; }
.settings-content { flex: 1; overflow-y: auto; }
.settings-section { padding: 24px 32px; max-width: 700px; }
.settings-section h2 { font-size: 20px; font-weight: 600; margin-bottom: 4px; }
.desc { color: var(--td-text-color-placeholder); font-size: 13px; margin-bottom: 24px; }
.hint { font-size: 12px; color: var(--td-text-color-placeholder); margin-top: 4px; }

/* Supplier */
.supplier-page { display: flex; height: 100%; }
.supplier-list-panel { width: 220px; min-width: 220px; border-right: 1px solid var(--td-border-level-1-color); display: flex; flex-direction: column; }
.panel-header { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid var(--td-border-level-1-color); }
.panel-header h3 { font-size: 15px; font-weight: 600; }
.supplier-list { flex: 1; overflow-y: auto; padding: 8px; }
.supplier-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 6px; cursor: pointer; margin-bottom: 2px; }
.supplier-item:hover { background: var(--td-bg-color-secondary); }
.supplier-item.active { background: var(--td-brand-color-light); }
.supplier-name { font-size: 14px; font-weight: 500; }
.empty-hint { color: var(--td-text-color-placeholder); font-size: 13px; padding: 24px; text-align: center; }
.supplier-form-panel { flex: 1; padding: 24px 32px; overflow-y: auto; }
.form-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--td-text-color-placeholder); }
.form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.form-header h3 { font-size: 18px; font-weight: 600; }
.form-row { display: flex; gap: 24px; }
.form-row .t-form-item { flex: 1; }

.mapping-row { margin-bottom: 8px; }
.mapping-fields { display: flex; align-items: center; gap: 8px; }
.mapping-arrow { color: var(--td-text-color-placeholder); flex-shrink: 0; }

.mapping-table { width:100%; }
.mapping-table td { padding:4px 4px 4px 0; }
.mapping-table td:first-child { width:40%; }
.mapping-table td:nth-child(3) { width:40%; }
.map-arrow { text-align:center; color:var(--td-text-color-placeholder); padding:0 8px; width:30px; }
.form-actions { margin-top: 24px; }
</style>
