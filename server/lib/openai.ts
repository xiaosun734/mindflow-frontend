import OpenAI from 'openai'
import { config } from '../config.ts'

export const client = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseURL,
})

export const embedClient = new OpenAI({
  apiKey: config.embed.apiKey,
  baseURL: config.embed.baseURL,
})
