import { config } from '../config.ts'
import { embedClient } from './openai.ts'

const BATCH_SIZE = 16
const MAX_RETRIES = 2

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 批量生成 embedding。
 * 每批 16 条，失败最多重试 2 次。
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = []

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE)
    let lastError: unknown = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await embedClient.embeddings.create({
          model: config.embed.model,
          input: batch,
        })

        const batchEmbeddings = [...response.data]
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding)

        if (batchEmbeddings.length !== batch.length) {
          throw new Error('Embedding 数量与输入数量不一致')
        }

        embeddings.push(...batchEmbeddings)
        lastError = null
        break
      } catch (error) {
        lastError = error
        if (attempt < MAX_RETRIES) {
          await sleep(300 * (attempt + 1))
        }
      }
    }

    if (lastError) {
      throw lastError
    }
  }

  return embeddings
}
