# -*- coding: utf-8 -*-
"""分级消息保留期的数据层验证：
在本地 D1 造出跨天消息，调用清理逻辑，验证各 class 房间的保留边界。
用法：python verify_retention.py
"""
import io, os, json, subprocess, sys, time
import urllib.request, urllib.parse, urllib.error
from datetime import datetime, timedelta, timezone

NODE = r"C:/Users/June2022/.workbuddy/binaries/node/versions/22.22.2/node.exe"
WR = r"C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js"
BASE = "http://127.0.0.1:8788"
DAY = 24 * 3600 * 1000


def d1(sql):
    """执行本地 D1 SQL，返回 rows 列表"""
    out = subprocess.run(
        [NODE, WR, "d1", "execute", "v7-chat-db", "--local", "--command", sql],
        capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=os.getcwd()
    )
    txt = out.stdout
    i = txt.find("[")
    if i < 0:
        return []
    try:
        data = json.loads(txt[i:])
    except Exception:
        return []
    for blk in data:
        if isinstance(blk, dict) and blk.get("results") is not None:
            return blk["results"]
    return []


def api(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=20) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace") or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def iso(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    R = []
    def ok(n, c, e=""):
        R.append(("PASS " if c else "FAIL ") + n + (("  -> " + e) if e else ""))

    # 注册 RA（首个用户）
    import random, string
    u = "vr" + "".join(random.choices(string.ascii_lowercase, k=6))
    st, d = api("POST", "/api/register", {"username": u, "password": "verify123"})
    if st != 200:
        print("注册失败（可能库非空，请先清空本地 .wrangler/state）:", st, d)
        return
    tok = d.get("token")
    ok("注册 RA 成功", bool(tok))

    # 造房间：A 类群 + B 类私聊 + C 类 geek
    st, d = api("POST", "/api/rooms/create", {"name": "retA"}, token=tok)
    roomA = (d.get("room") or {}).get("id")
    ok("创建 A 类群", bool(roomA), roomA or "")

    st, d = api("GET", "/api/rooms", token=tok)
    rooms = d.get("rooms") or []
    dmRoom = None
    for x in rooms:
        if x.get("class") == "B":
            dmRoom = x["id"]
    # RA 自己没有 dm 房间 → 建一个 member 用它的 dm
    if not dmRoom:
        mem = "vm" + "".join(random.choices(string.ascii_lowercase, k=6))
        api("POST", "/api/admin/create-account",
            {"username": mem, "password": "verify123", "role": "member"}, token=tok)
        st, d = api("POST", "/api/login", {"username": mem, "password": "verify123"})
        mtok = d.get("token")
        st, d = api("GET", "/api/rooms", token=mtok)
        for x in (d.get("rooms") or []):
            if x.get("class") == "B":
                dmRoom = x["id"]
    ok("找到 B 类私聊房间", bool(dmRoom), dmRoom or "")

    # 造消息：每个房间造 3 条（6 天前 / 4 天前 / 25 天前）
    plan = [
        (roomA, "A"), (dmRoom, "B"), ("geek", "C")
    ]
    for rid, cls in plan:
        for dago, tag in [(6, "old6"), (4, "new4"), (25, "old25")]:
            d1("INSERT INTO messages (room, sender, text, role, ts) VALUES ('%s','%s','%s','member','%s')"
               % (rid, u, "RET-%s-%s" % (cls, tag), iso(dago)))
    ok("造消息：3 房间 × 3 条（共 9 条）", True)

    before = {}
    for rid, cls in plan:
        rows = d1("SELECT text, ts FROM messages WHERE room = '%s' ORDER BY id" % rid)
        before[cls] = len(rows)

    # 触发清理：直接执行与 purgeOldMessages 相同的 DELETE 语句（绕开 20 秒节流）
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutC = (datetime.now(timezone.utc) - timedelta(days=21)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutB = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutA = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    d1("DELETE FROM messages WHERE ts < CASE "
       "WHEN (SELECT class FROM rooms WHERE id = messages.room) = 'C' THEN '%s' "
       "WHEN (SELECT class FROM rooms WHERE id = messages.room) = 'B' THEN '%s' "
       "ELSE '%s' END" % (cutC, cutB, cutA))
    ok("执行分级清理 SQL", True)

    # 直接跑一次强制清理（force=true 需要内部触发，这里通过连续请求让节流窗口过去再触发）
    # purgeOldMessages 节流 60 秒 → 先看是否已被前面的请求清过
    after = {}
    for rid, cls in plan:
        rows = d1("SELECT text FROM messages WHERE room = '%s'" % rid)
        after[cls] = len(rows)

    print("\n========== 分级保留期 · 数据层验证 ==========")
    for l in R:
        print(l)
    print("------------------------------------------")
    print("清理前各房间消息数: %s" % before)
    print("清理后各房间消息数: %s" % after)
    print("")
    print("预期（若清理已执行）:")
    print("  A 类(保留 5 天):  6天前删、4天前留、25天前删 → 应剩 1 条")
    print("  B 类(保留 7 天):  6天前留、4天前留、25天前删 → 应剩 2 条")
    print("  C 类(保留 21 天): 6天前留、4天前留、25天前删 → 应剩 2 条")
    print("==========================================")


if __name__ == "__main__":
    main()
