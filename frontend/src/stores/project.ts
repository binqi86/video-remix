import { defineStore } from 'pinia'
import { ref } from 'vue'
import { projectApi } from '../api'

export interface Project {
  id: number
  name: string
  description: string
  videoFileName: string | null
  videoDuration: number | null
  videoFilePath: string | null
  textModel: string
  imageModel: string
  videoModel: string
  status: string
  createTime: number
  updateTime: number
  segments?: Segment[]
}

export interface Segment {
  id: number
  projectId: number
  startTime: number
  endTime: number
  duration: number
  sortOrder: number
  prompt: string
  characterViewPath: string | null
  referenceFramePath: string | null
  imageGenState: string
  imageGenPath: string | null
  videoGenState: string
  videoGenPath: string | null
  errorReason: string | null
}

export const useProjectStore = defineStore('project', () => {
  const projects = ref<Project[]>([])
  const currentProject = ref<Project | null>(null)
  const loading = ref(false)

  async function fetchProjects() {
    loading.value = true
    try {
      const res = await projectApi.list()
      projects.value = res.data.data || []
    } finally {
      loading.value = false
    }
  }

  async function fetchProject(id: number) {
    loading.value = true
    try {
      const res = await projectApi.get(id)
      currentProject.value = res.data.data || null
      return currentProject.value
    } finally {
      loading.value = false
    }
  }

  async function createProject(data: { name: string; description?: string }) {
    const res = await projectApi.create(data)
    await fetchProjects()
    return res.data.data
  }

  async function updateProject(data: any) {
    const res = await projectApi.update(data)
    if (currentProject.value?.id === data.id) {
      currentProject.value = res.data.data
    }
    return res.data.data
  }

  async function deleteProject(id: number) {
    await projectApi.delete(id)
    projects.value = projects.value.filter(p => p.id !== id)
    if (currentProject.value?.id === id) {
      currentProject.value = null
    }
  }

  return { projects, currentProject, loading, fetchProjects, fetchProject, createProject, updateProject, deleteProject }
})
