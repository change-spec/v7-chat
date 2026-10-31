# 交接说明 · v7-chat

> 这份文档写给「以后接手这个项目的人」（包括未来的自己）。
> 所有关键凭据**不在**本仓库，需按下述途径获取。

## 一、线上现状

| 项 | 值 |
|---|---|
| 线上地址 | https://v7-chat.pages.dev |
| GitHub 仓库 | https://github.com/change-spec/v7-chat（public） |
| Cloudflare 账号 | `541418081@qq.com`，Account ID `7d498c9f067a2db08dfbae9950bee688` |
| Pages 项目 | `v7-chat`（生产分支 `main`） |
| DO 宿主 Worker | `cloud-chat-do`（`workers_dev = false`，仅供 Pages 绑定） |
| D1 数据库 | `v7-chat-db`，uuid `ca1f7479-5c41-4a1e-8ae4-836617d277d5` |
| 根管理员 | **尚未注册** —— 首个注册者自动成为 root-admin |

> ⚠️ 线上库当前 `accounts` 表为空，**第一个去注册的人就是 Root-Admin**。

## 二、拿到三个凭据

| 凭据 | 用途 | 获取方式 |
|---|---|---|
| **GitHub SSH 密钥** | 推代码 | 已配置：`~/.ssh/id_ed25519_github_change-spec`，公钥已加到 GitHub 账号。`~/.ssh/config` 里 `github.com` 主机已指向它 |
| **wrangler OAuth 登录态** | 本地部署 | 已登录。`~/.config/.wrangler/config/default.toml`（实际路径 `C:\Users\June2022\AppData\Roaming\xdg.config\.wrangler\config\default.toml`） |
| **Cloudflare API Token** | GitHub Actions 自动部署 | 需在 https://dash.cloudflare.com/profile/api-tokens 创建，权限见下 |

**Cloudflare API Token 权限**（4 行）：

| 类型 | 权限 | 级别 |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Account Settings | Read |
| Zone | Workers Routes | Edit |

资源范围：Account Resources = 所有帐户，Zone Resources = All zones。到期时间建议 90 天。

> 如果不需要 CI 自动部署，**这个 token 就不用建** —— 本地 `deploy-pages.sh` 用已登录的 wrangler 即可部署。
> 建议：本地开发为主；CI 作为可选增强。

## 三、日常部署

### 方式 A：本地手动部署（推荐，无需额外凭据）

```bash
cd v7-chat
bash deploy-pages.sh
```

脚本做三件事：esbuild 打包 → 部署 DO 宿主 Worker → 切配置后部署 Pages → 还原配置。

### 方式 B：GitHub Actions 自动部署

1. 仓库 → Settings → Secrets and variables → Actions → New repository secret
2. 建两个 Secret：
   - `CLOUDFLARE_API_TOKEN` = 上面那个 token
   - `CLOUDFLARE_ACCOUNT_ID` = `7d498c9f067a2db08dfbae9950bee688`
3. 之后每次 `git push origin main` 自动部署

### 方式 C：本地推代码触发 CI

```bash
cd v7-chat
git add -A && git commit -m "..." && git push origin main
```

## 四、本地开发

```bash
# 1. 启动本地 Worker（DO + D1 本地模拟）
npx wrangler dev --ip 0.0.0.0 --port 8787

# 2. 改前端后必须重新生成 src/html.ts
node build-html.mjs

# 3. 跑端到端测试（需先停掉 dev 并清空 .wrangler/state）
node e2e_cloud_groups.js    # 云存储 + 群组，30 项
node e2e_new_features.js    # 权限 + 计费 + 注销级联，21 项
```

⚠️ **e2e 会污染本地库**：脚本会 bootstrap 一个测试 Root-Admin。跑完记得
`taskkill /F /IM node.exe` → 删 `.wrangler/state` → 重启 dev。
（如果只是想让线上库干净，在**线上**跑测试后要用 `wrangler d1 execute --remote` 清账号。）

## 五、架构要点（改代码前必读）

### 5.1 Pages 不能自己创建 Durable Object
这是 Cloudflare 的硬限制。因此项目拆成两份部署：

```
cloud-chat-do  (Worker)  ← 定义 Room 类，跑 [[migrations]]，Pages 用 script_name 绑定它
      ↑ script_name 绑定
v7-chat        (Pages)   ← 处理 HTTP + 静态资源，env.ROOM 指向 cloud-chat-do 的命名空间
```

**两份部署用的是同一份 `src/index.ts`**（零代码拆分）。

### 5.2 `wrangler pages deploy` 不支持 `-c`
它只认默认 `wrangler.toml`。仓库里的 `wrangler.toml` 是**本地开发配置**，
所以部署前必须临时把 `wrangler.pages.toml` 覆盖过去，部署完再还原。
`deploy-pages.sh` 和 CI workflow 都已封装这个切换。

### 5.3 三个配置文件
| 文件 | 用途 |
|---|---|
| `wrangler.toml` | 本地开发（默认，`wrangler dev` 读它） |
| `wrangler.worker.local.toml` | 本地配置的备份（部署脚本用来还原） |
| `wrangler.do.toml` | DO 宿主 Worker 部署用（`-c wrangler.do.toml`） |
| `wrangler.pages.toml` | Pages 部署用（需复制成 `wrangler.toml`） |

### 5.4 云存储容量现状
- 逻辑额度：RA 免费 **8192MB（8GB）** 永久，普通用户 1190 Credits/MB/月、单账号上限 60MB
- **实际存储**：云文件二进制存在 D1 的 `cloud_file_chunks` 分片表（60KB base64/片）
- **物理上限**：D1 单库 10GB（付费）/ 500MB（免费），**不可申请提升**
- **要真存满 8GB 文件** → 必须把二进制迁到 R2（免费额度 10GB、出站费 $0）
  迁移路径已写在 README「云存储容量与迁移到 R2」一节

### 5.5 计费公式
```
textFee(text) = max(10, ceil(len/20) * 10)     // Credits
fileFee(size)  = max(20, ceil(size/MB) * 20)   // Credits
```
- 文件传输助手（`file:<自己>`）内的收发**免费**（只有自己可见），所有人适用
- `dm:*` 房间（含与 RA 的私聊）**正常扣费**，RA 回应也扣
- 云文件**转载**到群按 `fileFee` 扣费，所有人适用（含 RA）

### 5.6 房间分类
| class | 含义 | 限制 |
|---|---|---|
| A | 普通群聊 | 创建 + 加入 ≤ 10 个（所有角色受限，RA 也限） |
| B | 与 Root-Admin 的私聊 `dm:<用户名>` | 注册即自动建立；RA 看到的是各成员的 `dm:<成员>` |
| C | 内置房（`geek` 公告群、`file:<用户名>` 文件传输助手） | — |

## 六、已知的坑

1. **e2e 污染本地库**：不停 dev 就删 `.wrangler/state` 没用 —— 旧进程还握着 SQLite 句柄，会把旧数据写回来。必须先杀 node 进程。
2. **多个 wrangler 实例并存**时日志会交错写，读日志容易误判。用 `curl` 直探接口 + 直接查 sqlite。
3. **CI 上 `build-pages.mjs` 不能写死 Windows 路径** —— 已改成基于 `import.meta.url` 解析，改动时别改回去。
4. **`cloud-chat-do` 设了 `workers_dev = false`** —— 它不该有独立公网入口，只作为 DO 宿主被绑定。
5. **活跃的 Pages 生产部署删不掉**（Cloudflare 报 8000034）。要下线只能发占位版本顶替。
6. **npm 上的 `gh` 包是第三方仿冒品**（报 2.8.9 版本、一堆错），官方 CLI 是 Go 二进制。要用请从 GitHub Releases 下载。

## 七、待办 / 可选增强

- [ ] Cloudflare 面板开通 R2 → 把云文件二进制迁到 R2，让 8GB 额度成为真实可用容量
- [ ] 建 GitHub Actions Secret → 启用自动部署（不建也能用本地脚本部署）
- [ ] 线上库 `accounts` 表当前为空，**第一个注册的人就是 Root-Admin** —— 注册后记得改密码
- [ ] 旧账号 `deportee` 的本地令牌残留在 `v7-chat/.token_backup.json`（已被 `.gitignore` 排除，未进仓库），可删除
