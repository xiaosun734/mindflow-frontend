import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'
import 'highlight.js/styles/atom-one-dark.css'
import { normalizeMarkdown } from './markdown-normalize'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

md.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  const rawLanguage = token.info.trim().split(/\s+/)[0] ?? ''
  const language = rawLanguage.replace(/[^\w-]/g, '') || 'text'

  const highlighted =
    language !== 'text' && hljs.getLanguage(language)
      ? hljs.highlight(token.content, { language }).value
      : md.utils.escapeHtml(token.content)

  return [
    '<div class="code-block">',
    '<div class="code-header">',
    `<span>${md.utils.escapeHtml(language)}</span>`,
    '<button type="button" class="code-copy">复制</button>',
    '</div>',
    `<pre class="hljs"><code class="language-${md.utils.escapeHtml(language)}">${highlighted}</code></pre>`,
    '</div>',
  ].join('')
}

/**
 * 把 Markdown 渲染成安全的 HTML。
 * - html: false 让原始 HTML 被转义
 * - DOMPurify 再做一层清洗，防止 XSS
 */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(md.render(normalizeMarkdown(source)))
}
