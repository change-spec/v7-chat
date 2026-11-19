// 飞行棋引擎单测：从 index.html 提取 <script id="flightEngine"> 在 Node 求值。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const m = html.match(/<script id="flightEngine">([\s\S]*?)<\/script>/);
if (!m) { console.error("找不到 flightEngine script"); process.exit(2); }
(0, eval)(m[1]);
const FE = globalThis.FlightEngine;
if (!FE) { console.error("FlightEngine 未挂载"); process.exit(2); }

const { PATH, N_MAIN, GOAL, COLORS, cellColor, newState, legalMoves, apply, cellOf, absCell, serialize, parse } = FE;
let pass = 0, fail = 0;
const ok = (c, n, extra) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra !== undefined ? " → " + JSON.stringify(extra) : "")); } };

console.log("=== 路径 / 颜色验证 ===");
{
  let good = PATH.length === 52;
  const seen = new Set();
  let diag = 0;
  for (let i = 0; i < PATH.length; i++) {
    const k = PATH[i].join(",");
    if (seen.has(k)) good = false;
    seen.add(k);
    const a = PATH[i], b = PATH[(i + 1) % PATH.length];
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (d === 2) diag++;
    if (d !== 1 && d !== 2) good = false;
  }
  ok(good && diag === 4, "52格环(4拐角对角)无重复");
  let smooth = true;
  COLORS.forEach((c, seat) => {
    const before = absCell(seat, 51), home0 = c.home[0];
    if (Math.abs(before[0] - home0[0]) + Math.abs(before[1] - home0[1]) !== 1) smooth = false;
  });
  ok(smooth, "四归航道入口与主轨道平滑衔接");
  ok(COLORS.map(c => c.start).join(",") === "0,13,26,39", "四起飞点间隔13");
  const mods = COLORS.map(c => c.start % 4);
  ok(new Set(mods).size === 4, "四起飞点颜色不重合(0/1/2/3)");
  // 跳格颜色一致：progress%4==0 的格子色 == 该玩家起飞色
  let colorOk = true;
  COLORS.forEach((c, seat) => {
    for (let p = 4; p < N_MAIN; p += 4) {
      const cellIdx = (c.start + p) % N_MAIN;
      if (cellColor(cellIdx) !== c.start % 4) { colorOk = false; break; }
    }
  });
  ok(colorOk, "每4格跳格颜色=自己起飞色(跳跃有据可查)");
}

console.log("=== 规则自测 ===");
{
  const s = newState(2);
  ok(legalMoves(s, 5).length === 0, "非6点无法起飞");
  const lm = legalMoves(s, 6);
  ok(lm.length === 4 && lm.every(m => m.to === 0 && m.takeoff), "掷6有4个起飞选项");
}
{
  let s = newState(2); s = apply(s, 6, 0);
  ok(s.pieces[0][0] === 0, "起飞 progress=0");
  ok(s.six === true && s.turn === 0, "掷6本人再掷");
}
{
  let s = newState(2); s.pieces[0][0] = 3;
  s = apply(s, 3, 0);
  ok(s.pieces[0][0] === 6, "移动 3+3=6(非色格不跳)");
  ok(s.turn === 1 && s.six === false, "非6换下家");
}
{
  let s = newState(2); s.pieces[0][0] = 1;
  s = apply(s, 3, 0);
  ok(s.pieces[0][0] === 8, "落自己色格跳4 (4→8)");
  ok(s._events.some(e => e.type === "jump"), "jump 事件");
}
{
  let s = newState(2);
  s.pieces[0][0] = 5; s.pieces[1][0] = 45; s.turn = 0;
  s = apply(s, 1, 0);
  ok(s.pieces[1][0] === -1, "撞子送回机场");
}
{
  let s = newState(1); s.pieces[0][0] = 50;
  s = apply(s, 2, 0);
  ok(cellOf(0, s.pieces[0][0]).type === "home", "progress52进归航道");
  let t = newState(1); t.pieces[0][0] = 56;
  t = apply(t, 2, 0);
  ok(cellOf(0, t.pieces[0][0]).type === "goal", "progress58到终点");
}
{
  let s = newState(1); s.pieces[0] = [57, 58, 58, 58];
  s = apply(s, 1, 0);
  ok(s.winner === 0, "4子全到终点→胜");
}
{
  let s = newState(3); s.pieces[0][0] = 12; s.turn = 2; s.dice = 5;
  ok(JSON.stringify(parse(serialize(s))) === JSON.stringify(s), "FEN往返一致");
}
{
  const s = newState(4);
  ok(s.pieces.every(a => a && a.length === 4), "4人局4色各4子");
  ok(newState(1).n === 1 && newState(1).pieces.filter(Boolean).length === 1, "1人局只有1色");
}

console.log(`\n结果：${pass} 通过 / ${pass + fail} 项，${fail} 失败`);
process.exit(fail ? 1 : 0);
