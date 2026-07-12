import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import ProjectDetail from '../views/ProjectDetail.vue'
import Workbench from '../views/Workbench.vue'
import Settings from '../views/Settings.vue'
import CanvasProxy from '../views/CanvasProxy.vue'

const routes = [
  { path: '/', name: 'Dashboard', component: Dashboard },
  { path: '/project/:id', name: 'ProjectDetail', component: ProjectDetail, props: true },
  { path: '/workbench/:projectId/:segmentId?', name: 'Workbench', component: Workbench, props: true },
  { path: '/settings', name: 'Settings', component: Settings },
  { path: '/canvas-proxy', name: 'CanvasProxy', component: CanvasProxy },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
