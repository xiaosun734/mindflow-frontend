# MindFlow

MindFlow 是一个 Vue 3 + TypeScript 前端项目，同时内置了一个基于 Express 的轻量 AI 后端，用于代理大模型对话与文本向量化请求，并在页面上提供一个可直接调试接口的测试面板。

## 功能

- **流式对话**：`/api/chat` 以 SSE（Server-Sent Events）方式转发大模型的流式输出，页面实时逐字显示。
- **文本向量化**：`/api/embed` 调用 Embedding 模型，返回向量维度、Token 用量和前几个分量，便于验证配置。
- **开发代理**：Vite 将 `/api` 请求代理到本地后端，前端代码中直接使用相对路径即可。
- **前后端同仓**：后端源码位于 `server/`，与前端共享 `src/types/api.ts` 中的类型定义。

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 前端 | Vue 3、TypeScript、Vite |
| 后端 | Express 5、OpenAI SDK、dotenv |
| 包管理 | pnpm |

## 目录结构

```text
.
├── server/
│   └── index.ts           # Express 后端入口（对话 + Embedding 接口）
├── src/
│   ├── components/
│   │   └── ChatPanel.vue  # API 测试面板
│   ├── types/
│   │   └── api.ts         # 前后端共享的请求/响应类型
│   ├── App.vue
│   ├── main.ts
│   └── style.css
├── .env                   # 后端环境变量与密钥（已被 git 忽略）
├── .env.development       # 前端环境变量
├── .env.example           # 环境变量模板
└── vite.config.ts         # Vite 配置，/api 代理到 3001 端口
```

## 快速开始

### 1. 环境要求

- **Node.js >= 22.18**（推荐 Node 24）：后端直接以原生 Node 运行 TypeScript，无需编译。
- **pnpm**（本项目使用 pnpm，建议 >= 8）。

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

复制模板并填入你自己的密钥：

```bash
cp .env.example .env
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

`.env` 需要配置以下变量：

| 变量 | 说明 |
| --- | --- |
| `OPENAI_API_KEY` | 对话模型的 API Key |
| `OPENAI_BASE_URL` | 对话模型的 OpenAI 兼容接口地址 |
| `OPENAI_MODEL` | 对话模型名称 |
| `UPSTREAM_HEADERS` | 可选，追加到上游请求的自定义请求头（JSON），`{sessionId}` 会替换为当前会话 ID |
| `EMBED_API_KEY` | Embedding 模型的 API Key |
| `EMBED_BASE_URL` | Embedding 模型的 OpenAI 兼容接口地址 |
| `EMBED_MODEL` | Embedding 模型名称 |
| `PORT` | 后端端口，默认 `3001` |

> `.env` 已被 `.gitignore` 忽略，请勿把真实密钥提交到仓库。

### 4. 启动后端

在**第一个终端**中运行：

```bash
pnpm dev:server
```

启动成功后终端会输出：

```text
Server is running on port 3001
```

后端地址为 <http://localhost:3001>。`pnpm dev:server` 使用 `node --watch`，修改后端代码后会自动重启。

> 不要使用 `pnpm server`：这是 pnpm 自带的“管理 store 服务”命令，会覆盖同名脚本，看起来就像“没有反应”。

> 如果你的 Node 版本低于 22.18，无法原生运行 TypeScript，可改用：
>
> ```bash
> pnpm dlx tsx server/index.ts
> ```

### 5. 启动前端

在**第二个终端**中运行：

```bash
pnpm dev
```

打开终端输出的地址（默认 <http://localhost:5173>），即可看到 API 测试面板。

> 前端和后端需要同时运行。前端通过 Vite 代理把 `/api/**` 转发到 `http://localhost:3001`，因此浏览器端不会遇到跨域问题。

## 可用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动 Vite 前端开发服务器（默认 5173 端口） |
| `pnpm dev:server` | 启动 Express 后端（默认 3001 端口，自动重启） |
| `pnpm build` | 类型检查并构建前端到 `dist/` |
| `pnpm preview` | 本地预览构建产物 |
| `pnpm lint` | 运行 ESLint 检查 |
| `pnpm format` | 使用 Prettier 格式化代码 |

## API 说明

### `POST /api/chat`

以 SSE 流式返回模型回复。

请求体：

```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "sessionId": "本次会话的唯一 ID"
}
```

`sessionId` 为可选字段，后端会把它作为 `x-opencode-session` 请求头转发给上游（使用 OpenCode Go 时必需，且同一会话内应保持不变）。前端每次页面会话会自动生成一个；未传时后端会生成临时 ID。

响应为 `text/event-stream`，每条消息形如：

```text
data: {"content":"你"}

data: {"content":"好"}

data: [DONE]
```

出错时会返回：

```text
data: {"error":"错误信息"}
```

当 `messages` 缺失或为空数组时，接口返回 `400`。

### `POST /api/embed`

计算文本向量。

请求体：

```json
{
  "input": "需要向量化的文本"
}
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "embedding": [0.0123, -0.0456],
    "tokens": 8
  }
}
```

> 当前实现只返回 `input` 中第一条文本的向量。

## 后端说明

- 入口文件为 `server/index.ts`，监听端口读取 `.env` 中的 `PORT`，未配置时默认 `3001`。
- 对话与 Embedding 分别使用两套独立的 OpenAI 兼容配置，可指向 DeepSeek、SiliconFlow 等服务，只要接口协议兼容即可。
- 对话请求头由 `server/upstream.ts` 的中间件统一处理：按 `OPENAI_BASE_URL` 的域名自动附加服务商所需请求头（如 OpenCode Go 的 `x-opencode-session`），也可用 `UPSTREAM_HEADERS` 追加自定义头。切换模型或服务商时通常只需修改 `.env`。
- 后端只提供 API，不托管前端静态文件。生产环境请先 `pnpm build`，用 Nginx 等静态服务器托管 `dist/`，再把 `/api` 反向代理到后端。
- 修改 `.env` 后需要重启后端才能生效。
- 当前项目没有数据库与持久化，聊天记录仅保存在页面内存中。

## 常见问题

**前端请求返回 502 或 `ECONNREFUSED`？**

后端未启动或端口不一致。确认 `pnpm dev:server` 正在运行，并检查 `.env` 的 `PORT` 是否与 `vite.config.ts` 中的代理目标一致。

**端口被占用？**

修改 `.env` 中的 `PORT`，同时更新 `vite.config.ts` 中的代理目标，然后重启前后端。

**接口返回 401 或提示余额不足？**

检查 `.env` 中的 Key、`BASE_URL` 与模型名称是否匹配对应服务商。

**接口返回 `400 Request is missing x-opencode-session`？**

说明上游是 OpenCode Go。它要求每个会话在请求头中携带稳定的 `x-opencode-session`。本项目已自动处理：前端发送 `sessionId`，后端转发为对应请求头；如果自定义客户端直接调用后端，请在请求体中传入 `sessionId`。

**Node 提示无法识别 TypeScript？**

Node 版本过低。升级到 Node 22.18+，或使用上方提到的 `pnpm dlx tsx server/index.ts` 启动。
