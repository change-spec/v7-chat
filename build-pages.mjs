// Pages 构建：把 src/index.ts 打成 ESM bundle 输出到 dist/_worker.js
// 用法：node build-pages.mjs
// 路径全部基于脚本自身位置解析，Windows / Linux(CI) 通用
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(ROOT, "dist");

// esbuild 优先从项目本地 node_modules 解析（CI 里 npm install esbuild 后即可找到）；
// 找不到时退回本机已安装的全局副本
function loadEsbuild() {
  try {
    return require("esbuild");
  } catch {
    return require("C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/esbuild/lib/main.js");
  }
}
const { build } = loadEsbuild();

mkdirSync(OUT_DIR, { recursive: true });

const result = await build({
  entryPoints: [join(ROOT, "src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["worker", "browser", "import", "default"],
  target: "es2022",
  minify: true,
  treeShaking: true,
  write: false,
  outfile: join(OUT_DIR, "_worker.js"),
  logLevel: "info"
});

if (result.errors && result.errors.length) {
  console.error("BUILD FAILED");
  process.exit(1);
}
writeFileSync(join(OUT_DIR, "_worker.js"), result.outputFiles[0].text);
console.log("WROTE " + join(OUT_DIR, "_worker.js") + "  (" + (result.outputFiles[0].text.length / 1024).toFixed(1) + " KB)");

// 静态兜底页（Pages 静态资源目录需要 index.html 存在）
copyFileSync(join(ROOT, "public/index.html"), join(OUT_DIR, "index.html"));
console.log("COPIED index.html");
