# -*- coding: utf-8 -*-
"""改动配额前，把线上 RA 云空间的 8 个文件全量备份到本地工作区。
只读线上，不写任何线上数据。"""
import os, io, json, subprocess, urllib.request, hashlib, time

NODE = r"C:/Users/June2022/.workbuddy/binaries/node/versions/22.22.2/node.exe"
WR = r"C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js"
CWD = r"C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat"
TOKEN = "09418a56065b06256eb971bd222d9395a911e984aa645855"
BASE = "https://v7-chat.pages.dev"
OUT = os.path.join(CWD, "cloud_backup_20261107")


def d1(sql):
    r = subprocess.run([NODE, WR, "d1", "execute", "v7-chat-db", "--remote", "--command", sql],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=CWD)
    t = r.stdout
    i = t.find("[")
    if i < 0:
        return []
    try:
        obj = json.loads(t[i:])
    except Exception:
        return []
    for blk in obj:
        if isinstance(blk, dict) and blk.get("results") is not None:
            return blk["results"]
    return []


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = d1("SELECT id,owner,name,size,mime,storage,created_at FROM cloud_files")
    print("线上文件数:", len(meta))
    manifest = []
    for row in meta:
        fid, name, size, storage = row["id"], row["name"], row["size"], row["storage"]
        safe = "".join(c for c in name if c not in '\\/:*?"<>|')
        dest = os.path.join(OUT, safe)
        url = BASE + "/api/cloud/file?id=" + fid
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + TOKEN,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        })
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                data = resp.read()
            with open(dest, "wb") as f:
                f.write(data)
            okb = len(data) == size
            print("  %-34s %10d B  %s  %s" % (name[:34], len(data), storage, "OK" if okb else "!! 字节不符"))
            manifest.append({"id": fid, "name": name, "size": size, "storage": storage,
                             "mime": row.get("mime"), "owner": row["owner"],
                             "backup": safe, "bytes": len(data),
                             "sha256": hashlib.sha256(data).hexdigest(), "ok": okb})
        except Exception as e:
            print("  FAIL", name, repr(e))
            manifest.append({"id": fid, "name": name, "size": size, "error": repr(e), "ok": False})
    io.open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8").write(
        json.dumps({"time": time.strftime("%Y-%m-%d %H:%M:%S"), "files": manifest}, ensure_ascii=False, indent=2))
    good = sum(1 for x in manifest if x.get("ok"))
    print("\n备份完成 %d/%d  ->  %s" % (good, len(manifest), OUT))
    return 0 if good == len(manifest) else 1


if __name__ == "__main__":
    raise SystemExit(main())
