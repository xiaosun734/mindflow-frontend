import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { config } from '../config.ts'
import { db } from '../lib/db.ts'
import { ensureUploadDir, storedFilePath } from '../lib/storage.ts'
import { getChunker, listChunkers } from '../services/chunking/index.ts'
import { ingestDocument } from '../services/ingest.ts'

export const documentsRouter = Router()

const DEMO_USER_ID = 'demo'
const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])

ensureUploadDir()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = extname(file.originalname).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      callback(new Error('只支持 .md、.markdown、.txt 文件'))
      return
    }
    callback(null, true)
  },
})

const documentColumns = `
  id, title, filename, mime, size, status, error, chunk_strategy, created_at, updated_at
`

function resolveChunkStrategy(value: unknown): string {
  const name = typeof value === 'string' && value.trim() ? value.trim() : config.chunkStrategy
  getChunker(name)
  return name
}

function chunkerOptions() {
  return listChunkers().map(({ name, label, description }) => ({
    name,
    label,
    description,
  }))
}

// GET /api/documents/chunkers
documentsRouter.get('/chunkers', (_req, res) => {
  res.json({ code: 0, message: 'ok', data: chunkerOptions() })
})

// GET /api/documents
documentsRouter.get('/', (_req, res) => {
  const documents = db
    .prepare(
      `select ${documentColumns}
       from documents
       where user_id = ?
       order by updated_at desc`,
    )
    .all(DEMO_USER_ID)

  res.json({ code: 0, message: 'ok', data: documents })
})

// POST /api/documents（multipart，字段名 file）
documentsRouter.post(
  '/',
  (req, res, next) => {
    upload.single('file')(req, res, (error: unknown) => {
      if (error) {
        const message = error instanceof Error ? error.message : '文件上传失败'
        res.status(400).json({ code: 400, message, data: null })
        return
      }
      next()
    })
  },
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ code: 400, message: 'file is required', data: null })
      return
    }

    const id = randomUUID()
    const now = Date.now()
    const originalName = req.file.originalname
    const titleInput = typeof req.body.title === 'string' ? req.body.title.trim() : ''
    const fallbackTitle = originalName.replace(/\.[^.]+$/, '')
    const title = (titleInput || fallbackTitle).slice(0, 100) || '未命名文档'
    const filePath = storedFilePath(id, originalName)

    let chunkStrategy: string
    try {
      chunkStrategy = resolveChunkStrategy(req.body.chunkStrategy)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知的分块策略'
      res.status(400).json({ code: 400, message, data: chunkerOptions() })
      return
    }

    try {
      await writeFile(filePath, req.file.buffer)

      db.prepare(
        `insert into documents
           (id, user_id, title, filename, mime, size, status, error, chunk_strategy, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, 'pending', null, ?, ?, ?)`,
      ).run(
        id,
        DEMO_USER_ID,
        title,
        originalName,
        req.file.mimetype || null,
        req.file.size,
        chunkStrategy,
        now,
        now,
      )
    } catch (error) {
      // 数据库写入失败时，避免留下孤立文件
      await unlink(filePath).catch(() => {})
      const message = error instanceof Error ? error.message : '创建文档失败'
      res.status(500).json({ code: 500, message, data: null })
      return
    }

    const document = db
      .prepare(`select ${documentColumns} from documents where id = ?`)
      .get(id)

    res.status(202).json({ code: 0, message: 'ok', data: document })

    void ingestDocument(id).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Document ingest failed:', error)
    })
  },
)

// POST /api/documents/:id/reindex
documentsRouter.post('/:id/reindex', (req, res) => {
  const document = db
    .prepare('select id, status, chunk_strategy from documents where id = ? and user_id = ?')
    .get(req.params.id, DEMO_USER_ID) as
    | { id: string; status: string; chunk_strategy: string }
    | undefined

  if (!document) {
    res.status(404).json({ code: 404, message: 'Document not found', data: null })
    return
  }

  if (document.status === 'processing') {
    res.status(409).json({ code: 409, message: 'Document is processing', data: null })
    return
  }

  const body = (req.body ?? {}) as { chunkStrategy?: unknown }
  let chunkStrategy = document.chunk_strategy

  if (body.chunkStrategy !== undefined) {
    try {
      chunkStrategy = resolveChunkStrategy(body.chunkStrategy)
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知的分块策略'
      res.status(400).json({ code: 400, message, data: chunkerOptions() })
      return
    }
  }

  db.prepare(
    `update documents
     set status = 'processing', error = null, chunk_strategy = ?, updated_at = ?
     where id = ?`,
  ).run(chunkStrategy, Date.now(), document.id)

  res.status(202).json({
    code: 0,
    message: 'ok',
    data: { id: document.id, status: 'processing', chunk_strategy: chunkStrategy },
  })

  void ingestDocument(document.id).catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('Document reindex failed:', error)
  })
})

// DELETE /api/documents/:id
documentsRouter.delete('/:id', async (req, res) => {
  const document = db
    .prepare('select id, filename from documents where id = ? and user_id = ?')
    .get(req.params.id, DEMO_USER_ID) as { id: string; filename: string } | undefined

  if (!document) {
    res.status(404).json({ code: 404, message: 'Document not found', data: null })
    return
  }

  db.prepare('delete from documents where id = ?').run(document.id)
  await unlink(storedFilePath(document.id, document.filename)).catch(() => {})

  res.json({ code: 0, message: 'ok', data: { id: document.id } })
})
