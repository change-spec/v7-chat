# Geek Chat Room

基于 Cloudflare 的实时聊天室：WebSocket 群聊 + 私聊 + 文件传输 + 云存储 + Credits 计费系统。

## 技术栈

| 层 | 方案 |
|---|---|
| 实时层 | Cloudflare Durable Objects（单例房间枢纽 `Room`，SQLite 存储后端） |
| 数据层 | Cloudflare D1（`v7-chat-db`） |
| 文件存储 | Supabase Storage（`cloud-files` 桶，私有） |
| HTTP 层 | Cloudflare Pages（`_worker.js` Advanced Mode）+ esbuild 打包 |
| 前端 | 单文件 HTML5（无构建框架，原生 JS + CSS） |
| 鉴权 | PBKDF2-SHA256（100000 轮）密码哈希 + Bearer Token 会话 |

## 核心功能

- **群聊三分类**
  - `A` 类：普通群聊，创建 + 加入上限 10 个（所有角色受限）
  - `B` 类：与 Root-Admin 的私聊，注册即自动建立
  - `C` 类：内置房（公告群、文件传输助手）
- **身份角色**：`root-admin` / `admin` / `member` / `observer`
  - 观测者仅能在「文件传输助手」与「与 Root-Admin 的私聊」中发言
- **Credits 计费**
  - 文本：`max(10, ceil(字数/20) * 10)` Credits
  - 文件：`max(20, ceil(大小/1MB) * 20)` Credits
  - 文件传输助手中的收发**免费**（仅自己可见）
- **云存储**：1190 Credits/MB/月，单账号上限 60MB；Root-Admin 免费 1GB 永久空间；上传/下载免费，转载按文件价计费
- **文件服务**：服务端持久化 7 天，按 64KB 分块落库（`chat_file_chunks` / `cloud_file_chunks`）
- **管理能力**：账号增删、OTP 兑换码、Credits 流水、系统日志、API Key 签发

## 目录结构

```
src/index.ts        Worker 入口（HTTP 路由 + Durable Object 定义）
src/html.ts         前端 HTML（由 public/index.html 生成，勿手改）
public/index.html   前端源文件
build-html.mjs      public/index.html → src/html.ts
build-pages.mjs     src/index.ts → dist/_worker.js（Pages 打包）
deploy-pages.sh     一键公网部署
wrangler.toml       本地开发配置
wrangler.do.toml    Durable Object 宿主 Worker 配置（Pages 部署用）
wrangler.pages.toml Pages 项目配置（Pages 部署用）
schema.sql          D1 表结构参考
e2e_*.js            端到端测试脚本（Node 直连 HTTP API）
```

## 本地开发

```bash
npx wrangler dev --ip 0.0.0.0 --port 8787
```

改动前端后**必须**重新生成 `src/html.ts`：

```bash
node build-html.mjs
```

## 公网部署（Cloudflare Pages）

```bash
bash deploy-pages.sh
```

脚本会依次：esbuild 打包 → 部署 DO 宿主 Worker → 部署 Pages。

> **为什么需要单独的 DO 宿主 Worker？**
> Cloudflare Pages 项目无法创建 Durable Object，也不能执行 DO 类迁移。
> 因此 DO 类必须先部署在独立 Worker（`cloud-chat-do`）上，
> Pages 再通过 `script_name` 绑定该已存在的命名空间。

### 云存储后端（Supabase Storage）

云文件二进制存放在 **Supabase Storage**（桶 `cloud-files`，私有），D1 只保留元数据。
选择理由：账号是 Workers 免费档，**D1 单库仅 500MB 且不可申请提升**，
而 Supabase 免费档提供 1GB 文件存储 + 5GB 月出站流量，无需绑定支付方式。

- D1 的 `cloud_files.storage` 字段标记后端：`supabase` / `d1`
- 上传路径优先写 Supabase，失败时**自动降级**为 D1 分片（`cloud_file_chunks`），行为不变
- 桶为**私有**，所有访问都经 Worker 中转并校验会话 —— Supabase key 只存在于 Worker secret
- 单文件上限 20MB（bucket 级限制）

**所需 secret**（用 `wrangler secret put` 注入，不进代码不进仓库）：

| Secret | 值 |
|---|---|
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SECRET` | 项目 API key（secret key，管理员权限） |
| `SUPABASE_BUCKET` | `cloud-files` |

两端都要注入（DO 宿主 Worker 与 Pages 各一份）：

```bash
wrangler secret put SUPABASE_SECRET -c wrangler.do.toml
wrangler pages secret put SUPABASE_SECRET --project-name v7-chat
```

> Supabase 免费档项目**1 周无活动会被自动暂停**，届时文件服务需在面板手动恢复。

## 端到端测试

两个脚本均需在**干净的本地数据库**上运行（首个注册者自动成为 Root-Admin）：

```bash
npx wrangler dev --ip 0.0.0.0 --port 8787   # 先起服务
node e2e_cloud_groups.js                     # 云存储 + 群组（30 项）
node e2e_new_features.js                     # 权限 + 计费 + 注销级联（21 项）
```

清理本地状态：停止 dev server 后删除 `.wrangler/state`。

## 云端资源

| 资源 | 名称 | 说明 |
|---|---|---|
| Pages 项目 | `v7-chat` | 对外访问入口 `https://v7-chat.pages.dev` |
| DO 宿主 Worker | `cloud-chat-do` | Durable Object 类宿主，`workers_dev = false`（仅供绑定，不对外） |
| D1 数据库 | `v7-chat-db` | 账号、消息、群组、云文件元数据 |

**部署时 Pages 只认默认 `wrangler.toml`**（`pages deploy` 不支持 `-c` 指定其他路径），
因此 `deploy-pages.sh` 会临时把 `wrangler.pages.toml` 覆盖到 `wrangler.toml`，
部署完成后再还原为本地开发配置。

## 安全说明

- 密码使用 PBKDF2-SHA256 加盐哈希存储，从不明文落库
- Root-Admin 存在后公开注册自动关闭，新账号仅可由管理员创建
- 账号注销时级联删除其与 Root-Admin 的私聊房间及相关消息、文件
- 生产环境务必修改默认 D1 / Worker 绑定配置
