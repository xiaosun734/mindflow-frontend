import dotenv from 'dotenv'

// 必须在读取 process.env 之前执行
dotenv.config({ path: new URL('../.env', import.meta.url) })

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable: ${name}`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  chunkStrategy: process.env.CHUNK_STRATEGY ?? 'markdown',
  openai: {
    apiKey: required('OPENAI_API_KEY'),
    baseURL: process.env.OPENAI_BASE_URL,
    model: required('OPENAI_MODEL'),
  },
  embed: {
    apiKey: required('EMBED_API_KEY'),
    baseURL: process.env.EMBED_BASE_URL,
    model: required('EMBED_MODEL'),
  },
}
