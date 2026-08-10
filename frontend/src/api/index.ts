import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// Project APIs
export const projectApi = {
  list: () => api.get('/project/listProjects'),
  get: (id: number) => api.get('/project/getProject', { params: { id } }),
  create: (data: { name: string; description?: string }) => api.post('/project/addProject', data),
  update: (data: any) => api.put('/project/editProject', data),
  delete: (id: number) => api.delete('/project/delProject', { params: { id } }),
}

// Video APIs
export const videoApi = {
  upload: (formData: FormData) => api.post('/video/uploadVideo', formData),
  analyze: (projectId: number) => api.post('/video/analyzeVideo', { projectId }),
  segment: (projectId: number, mode: string = 'shot', customRanges?: string) => api.post('/video/segmentVideo', { projectId, mode, customRanges }),
}

// Segment APIs
export const segmentApi = {
  list: (projectId: number) => api.get('/segment/getSegments', { params: { projectId } }),
  update: (data: any) => api.put('/segment/updateSegment', data),
  reorder: (id: number, sortOrder: number) => api.put('/segment/reorderSegment', { id, sortOrder }),
  merge: (projectId: number, ids: number[]) => api.post('/segment/mergeSegments', { projectId, ids }),
  split: (projectId: number, id: number) => api.post('/segment/splitSegment', { projectId, id }),
  uploadSpeechAudio: (formData: FormData) => api.post('/segment/uploadSpeechAudio', formData),
  removeSpeechAudio: (projectId: number, segmentId: number, index: number) => api.post('/segment/removeSpeechAudio', { projectId, segmentId, index }),
  reorderSpeechAudio: (projectId: number, segmentId: number, from: number, to: number) => api.post('/segment/reorderSpeechAudio', { projectId, segmentId, from, to }),
}

// Asset APIs
export const assetApi = {
  upload: (formData: FormData) => api.post('/asset/uploadAsset', formData),
  list: (projectId: number, type?: string) => api.get('/asset/getAsset', { params: { projectId, type } }),
  delete: (id: number) => api.delete('/asset/deleteAsset', { params: { id } }),
}

// Generation APIs
export const generateApi = {
  start: (projectId: number) => api.post('/generate/startGeneration', { projectId }),
  generateImage: (segmentId: number) => api.post('/generate/generateImage', { segmentId }),
  generateVideo: (segmentId: number) => api.post('/generate/generateVideo', { segmentId }),
  stitch: (projectId: number) => api.post('/generate/stitchVideo', { projectId }),
  cancel: (projectId: number) => api.post('/generate/cancelGeneration', { projectId }),
}

// Model APIs
export const modelApi = {
  list: (type: string = 'all') => api.get('/model/getModelList', { params: { type } }),
  detail: (modelId: string) => api.get('/model/getModelDetail', { params: { modelId } }),
}

// Settings APIs
export const settingApi = {
  get: (key?: string) => api.get('/setting/getSetting', { params: key ? { key } : {} }),
  update: (key: string, value: string) => api.put('/setting/updateSetting', { key, value }),
}

// Workflow APIs
export const workflowApi = {
  saveConfig: (projectId: number, config: { characterCount: number; replaceBackground: boolean; promptTemplate: string }) =>
    api.put('/project/editProject', { id: projectId, workflowConfig: config }),
  getConfig: (projectId: number) =>
    api.get('/project/getProject', { params: { id: projectId } }).then(res => {
      const project = res.data.data
      return project?.workflowConfig ? JSON.parse(project.workflowConfig) : null
    }),
}

// Task APIs
export const taskApi = {
  list: (projectId: number) => api.get('/task/listTasks', { params: { projectId } }),
  status: (id: number) => api.get('/task/getTaskStatus', { params: { id } }),
}

export default api
