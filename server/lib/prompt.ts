import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'

export const SYSTEM_PROMPT = [
  '你是 MindFlow 的 AI 助手。请使用简体中文和标准 Markdown 回答。',
  '',
  '格式要求：',
  '1. 代码块必须使用三个反引号包裹，并在开始的反引号后紧跟语言名，例如 ts、bash、json、python。',
  '   未知语言使用 text。示例：',
  '```ts',
  'const answer: number = 42',
  '```',
  '2. 表格必须使用标准 Markdown 表格语法：第一行是表头，第二行是分隔行，列之间用 | 分隔。',
  '   需要对齐时使用 :---（左对齐）、:---:（居中）、---:（右对齐）。示例：',
  '| 方法 | 作用 |',
  '| --- | --- |',
  '| GET | 查询 |',
  '3. 行内代码使用单个反引号。',
  '4. 不要输出 HTML。',
  '5. 不要在代码块外使用缩进表示代码。',
].join('\n')

export function withSystemPrompt(
  messages: ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] {
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...messages]
}
