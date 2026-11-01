// 公网安全审计：检查所有 API 端点在「未登录」状态下的行为
// 任何返回 200 的写操作/数据读取都视为漏洞
// 用法：node e2e_security_audit.js [BASE_URL]
const BASE = process.argv[2] || "https://v7-chat.pages.dev";

// [路径, 方法, 期望状态, 说明]
const CASES = [
  ["/api/me", "GET", 401, "当前用户信息"],
  ["/api/history", "GET", 401, "聊天历史（曾泄露全部消息）"],
  ["/api/rooms", "GET", 401, "房间列表"],
  ["/api/cloud/status", "GET", 401, "云空间状态"],
  ["/api/cloud/list", "GET", 401, "云文件列表"],
  ["/api/cloud/file?id=x", "GET", 401, "云文件内容"],
  ["/api/admin/accounts", "GET", 401, "账号列表（曾泄露用户名/角色/积分）"],
  ["/api/admin/otps", "GET", 401, "兑换码列表（曾泄露完整码）"],
  ["/api/logs", "GET", 401, "系统日志"],
  ["/api/credits-logs", "GET", 401, "Credits 流水"],
  ["/api/accounts/list", "GET", 401, "账号用户名列表"],
  ["/api/apikey/status", "GET", 401, "API Key 绑定状态"],
  ["/api/apikey/list", "GET", 403, "API Key 列表"],
  ["/api/game/state", "GET", 401, "游戏状态"],
  ["/api/register", "POST", 400, "注册（400=格式校验，说明通道开着但需正确格式）"],
  ["/api/login", "POST", 401, "登录（探针账密格式合法 → 应 401 用户名或密码错误）"],
  ["/api/admin/create-account", "POST", 403, "创建账号"],
  ["/api/admin/create-otp", "POST", 403, "生成兑换码"],
  ["/api/admin/deactivate", "POST", 401, "注销账号"],
  ["/api/otp/redeem", "POST", 401, "兑换 Credits"],
  ["/api/cloud/upload?name=x&mime=text/plain", "POST", 401, "云文件上传"],
  ["/api/cloud/delete", "POST", 401, "云文件删除"],
  ["/api/cloud/buy", "POST", 401, "购买云空间"],
  ["/api/cloud/repost", "POST", 401, "云文件转载"],
  ["/api/rooms/create", "POST", 401, "创建群聊"],
  ["/api/rooms/disband", "POST", 401, "解散群聊"],
  ["/api/password", "POST", 401, "改密码"],
  ["/api/apikey/bind", "POST", 401, "绑定 API Key"],
];

// 静态敏感文件：必须不可访问
const STATIC = [
  ".token_backup.json", ".env", "wrangler.toml", "wrangler.do.toml",
  "wrangler.pages.toml", "package.json", "schema.sql", "src/index.ts", ".git/config",
];

const R = [];
const ok = (n, c, e) => { R.push({ pass: !!c, line: (c ? "PASS " : "FAIL ") + n + (e ? "  -> " + e : "") }); };

async function probe(path, method, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers["content-type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, opt);
  let d = null;
  try { d = await r.json(); } catch {}
  return { status: r.status, data: d };
}

(async () => {
  console.log("审计目标: " + BASE + "\n");

  // 1) 未登录访问 API
  for (const [path, method, expect, desc] of CASES) {
    let res;
    try {
      res = await probe(path, method, method === "POST" ? { probe: "x" } : undefined);
    } catch (e) {
      ok(`${method} ${path} - ${desc}`, false, "请求异常 " + e.message);
      continue;
    }
    const good = res.status === expect;
    ok(`${method} ${path} - ${desc}`, good, `期望 ${expect} 实得 ${res.status}` + (res.status === 200 ? " 内容=" + JSON.stringify(res.data).slice(0, 120) : ""));
  }

  // 2) 静态敏感文件
  for (const f of STATIC) {
    let code = 0;
    try {
      const r = await fetch(BASE + "/" + f);
      code = r.status;
    } catch (e) { code = -1; }
    ok(`静态文件不可访问 /${f}`, code === 404 || code === 403 || code === 401, "HTTP " + code);
  }

  // 3) 首页不含隐私标签
  const html = await (await fetch(BASE + "/")).text();
  const leaks = ["零度深核", "肖懿航", "七年级", "初一年级", "12岁", "NU-CLEAR", "sb_secret_", "sb_publishable_"];
  for (const kw of leaks) {
    ok(`首页不含敏感串「${kw}」`, !html.includes(kw), html.includes(kw) ? "出现了！" : "");
  }

  // 4) 未登录不能连 WebSocket
  try {
    const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/room?token=invalid_token_probe");
    const res = await new Promise((resolve) => {
      const t = setTimeout(() => resolve("timeout"), 6000);
      ws.onopen = () => { clearTimeout(t); resolve("opened"); };
      ws.onerror = () => { clearTimeout(t); resolve("rejected"); };
      ws.onclose = () => { clearTimeout(t); resolve("closed"); };
    });
    ok("无效 token 不能建立 WebSocket", res !== "opened", "结果=" + res);
  } catch (e) {
    ok("无效 token 不能建立 WebSocket", true, "连接被拒");
  }

  console.log("\n================= 公网安全审计 =================");
  R.forEach((r) => console.log(r.line));
  console.log("==================================================");
  const fails = R.filter((r) => !r.pass);
  console.log(fails.length === 0 ? `ALL PASS (${R.length})` : `${fails.length} FAILED / ${R.length}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => { console.error("SCRIPT ERROR:", e && e.stack ? e.stack : e); process.exit(2); });
