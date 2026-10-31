// Pages 构建：把 src/index.ts 打成 ESM bundle 输出到 dist/_worker.js
// 用法：node build-pages.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { build } = require("C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/esbuild/lib/main.js");

const OUT_DIR = "C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat/dist";
mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: ["C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat/src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["worker", "browser", "import", "default"],
  target: "es2022",
  minify: true,
  treeShaking: true,
  write: false,
  outfile: OUT_DIR + "/_worker.js",
  logLevel: "info"
});

if (result.errors && result.errors.length) {
  console.error("BUILD FAILED");
  process.exit(1);
}
writeFileSync(OUT_DIR + "/_worker.js", result.outputFiles[0].text);
console.log("WROTE " + OUT_DIR + "/_worker.js  (" + (result.outputFiles[0].text.length / 1024).toFixed(1) + " KB)");

// 静态兜底页（Pages 静态资源目录需要 index.html 存在）
copyFileSync(
  "C:/Users/June2022/WorkBuddy/2026-10-20-22-26-37/v7-chat/public/index.html",
  OUT_DIR + "/index.html"
);
console.log("COPIED index.html");
