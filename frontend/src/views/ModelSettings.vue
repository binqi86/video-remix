<template>
  <div class="settings-page">
    <h1>模型设置</h1>

    <t-loading :loading="loading">
      <t-tabs default-value="text">
        <t-tab-panel label="文本模型" value="text">
          <div v-if="modelStore.textModels.length" class="model-list">
            <div v-for="m in modelStore.textModels" :key="m.id" class="model-item">
              <span class="model-name">{{ m.label }}</span>
              <t-tag size="small">文本</t-tag>
            </div>
          </div>
          <div v-else class="empty-models">暂无可用文本模型，请在配置中添加</div>
        </t-tab-panel>

        <t-tab-panel label="图像模型" value="image">
          <div v-if="modelStore.imageModels.length" class="model-list">
            <div v-for="m in modelStore.imageModels" :key="m.id" class="model-item">
              <span class="model-name">{{ m.label }}</span>
              <t-tag size="small" theme="success">图像</t-tag>
            </div>
          </div>
          <div v-else class="empty-models">暂无可用图像模型</div>
        </t-tab-panel>

        <t-tab-panel label="视频模型" value="video">
          <div v-if="modelStore.videoModels.length" class="model-list">
            <div v-for="m in modelStore.videoModels" :key="m.id" class="model-item">
              <span class="model-name">{{ m.label }}</span>
              <t-tag size="small" theme="warning">视频</t-tag>
            </div>
          </div>
          <div v-else class="empty-models">暂无可用视频模型</div>
        </t-tab-panel>
      </t-tabs>

      <t-divider />
      <h2>默认模型配置</h2>
      <p class="section-desc">创建新项目时自动使用的默认模型</p>
      <t-form :data="defaultModels" label-align="top" layout="vertical">
        <t-form-item label="文本模型">
          <t-select
            v-model="defaultModels.defaultTextModel"
            :options="modelStore.textModels"
            :keys="{ label: 'label', value: 'value' }"
            clearable
            placeholder="选择文本模型"
          />
        </t-form-item>
        <t-form-item label="图像生成模型">
          <t-select
            v-model="defaultModels.defaultImageModel"
            :options="modelStore.imageModels"
            :keys="{ label: 'label', value: 'value' }"
            clearable
            placeholder="选择图像生成模型"
          />
        </t-form-item>
        <t-form-item label="视频生成模型">
          <t-select
            v-model="defaultModels.defaultVideoModel"
            :options="modelStore.videoModels"
            :keys="{ label: 'label', value: 'value' }"
            clearable
            placeholder="选择视频生成模型（如 Seedance 2.0）"
          />
        </t-form-item>
        <t-form-item>
          <t-button theme="primary" @click="saveDefaultModels">保存默认模型</t-button>
        </t-form-item>
      </t-form>
    </t-loading>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useModelStore } from '../stores/model'

const modelStore = useModelStore()
const loading = ref(false)
const defaultModels = ref({
  defaultTextModel: '',
  defaultImageModel: '',
  defaultVideoModel: '',
})

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([modelStore.fetchModels(), modelStore.fetchSettings()])
    defaultModels.value = {
      defaultTextModel: modelStore.settings.defaultTextModel || '',
      defaultImageModel: modelStore.settings.defaultImageModel || '',
      defaultVideoModel: modelStore.settings.defaultVideoModel || '',
    }
  } finally {
    loading.value = false
  }
})

async function saveDefaultModels() {
  try {
    await Promise.all([
      modelStore.updateSetting('defaultTextModel', defaultModels.value.defaultTextModel),
      modelStore.updateSetting('defaultImageModel', defaultModels.value.defaultImageModel),
      modelStore.updateSetting('defaultVideoModel', defaultModels.value.defaultVideoModel),
    ])
    MessagePlugin.success('默认模型已保存')
  } catch (err: any) {
    MessagePlugin.error(`保存失败: ${err.message}`)
  }
}
</script>

<style scoped>
.settings-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px;
}
.settings-page h1 {
  font-size: 24px;
  margin-bottom: 24px;
}
.settings-page h2 {
  font-size: 18px;
  margin-bottom: 8px;
}
.section-desc {
  color: var(--td-text-color-placeholder);
  font-size: 13px;
  margin-bottom: 16px;
}
.model-list {
  margin: 12px 0;
}
.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--td-border-level-1-color);
}
.model-name {
  font-size: 14px;
}
.empty-models {
  padding: 40px;
  text-align: center;
  color: var(--td-text-color-placeholder);
}
</style>
