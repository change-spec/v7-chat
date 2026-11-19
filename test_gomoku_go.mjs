// 五子棋/围棋引擎单元测试：从 public/index.html 提取 <script id="gameEngine"> 求值
import fs from 'fs';
import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const m = html.match(/<script id="gameEngine">([\s\S]*?)<\/script>/);
if (!m) { console.error('未找到 gameEngine'); process.exit(2); }
(0, eval)(m[1]);
const GE = globalThis.GameEngine;
const G5 = GE.gomoku, GO = GE.go;

let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } }
function eq(a, b, n) { ok(a === b, n + '（期望 ' + b + '）', a); }

console.log('===== 五子棋 =====');
ok(!!G5, '引擎已注册');
eq(G5.rows, 15, '棋盘 15 路');
let st = G5.parse('');
eq(st.b.length, 225, '空盘 225 点');
eq(st.t, 0, '黑先');
// 连五判胜：黑在第 7 行横连 5
st = G5.parse('15/15/15/15/15/15/5XXXXX5/15/15/15/15/15/15/15 b');
let s = G5.status(st);
ok(s.over && s.winner === 0, '横向连五 → 黑胜', s);
// 竖连五
st = G5.parse('7X7/7X7/7X7/7X7/7X7/15/15/15/15/15/15/15/15/15 b');
s = G5.status(st);
ok(s.over && s.winner === 0, '纵向连五 → 黑胜', s);
// 斜连五
st = G5.parse('15/8X6/9X5/10X4/11X3/12X2/13X1/15/15/15/15/15/15/15 b');
s = G5.status(st);
ok(s.over && s.winner === 0, '斜向连五 → 黑胜', s);
// 只有四子不算胜
st = G5.parse('15/15/15/15/15/15/5XXXX6/15/15/15/15/15/15/15 b');
ok(!G5.status(st).over, '连四未胜');
// 落子与轮转
st = G5.parse('');
let st2 = G5.apply(st, { to: G5.idx(7,7), put: 0 });
eq(st2.b[G5.idx(7,7)], 'X', '落子生效');
eq(st2.t, 1, '轮到白方');
// FEN 往返
eq(G5.toFen(G5.parse(G5.toFen(st2))), G5.toFen(st2), 'FEN 往返一致');

console.log('');
console.log('===== 围棋（中国规则） =====');
ok(!!GO, '引擎已注册');
eq(GO.rows, 19, '棋盘 19 路');
let g = GO.parse('');
eq(g.b.length, 361, '空盘 361 点');
eq(g.t, 0, '黑先');

// 提子：黑包围白一子（白在 (0,1)，黑在 (0,0)(0,2)(1,1)）
g = GO.parse('XO X/19/19/19/19/19/19/19/19/19/19/19/19/19/19/19/19/19/19 w');
// 上面 FEN 有空格会解析错，直接构造局面
g = GO.parse('');
g.b[GO.idx(0,1)] = 'O';
g.b[GO.idx(0,0)] = 'X';
g.b[GO.idx(0,2)] = 'X';
g.b[GO.idx(1,1)] = 'X';
g.t = 0;
// 补最后一气：黑下 (1,1) 已提？ 现在白 (0,1) 气只有 (1,1) 已被黑占 → 应已被提。
// 换构造：白 (0,1) 气 = (0,0),(0,2),(1,1)。先占两气，黑下第三气提子。
g = GO.parse('');
g.b[GO.idx(0,1)] = 'O';
g.b[GO.idx(0,0)] = 'X';
g.b[GO.idx(0,2)] = 'X';
g.t = 0;
let captured = GO.apply(g, { to: GO.idx(1,1), put: 0 });
eq(captured.b[GO.idx(0,1)], '.', '落子提掉无气白子');
eq(captured.b[GO.idx(1,1)], 'X', '落子本身保留');

// 自杀手非法：白在黑阵中央落子且无提子
g = GO.parse('');
[[0,1],[1,0],[1,2],[2,1]].forEach(([r,c]) => g.b[GO.idx(r,c)] = 'X');
g.b[GO.idx(1,1)] = '.';
g.t = 1;
ok(GO.try === undefined || true, '（内部 try 不导出，以下用 apply 行为验证）');
let suicide = GO.apply(g, { to: GO.idx(1,1), put: 1 });
eq(suicide, g, '自杀手被拒（局面不变）');

// pass 两次终局（经 FEN 往返，验证 passes 跨用户同步）
g = GO.parse('');
let g1 = GO.apply(g, { pass: true, put: 0 });
let g2 = GO.parse(GO.toFen(g1));            // 模拟对手从服务端拿到 FEN
ok(GO.status(g2).over === false, '一次 pass 后经 FEN 往返仍未终局');
let g3 = GO.apply(g2, { pass: true, put: 1 });
g3 = GO.parse(GO.toFen(g3));                // 再往返一次
ok(GO.status(g3).over, '双方连续 pass 经 FEN 往返 → 终局（对手端也能判定）');
eq(GO.status(g3).winner, 1, '空盘 + 黑贴 7.5 → 白胜');

// 中国规则计分：黑占满全盘 → 黑胜
g = GO.parse('');
g.b.fill('X');
let sc = GO.score(g);
eq(sc.winner, 0, '黑占全盘 → 黑胜');
ok(sc.margin > 0, '黑胜目数为正', sc);

// 围空计分：黑沿 row6 铺满、白沿 row12 铺满 → 上空白全归黑、下空白全归白
g = GO.parse('');
for (let c = 0; c < 19; c++) { g.b[GO.idx(6,c)] = 'X'; g.b[GO.idx(12,c)] = 'O'; }
sc = GO.score(g);
eq(sc.black, 19 + 114, '黑 19 子 + 上方 114 空');
eq(sc.white, 19 + 114 + 7.5, '白 19 子 + 下方 114 空 + 7.5 贴目');
eq(sc.winner, 1, '地盘相等时贴目使白胜（中国规则）');

// FEN 往返
g = GO.parse('');
g.b[GO.idx(3,3)] = 'X'; g.b[GO.idx(15,15)] = 'O';
let fen = GO.toFen(g);
eq(GO.toFen(GO.parse(fen)), fen, 'FEN 往返一致');

console.log('');
console.log('===== 结果：' + pass + ' 通过 / ' + (pass + fail) + ' 项，' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);
