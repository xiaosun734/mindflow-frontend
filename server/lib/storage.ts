import { mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const uploadDir = fileURLToPath(new URL('../../data/uploads', import.meta.url))

export function ensureUploadDir() {
  mkdirSync(uploadDir, { recursive: true })
}

export function storedFilePath(documentId: string, filename: string): string {
  return join(uploadDir, `${documentId}${extname(filename)}`)
}
