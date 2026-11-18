import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { getChunker } from './chunking/index.ts'
import { embedTexts } from '../lib/embedding.ts'
import { db } from '../lib/db.ts'
import { storedFilePath } from '../lib/storage.ts'

interface DocumentRow {
  id: string
  filename: string
  title: string
  chunk_strategy: string
}

function updateStatus(
  documentId: string,
  status: 'processing' | 'ready' | 'error',
  error: string | null = null,
) {
  db.prepare('update documents set status = ?, error = ?, updated_at = ? where id = ?').run(
    status,
    error,
    Date.now(),
    documentId,
  )
}

/**
 * 读取文件 -> 分块 -> 批量 embedding -> 写入 chunks。
 * 失败时把文档标记为 error，并保留具体原因。
 */
export async function ingestDocument(documentId: string): Promise<void> {
  const document = db
    .prepare('select id, filename, title, chunk_strategy from documents where id = ?')
    .get(documentId) as DocumentRow | undefined

  if (!document) {
    throw new Error('Document not found')
  }

  updateStatus(documentId, 'processing')

  try {
    const filePath = storedFilePath(document.id, document.filename)
    const source = await readFile(filePath, 'utf8')
    const chunker = getChunker(document.chunk_strategy)
    const chunks = chunker.chunk(source)

    if (chunks.length === 0) {
      throw new Error('文档没有可索引的内容')
    }

    const embeddings = await embedTexts(chunks.map((chunk) => chunk.content))

    if (embeddings.length !== chunks.length) {
      throw new Error('Embedding 数量与分块数量不一致')
    }

    const insertChunk = db.prepare(
      `insert into chunks
         (id, document_id, idx, heading, content, char_count, embedding, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const now = Date.now()

    db.exec('begin')
    try {
      db.prepare('delete from chunks where document_id = ?').run(documentId)

      chunks.forEach((chunk, index) => {
        insertChunk.run(
          randomUUID(),
          documentId,
          index,
          chunk.heading,
          chunk.content,
          chunk.charCount,
          JSON.stringify(embeddings[index]),
          now,
        )
      })

      updateStatus(documentId, 'ready')
      db.exec('commit')
    } catch (error) {
      db.exec('rollback')
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Indexing failed'
    updateStatus(documentId, 'error', message)
    throw error
  }
}
