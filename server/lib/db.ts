import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// server/lib/db.ts -> 项目根目录/data
const dataDir = fileURLToPath(new URL('../../data', import.meta.url))
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'mindflow.db'))

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE,
    name          TEXT NOT NULL DEFAULT 'Demo',
    password_hash TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '新对话',
    summary    TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    content         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'done'
                    CHECK (status IN ('streaming', 'done', 'error', 'stopped')),
    error           TEXT,
    citations       TEXT,
    created_at      INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON conversations(user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS documents (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    filename   TEXT NOT NULL,
    mime       TEXT,
    size       INTEGER NOT NULL DEFAULT 0,
    status     TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'ready', 'error')),
    error      TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id          TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    idx         INTEGER NOT NULL,
    heading     TEXT,
    content     TEXT NOT NULL,
    char_count  INTEGER NOT NULL,
    embedding   TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_documents_user
    ON documents(user_id, updated_at DESC);

  CREATE INDEX IF NOT EXISTS idx_chunks_document
    ON chunks(document_id, idx);
`)

db.prepare(
  `
  INSERT OR IGNORE INTO users (id, email, name, created_at)
  VALUES (?, ?, ?, ?)
`,
).run('demo', 'demo@mindflow.local', 'Demo', Date.now())

export { db }
