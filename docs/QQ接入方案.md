# MindFlow 接入 QQ 方案

> 状态：方案设计，未改代码。
> 目标：让 AI 在 QQ 私聊里和自己对话，复用现有模型调用与 SQLite 会话能力。
> 结论：可行。QQ 只是新增的「消息渠道」，核心是加一层适配器，不改现有网页聊天链路。

---

## 1. 目标与边界

### 1.1 要做

- QQ 私聊发消息 → 后端调用现有模型 → 回复到 QQ。
- 支持多轮上下文，会话落 SQLite。
- 只服务自己（QQ 号白名单），不做公开机器人。
- 渠道层可扩展，后续能换官方 QQ 机器人。

### 1.2 暂不做

- 群聊、频道、图片/语音/文件消息。
- 多用户注册、权限体系（Phase 5 再考虑）。
- QQ 内流式输出（QQ 消息协议不支持逐 token 推送）。
- 主动推送、定时提醒（可后续加）。

---

## 2. 总体架构

```text
QQ 客户端
   │  私聊消息
   ▼
QQ 接入端（二选一）
   ├─ NapCatQQ / LLOneBot（OneBot v11，本地）
   └─ 官方 QQ 机器人（开放平台，公网/WS）
   │  HTTP 事件
   ▼
server/routes/qq.ts          接收、验签、去重、白名单、快速 ACK
   │
   ▼
server/channels/qq/*         事件 → 统一 IncomingMessage
   │
   ▼
server/services/chat.ts      共用：上下文裁剪 → 调模型 → 聚合回答
   │
   ├─ SQLite：channel_bindings / messages
   └─ OpenAI 兼容接口
   │
   ▼
渠道发送接口 sendMessage()    QQ 回复（分段、限速、失败重试）
```

关键点：

1. **网页和 QQ 共用 `services/chat.ts`**，不要复制 `routes/chat.ts` 的逻辑。
2. **接入端与业务解耦**：`routes/qq.ts` 只认统一的 `IncomingMessage`，换官方/第三方只换 adapter。
3. **先 ACK 再处理**：QQ 平台/OneBot 上报要求快速响应，模型调用放后台队列，避免超时重推。

---

## 3. 路线选择

| 维度 | A. NapCatQQ / OneBot v11 | B. 官方 QQ 机器人 |
|---|---|---|
| 登录方式 | 自己的 QQ 号扫码登录 | 开放平台创建机器人，AppID/AppSecret |
| 私聊 | 原生支持，体验最像「和好友聊天」 | 支持单聊，但需申请权限，且用户要先建立会话 |
| 合规 | 违反 QQ 用户协议，有封号/冻结风险 | 合规 |
| 公网要求 | 本机即可（回环 HTTP/WS） | Webhook 需公网 HTTPS；用 WebSocket 可出站免公网 |
| 审核/资质 | 无 | 开发者认证、机器人审核、部分能力需企业主体 |
| 上线速度 | 半天到一天 | 几天到数周（取决于审核） |
| 适合 | 自用、快速验证、录 Demo | 简历、长期运行、对外演示 |

**建议：**

- 现在（本地、自用、想快速看到效果）：走 **A**，用小号，不要用主号。
- 简历/部署阶段：保留同一套 `channels` 接口，增加 **B** 的实现。
- 两条路线不要同时开工，先把 A 跑通。

---

## 4. 方案 A：NapCatQQ + OneBot v11

### 4.1 组件与端口

```text
NapCatQQ（登录 QQ 小号）
├── HTTP 服务器（供我们调用发消息）     127.0.0.1:3000
└── HTTP 上报（把事件推给我们）         http://127.0.0.1:3001/api/qq/events
```

- NapCat 的「HTTP 服务器」用于调用 `send_private_msg` 等 API。
- NapCat 的「HTTP 客户端 / 上报」把消息事件 POST 到 MindFlow 后端。
- 两者都配置同一个 `token`，后端再配置一个 `secret` 用于 `X-Signature` 验签。
- 后端只需监听本机回环，不要暴露到公网。

### 4.2 事件契约（OneBot v11）

私聊文本事件示例：

```json
{
  "time": 1763300000,
  "self_id": 10001,
  "post_type": "message",
  "message_type": "private",
  "sub_type": "friend",
  "message_id": 123456,
  "user_id": 10002,
  "raw_message": "你好",
  "message": [{ "type": "text", "data": { "text": "你好" } }],
  "sender": { "user_id": 10002, "nickname": "me" }
}
```

处理规则：

- 只处理 `post_type === "message"` 且 `message_type === "private"`。
- 只取 `type === "text"` 的段；图片/表情等直接提示「暂不支持」或忽略。
- `user_id` 必须在 `QQ_ALLOWED_USERS` 白名单里，否则静默丢弃。
- 用 `message_id` 做幂等去重（NapCat 重连/重推可能重复）。
- 忽略 `self_id === user_id` 的消息，防止自回环。

### 4.3 事件接入流程

```text
1. 读取原始 body（保留 Buffer，验签需要原文）
2. 校验 X-Signature = sha1=HMAC_SHA1(secret, rawBody)
3. 解析 JSON，过滤事件类型
4. 白名单校验
5. message_id 去重（SQLite 或内存 LRU）
6. 立即返回 204
7. 投递到内存队列，按 user_id 串行处理
8. 调 chat service，拿到完整回答
9. 调 NapCat /send_private_msg 回复
```

注意事项：

- Express 的 `express.json()` 会消耗原始 body。QQ 路由需要 `express.raw({ type: 'application/json' })` 或 `verify` 回调保存 `req.rawBody`。
- 队列不要无限增长；同一用户同时只处理一条，后来的排队或丢弃并提示。
- 处理失败要记录日志，不要无限重试（避免刷屏）。

### 4.4 发送回复

```http
POST http://127.0.0.1:3000/send_private_msg
Authorization: Bearer <token>
Content-Type: application/json

{
  "user_id": 10002,
  "message": [{ "type": "text", "data": { "text": "回答内容" } }]
}
```

- QQ 消息有长度上限，建议按 **1000–1500 字**分段，优先在换行/句号处切。
- 段与段之间间隔 500–1000ms，避免触发风控。
- 回答是 Markdown，但 QQ 不渲染。发送前做纯文本化：
  - 去掉代码围栏，保留代码内容；
  - 链接保留 URL；
  - 标题符号、表格可简化。
- 空白回答、只有标点的回答不发送。
- 发送失败（token 错、账号掉线）记录日志，不重试超过 1 次。

### 4.5 会话与上下文

新增映射表，不改现有 `conversations` 结构：

```sql
CREATE TABLE IF NOT EXISTS channel_bindings (
  channel         TEXT NOT NULL,              -- 'qq'
  external_id     TEXT NOT NULL,              -- QQ user_id / 官方 openid
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (channel, external_id)
);

CREATE TABLE IF NOT EXISTS channel_seen_messages (
  channel            TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (channel, external_message_id)
);
```

处理逻辑：

1. 用 `('qq', user_id)` 查 `channel_bindings`。
2. 没有则创建 `conversations`（`user_id = 'demo'`，标题 `QQ-<昵称>`）+ binding。
3. 读取该会话最近 N 条消息，组装 `messages`。
4. 上下文预算建议：最近 10 轮原文，总 token 控制在 6k 以内；超了先删旧对话。
5. 写入用户消息、assistant 消息，更新 `conversations.updated_at`。
6. 目前 `routes/chat.ts` 还没有落库逻辑，接 QQ 前需要先补一个共用的消息持久化函数（Phase 1 的一部分）。

> 多用户阶段：每个 QQ `user_id` 对应一个 `users` 记录，`conversations.user_id` 不再写死 `demo`。

### 4.6 模型调用

- 复用 `server/lib/openai.ts` 的 `client`。
- QQ 场景建议 `stream: false`，直接拿完整回答，逻辑简单；若想复用流式，也可 `stream: true` 聚合并设置超时。
- 超时建议 90–120 秒；超时回复「这次想太久了，稍后再试」。
- 上游错误不要把原始报错发到 QQ，只发友好提示，详细错误写日志。
- `sessionId` 使用 `qq:<user_id>`，保证同一用户上游会话稳定（OpenCode Go 的 `x-opencode-session` 需要）。

### 4.7 NapCat 配置清单

1. 安装 NapCatQQ，用小号扫码登录。
2. 网络配置 → HTTP 服务器：开启，端口 `3000`，设置 token。
3. 网络配置 → HTTP 客户端（上报）：
   - URL：`http://127.0.0.1:3001/api/qq/events`
   - 消息格式：`array` 或 `string` 均可（后端两种都兼容）
   - secret：与后端 `QQ_ONEBOT_SECRET` 一致
4. 确认 NapCat 与后端在同一台机器，或网络可达。
5. 先用 `curl` 调 `/send_private_msg` 验证 token 和账号在线。

### 4.8 风险

- **封号/冻结**：第三方协议是主要风险，必须用小号，控制发送频率，不群发。
- **掉线**：NapCat 重启/风控后需重新扫码，机器人不保证 7×24。
- **本机关机即下线**：想常开需要一台常开的机器。
- **消息内容隐私**：聊天会落 SQLite，自用可接受；不要把数据库提交到 git（`data/` 已在忽略列表）。

---

## 5. 方案 B：官方 QQ 机器人

### 5.1 接入准备

1. 在 [QQ 开放平台](https://q.qq.com) 注册开发者、创建机器人。
2. 获取 `AppID`、`AppSecret`。
3. 在沙箱环境配置机器人，添加测试成员。
4. 按需申请能力：
   - 单聊（C2C）消息权限；
   - 群聊 @ 消息权限；
   - 消息内容 intent（部分场景需要）。
5. 选择事件接收方式：Webhook 或 WebSocket。

> 个人开发者能否开通单聊/群聊能力，以平台当前政策为准；通常需要审核，部分能力要求企业主体。

### 5.2 鉴权

```http
POST https://bots.qq.com/app/getAppAccessToken
Content-Type: application/json

{ "appId": "xxx", "clientSecret": "xxx" }
```

返回 `access_token` 和 `expires_in`（秒）。后端缓存 token，提前 60 秒刷新。

后续请求头：

```http
Authorization: QQBot <access_token>
```

### 5.3 事件接收

**Webhook（需要公网 HTTPS）：**

- 平台配置回调地址，例如 `https://your.domain/api/qq/official/events`。
- 校验 Ed25519 签名：`X-Signature-Ed25519` + `X-Signature-Timestamp`，公钥从开放平台获取。
- 平台会发送验证请求（`op: 13` 之类的回调验证），需要按文档原样响应。
- 国内服务器使用域名通常涉及备案。

**WebSocket（推荐，免公网）：**

- 先 `GET /gateway` 拿网关地址，或直接连 `wss://api.sgroup.qq.com/websocket`。
- 收到 `op: 10` 的 Hello 后，按 `heartbeat_interval` 发送心跳。
- 用 `op: 2` Identify，携带 token 和 intents。
- 断线后按 `op: 7`/`op: 9` 规则重连或重新鉴权。
- Node 22+ 自带全局 `WebSocket`，可不加依赖；也可用 `ws`。

### 5.4 事件与回复

| 场景 | 事件 | 回复接口 |
|---|---|---|
| 单聊 | `C2C_MESSAGE_CREATE` | `POST /v2/users/{openid}/messages` |
| 群聊 @ | `GROUP_AT_MESSAGE_CREATE` | `POST /v2/groups/{group_openid}/messages` |
| 频道 @ | `AT_MESSAGE_CREATE` | `POST /channels/{channel_id}/messages` |

单聊回复示例：

```json
{
  "content": "回答内容",
  "msg_type": 0,
  "msg_id": "收到的事件消息 ID"
}
```

关键限制：

- **被动回复**：带上收到事件的 `msg_id`，才能稳定回复。
- **主动消息**：不带 `msg_id` 属于主动推送，有额度和频率限制。
- 单聊的 `openid` 是机器人维度的用户标识，不是 QQ 号；不能直接和白名单 QQ 号比较。白名单要配置 openid，或先用「首次绑定码」机制。
- 文本长度同样有限制，需要分段。
- 官方消息不支持任意 Markdown；普通文本最稳，富媒体需要模板/ark。

### 5.5 会话映射

同方案 A，只是 `external_id` 换成 `openid`：

```text
channel_bindings ('qq-official', openid) → conversation_id
```

首次私聊时创建绑定。白名单建议做成 `QQ_OFFICIAL_ALLOWED_OPENIDS`，或让用户先发一个一次性绑定码。

### 5.6 风险与成本

- 审核周期不可控，单聊权限可能拿不到。
- Webhook 需要公网、证书、域名（国内备案）。
- 主动消息额度有限，不能当通知机器人用。
- 平台 API 版本会变，需要跟随文档。

---

## 6. 与现有代码的对接计划

### 6.1 现状盘点

| 现有文件 | 可复用点 | 需要调整 |
|---|---|---|
| `server/lib/openai.ts` | 模型 client | 无 |
| `server/routes/chat.ts` | SSE 流式调用 | 逻辑抽到 `services/chat.ts` |
| `server/lib/db.ts` | SQLite 连接、会话表 | 增加渠道映射表 |
| `server/routes/conversations.ts` | 会话 CRUD | 增加消息写入函数或复用 |
| `server/config.ts` | 环境变量集中读取 | 增加 QQ 配置项 |
| `server/app.ts` | 路由注册 | 注册 `/api/qq` |
| `server/upstream.ts` | 上游请求头 | 无 |

### 6.2 计划新增文件

```text
server/
├── channels/
│   ├── types.ts              # IncomingMessage / OutgoingMessage / Channel 接口
│   ├── onebot.ts             # NapCat/OneBot v11 适配器（验签、解析、发送）
│   └── qq-official.ts        # 官方机器人适配器（后续）
├── routes/
│   └── qq.ts                 # /api/qq/events、/api/qq/official/events
├── services/
│   └── chat.ts               # 共用：上下文 → 模型 → 聚合回答
└── lib/
    └── channel-store.ts      # 绑定关系、去重、消息落库
```

### 6.3 统一接口（建议）

```ts
interface IncomingMessage {
  channel: 'qq-onebot' | 'qq-official'
  externalUserId: string
  externalMessageId: string
  text: string
  receivedAt: number
}

interface ChannelAdapter {
  verify(req: Request): boolean
  parse(req: Request): IncomingMessage | null
  send(userId: string, text: string): Promise<void>
}
```

`routes/qq.ts` 只依赖这个接口，切换渠道时业务代码不动。

### 6.4 配置项（`.env.example` 增量）

```bash
# QQ 渠道：off | onebot | official
QQ_CHANNEL=off
QQ_ALLOWED_USERS=123456789

# OneBot / NapCat
QQ_ONEBOT_API=http://127.0.0.1:3000
QQ_ONEBOT_TOKEN=your-token
QQ_ONEBOT_SECRET=your-secret

# 官方机器人
QQ_OFFICIAL_APP_ID=
QQ_OFFICIAL_APP_SECRET=
QQ_OFFICIAL_SANDBOX=true
QQ_OFFICIAL_ALLOWED_OPENIDS=
```

### 6.5 表结构（建议直接加到 `server/lib/db.ts` 的初始化 SQL）

见 4.5 的 `channel_bindings`、`channel_seen_messages`。两张表都不影响现有表和接口。

---

## 7. 安全与风控

- **白名单**：只响应配置的 QQ 号/openid，其他消息静默丢弃。
- **验签**：OneBot 校验 `X-Signature`，官方 Webhook 校验 Ed25519。
- **幂等**：`message_id` 去重，防止重推导致重复回答。
- **限流**：每用户每分钟最多 5 条、同时只处理 1 条；超限提示稍后。
- **长度限制**：入站文本截断（如 4000 字），出站分段。
- **Body 限制**：QQ 路由 body 限制 1MB。
- **密钥管理**：token/secret 只放 `.env`，不写日志，不进 git。
- **错误信息**：对外只发友好提示，不泄露上游地址、堆栈、Key。
- **Prompt 安全**：QQ 用户消息视为不可信输入；如果后续接 RAG，检索内容用 `<context>` 包裹。
- **数据清理**：`channel_seen_messages` 定期删除 7 天前记录，避免无限增长。

> 第三方协议有封号风险，这一条无法通过代码消除。自用、小号、低频是唯一可控手段。

---

## 8. 部署与运维

### 8.1 方案 A（本机）

- MindFlow 后端 + NapCat + QQ 同机运行。
- 只监听 `127.0.0.1`，不需要公网 IP、域名、证书。
- 电脑关机/休眠 = 机器人离线。
- 适合开发期和录 Demo。

### 8.2 方案 A（常开）

- 找一台常开的 Windows 机器或云服务器。
- NapCat 官方提供 Docker 镜像；Linux 下需要处理 QQ 登录风控。
- 云服务器登录 QQ 的风控比本机高，掉线后需要远程扫码，运维成本不低。
- 更稳的做法：家里常开主机 + 内网穿透只用于管理，不暴露 NapCat API。

### 8.3 方案 B（官方）

- WebSocket 模式：后端只需出站网络，部署最简单。
- Webhook 模式：公网 HTTPS + 域名 + 证书；国内服务器注意备案。
- 建议 Docker 化，和现有后端一起部署；`/api/health` 加渠道状态（可选）。

### 8.4 日志与监控

- 记录：收到消息、耗时、token 用量、发送成功/失败、上游错误。
- 不记录：完整聊天内容到控制台（隐私），只记录长度和 ID。
- 建议加一个 `GET /api/qq/status`（仅本机/鉴权）查看渠道配置是否生效。
- 掉线告警可后置：NapCat 事件里的生命周期事件或定时探活。

---

## 9. 实施步骤与验收

### Step 1：连通性验证（0.5 天）

- [ ] NapCat 用小号登录，HTTP 服务器可调通。
- [ ] 手动 `curl /send_private_msg` 能收到消息。
- [ ] NapCat 上报能打到后端临时路由。
- [ ] 验签、白名单、去重逻辑生效。

**验收：** 给机器人发「ping」，收到「pong」。

### Step 2：抽出共用聊天服务（0.5–1 天）

- [ ] `services/chat.ts` 提供 `generateReply(messages, sessionId)`。
- [ ] `routes/chat.ts` 改为调用该服务，网页功能不回归。
- [ ] 模型超时、错误处理统一。

**验收：** 网页 SSE 正常；QQ 路由能拿到完整回答。

### Step 3：会话与持久化（0.5 天）

- [ ] 建 `channel_bindings`、`channel_seen_messages`。
- [ ] QQ 用户首次消息自动创建会话。
- [ ] 用户消息、assistant 消息落库。
- [ ] 多轮上下文可延续（问「我叫什么」能记住上一轮）。

**验收：** 连续 5 轮对话上下文正确；重启后端后历史仍在。

### Step 4：回复体验与健壮性（1 天）

- [ ] 长回答分段发送。
- [ ] Markdown 转纯文本。
- [ ] 频率限制、串行队列。
- [ ] 失败重试 1 次，错误提示友好。
- [ ] 日志与耗时统计。

**验收：** 1000 字以上回答能完整收到；快速连发不会乱序/重复。

### Step 5（可选）：官方适配器

- [ ] 开放平台创建机器人、拿到 AppID/AppSecret。
- [ ] WebSocket 或 Webhook 接入。
- [ ] `C2C_MESSAGE_CREATE` → 统一 `IncomingMessage`。
- [ ] `openid` 绑定与白名单。
- [ ] 与 OneBot 适配器共用业务层。

**验收：** 同一套业务代码，切换 `QQ_CHANNEL=official` 后可用。

---

## 10. 与路线图的关系

- 建议在 **Phase 1 完成消息持久化之后**再动手，避免 QQ 端的多轮上下文没有落库。
- QQ 接入属于「渠道层」，不是 RAG 主线；可以作为 Phase 2 之后的加分项。
- 如果时间紧，优先保证 Phase 1/2 的验收项，QQ 只作为演示彩蛋。
- 简历表述可以是：
  - 「设计多渠道消息适配层，统一 Web SSE 与 QQ 私聊入口，复用同一会话与模型调用链路。」
  - 「实现事件验签、幂等去重、白名单、限流、分段回复与 Markdown 纯文本化。」

---

## 11. 风险清单

| 风险 | 影响 | 应对 |
|---|---|---|
| 第三方协议封号 | 小号被冻结，机器人下线 | 小号、低频、不群发；重要演示用官方 |
| 本机关机 | 机器人离线 | 常开主机或云服务器 |
| QQ 消息长度/频率限制 | 长回答被截断、发送失败 | 分段、限速、失败重试 |
| NapCat 重推事件 | 重复回答 | `message_id` 幂等 |
| 上游模型超时 | 用户长时间无回复 | 90–120s 超时 + 友好提示 |
| 官方权限审核不通过 | 单聊不可用 | 先用群聊/沙箱验证，或继续用方案 A |
| 隐私泄露 | 聊天记录落库 | 本地部署、`data/` 忽略、日志脱敏 |

---

## 12. 结论

- **技术上没有障碍**，现有 Express + OpenAI + SQLite 结构可以直接扩展。
- **最省事的路径**是 NapCat + OneBot v11 私聊，半天到一天可跑通，但有小号封禁风险。
- **最适合写简历的路径**是官方机器人，但要接受审核和公网部署成本。
- 建议的工程做法是：先定义 `ChannelAdapter` 和共用 `chat service`，用 NapCat 验证，再把官方实现作为第二个 adapter。
- 现在不改代码，等 Phase 1 的消息持久化完成后按本文 Step 1–4 实施即可。
