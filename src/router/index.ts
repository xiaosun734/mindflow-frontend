import { createRouter, createWebHistory } from 'vue-router'
import ChatView from '../views/ChatView.vue'
import InterviewView from '../views/InterviewView.vue'
import KnowledgeView from '../views/KnowledgeView.vue'
import LoginView from '../views/LoginView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/chat' },
    { path: '/chat/:id?', name: 'chat', component: ChatView },
    { path: '/knowledge', name: 'knowledge', component: KnowledgeView },
    { path: '/interview', name: 'interview', component: InterviewView },
    { path: '/login', name: 'login', component: LoginView },
  ],
})
