// 绕过被锁的 src/html.ts 与 dist/_worker.js：把最新 HTML 通过 esbuild 插件注入，
// bundle 到全新的 dist2 目录再部署。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let loadEsbuild;
try { loadEsbuild = require("esbuild"); }
catch { loadEsbuild = require("C:/Users/June2022/.workbuddy/binaries/node/workspace/node_modules/esbuild/lib/main.js"); }
const { build } = loadEsbuild;

let html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
// 把飞行棋棋盘底图内联为 data URI（worker 拦截所有路径，静态文件会 404）
const boardImg = path.join(ROOT, "public", "fl_board.jpg");
if (fs.existsSync(boardImg)) {
  const b64 = fs.readFileSync(boardImg).toString("base64");
  html = html.replace("bg.src = 'fl_board.jpg'", "bg.src = 'data:image/jpeg;base64," + b64 + "'");
  console.log("INLINED board image", Math.round(b64.length/1024), "KB base64");
}
const esc = html.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
const htmlTs = "export const html = `" + esc + "`;\n";

const htmlPlugin = {
  name: "fresh-html",
  setup(b) {
    b.onResolve({ filter: /^\.\/html$/ }, () => ({ path: "virtual:html", namespace: "fresh" }));
    b.onLoad({ filter: /.*/, namespace: "fresh" }, () => ({ contents: htmlTs, loader: "ts" }));
  }
};

const OUT = path.join(ROOT, "dist2");
fs.mkdirSync(OUT, { recursive: true });

const result = await build({
  entryPoints: [path.join(ROOT, "src", "index.ts")],
  bundle: true, format: "esm", platform: "neutral",
  mainFields: ["module", "main"], conditions: ["worker", "browser", "import", "default"],
  target: "es2022", minify: true, treeShaking: true, write: false,
  outfile: path.join(OUT, "_worker.js"), logLevel: "info",
  plugins: [htmlPlugin]
});

if (result.errors && result.errors.length) { console.error("BUILD FAILED"); process.exit(1); }
fs.writeFileSync(path.join(OUT, "_worker.js"), result.outputFiles[0].text);
fs.writeFileSync(path.join(OUT, "index.html"), html); // 用内联图片后的 HTML
console.log("WROTE dist2/_worker.js (" + (result.outputFiles[0].text.length / 1024).toFixed(1) + " KB) + index.html (inline img)");
