#!/bin/bash
# v7-chat 公网部署（Cloudflare Pages）
# 用法：bash deploy-pages.sh
set -e
cd "$(dirname "$0")"
NODE="C:/Users/June2022/.workbuddy/binaries/node/versions/22.22.2/node.exe"
WRANGLER="C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/wrangler/bin/wrangler.js"

echo "==> 1/3 构建 Pages bundle"
"$NODE" build-pages.mjs

echo "==> 2/3 部署 DO 宿主 Worker（Pages 不能自己创建 DO，必须先有它）"
"$NODE" "$WRANGLER" deploy -c wrangler.do.toml

echo "==> 3/3 部署 Pages（Pages 只认默认 wrangler.toml，临时切换）"
cp wrangler.toml wrangler.worker.local.toml
cp wrangler.pages.toml wrangler.toml
"$NODE" "$WRANGLER" pages deploy dist --project-name v7-chat --branch main
cp wrangler.worker.local.toml wrangler.toml

echo "==> 完成：https://v7-chat.pages.dev"
