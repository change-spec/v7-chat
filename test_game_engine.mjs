// 棋类引擎单元测试：从 public/index.html 提取 <script id="gameEngine"> 并在 Node 中求值
// 用法：node test_game_engine.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const m = html.match(/<script id="gameEngine">([\s\S]*?)<\/script>/);
if (!m) { console.error('❌ 未找到 <script id="gameEngine"> 块'); process.exit(2); }
(0, eval)(m[1]);
const GE = globalThis.GameEngine;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → 实际: ' + JSON.stringify(extra) : '')); }
}
function eq(a, b, name) { ok(a === b, name + '（期望 ' + b + '）', a); }

// 用 from/to 找到合法走法并执行
function play(G, st, from, to) {
  const legal = G.legal(st);
  const mv = legal.find(m => m.from === from && m.to === to);
  if (!mv) return null;
  return { st: G.apply(st, mv), mv };
}
function findMove(G, st, from, to) {
  return G.legal(st).find(m => m.from === from && m.to === to) || null;
}
// 仅测「走法生成规则」时用伪合法走法（moves），避开 legal() 的王被将过滤
function findPseudo(G, st, from, to) {
  return G.moves(st).find(m => m.from === from && m.to === to) || null;
}
const idx = (G, r, c) => G.idx(r, c);

console.log('===== 国际象棋 =====');
{
  const C = GE.chess;
  const st0 = C.parse(C.start);
  eq(C.toFen(st0), C.start, '初始局面 FEN 往返一致');
  eq(C.legal(st0).length, 20, '初始合法走法数（16 兵 + 4 马）');

  // 将死（愚人将）: 1.f3 e5 2.g4 Qh4#
  let st = st0;
  st = play(C, st, idx(C, 6, 5), idx(C, 5, 5)).st;   // f2-f3
  st = play(C, st, idx(C, 1, 4), idx(C, 3, 4)).st;   // e7-e5
  st = play(C, st, idx(C, 6, 6), idx(C, 4, 6)).st;   // g2-g4
  st = play(C, st, idx(C, 0, 3), idx(C, 4, 7)).st;   // Qd8-h4
  const s1 = C.status(st);
  ok(s1.over && s1.result === '黑方胜' && s1.reason === '将死', '愚人将 → 将死（黑方胜）', s1);

  // 逼和
  const stStal = C.parse('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const s2 = C.status(stStal);
  ok(s2.over && s2.result === '和棋' && s2.reason === '逼和', '逼和识别', s2);

  // 王车易位
  const stCast = C.parse('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  ok(!!findMove(C, stCast, idx(C, 7, 4), idx(C, 7, 6)), '白方短易位 e1→g1 可走');
  ok(!!findMove(C, stCast, idx(C, 7, 4), idx(C, 7, 2)), '白方长易位 e1→c1 可走');
  // 经过被攻击的格不允许易位：黑车 d8 沿 d 线攻击 d1
  const stCast2 = C.parse('3r1k2/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  ok(!findMove(C, stCast2, idx(C, 7, 4), idx(C, 7, 2)), '长易位途经 d1 被攻击 → 禁止');
  ok(!!findMove(C, stCast2, idx(C, 7, 4), idx(C, 7, 6)), '短易位未受威胁 → 仍可走');

  // 吃过路兵
  const stEp = C.parse('rnbqkbnr/1pp1pppp/p7/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2');
  ok(!!findMove(C, stEp, idx(C, 3, 4), idx(C, 2, 3)), '吃过路兵 e5×d6 可走');
  const epRes = play(C, stEp, idx(C, 3, 4), idx(C, 2, 3));
  eq(epRes.st.b[idx(C, 3, 3)], '.', '吃过路兵后被吃的黑兵消失');

  // 升变
  const stPro = C.parse('8/4P3/8/8/8/8/8/K6k w - - 0 1');
  const proMoves = C.legal(stPro).filter(m => m.from === idx(C, 1, 4) && m.to === idx(C, 0, 4));
  eq(proMoves.length, 4, '兵到底线有 4 种升变');
  ok(proMoves.every(m => ['Q', 'R', 'B', 'N'].includes(m.promo)), '升变目标为 后/车/象/马');

  // 送将过滤（钉子）：白王 e1、白马 e3 被黑车 e8 钉住
  const stPin = C.parse('k3r3/8/8/8/8/8/4N3/4K3 w - - 0 1');
  const pinMoves = C.legal(stPin).filter(m => m.from === idx(C, 6, 4));
  eq(pinMoves.length, 0, '被钉住的马无合法走法（送将被过滤）');

  // 车吃子（h 线通畅，白王在 e1 不挡路）
  const stRook = C.parse('4k2r/8/8/8/8/8/8/4K2R w - - 0 1');
  ok(!!findMove(C, stRook, idx(C, 7, 7), idx(C, 0, 7)), '车可沿 h 线吃掉黑车');

  // 子力不足
  const s3 = C.status(C.parse('4k3/8/8/8/8/8/8/4K3 w - - 0 1'));
  ok(s3.over && s3.result === '和棋' && s3.reason === '子力不足', '只剩双王 → 和棋', s3);
}

console.log('===== 中国象棋 =====');
{
  const X = GE.xiangqi;
  const st0 = X.parse(X.start);
  eq(X.toFen(st0), X.start, '初始局面 FEN 往返一致');
  eq(X.legal(st0).length, 44, '初始合法走法数（红方）');

  // 蹩马腿：显式摆红马 (5,1)，跳 (3,0) 的腿在 (4,1)
  let st = X.parse(X.start);
  st.b.fill('.');
  st.b[idx(X, 5, 1)] = 'N';
  st.b[idx(X, 4, 1)] = 'P';
  ok(!findPseudo(X, st, idx(X, 5, 1), idx(X, 3, 0)), '蹩马腿：马被堵时不可跳');
  st.b[idx(X, 4, 1)] = '.';
  ok(!!findPseudo(X, st, idx(X, 5, 1), idx(X, 3, 0)), '腿通畅时马可跳');

  // 塞象眼：显式摆红相 (5,2)，走田到 (7,4) 的眼在 (6,3)
  st = X.parse(X.start);
  st.b.fill('.');
  st.b[idx(X, 5, 2)] = 'B';
  st.b[idx(X, 6, 3)] = 'P';
  ok(!findPseudo(X, st, idx(X, 5, 2), idx(X, 7, 4)), '塞象眼：相被堵时不可走田');
  st.b[idx(X, 6, 3)] = '.';
  ok(!!findPseudo(X, st, idx(X, 5, 2), idx(X, 7, 4)), '眼通畅时相可走田');

  // 象不过河：红相 (5,2) 不能到 (3,4)（已过河）
  st = X.parse(X.start);
  ok(!findMove(X, st, idx(X, 5, 2), idx(X, 3, 4)), '相不可过河');

  // 炮需炮架：红炮 (7,1) 隔黑炮 (2,1) 打 (0,1) 的黑车
  st = X.parse(X.start);
  ok(!!findMove(X, st, idx(X, 7, 1), idx(X, 0, 1)), '炮隔子打（隔黑炮打黑车）');
  // 去掉炮架后，炮不能吃到黑车
  st = X.parse(X.start);
  st.b[idx(X, 2, 1)] = '.';
  ok(!findMove(X, st, idx(X, 7, 1), idx(X, 0, 1)), '无炮架时炮不能吃远子');

  // 兵过河可横行 / 未过河不可
  st = X.parse(X.start);
  st.b[idx(X, 6, 4)] = 'P';               // 红兵放在 row6（未过河）
  ok(!findMove(X, st, idx(X, 6, 4), idx(X, 6, 3)), '未过河的兵不能横行');
  st.b[idx(X, 6, 4)] = '.';
  st.b[idx(X, 4, 4)] = 'P';               // 放到 row4（已过河）
  ok(!!findMove(X, st, idx(X, 4, 4), idx(X, 4, 3)), '过河后的兵可横行');

  // 兵不能直着吃子（国际象棋兵的规则，弈错）：黑卒 (5,4) 前方 (6,4) 是红车 → 不可直吃
  st = X.parse(X.start);
  st.b.fill('.');
  st.b[idx(X, 5, 4)] = 'p';
  st.b[idx(X, 6, 4)] = 'R';
  st.b[idx(X, 0, 4)] = 'k';          // 需有黑将：xLegal 以「己方王仍在」为前提过滤走法
  st.t = 1;
  ok(!findPseudo(X, st, idx(X, 5, 4), idx(X, 6, 4)), '兵不可直着吃子');
  // 兵可斜前吃子：黑卒 (5,4) 斜吃 (6,3) 的红车
  st.b[idx(X, 6, 3)] = 'R';
  ok(!!findPseudo(X, st, idx(X, 5, 4), idx(X, 6, 3)), '兵可斜前吃子');

  // 帅不出九宫：清空第 10 横线，红帅放 (9,4)
  st = X.parse(X.start);
  st.b.fill('.');
  st.b[idx(X, 9, 4)] = 'K';
  ok(!!findMove(X, st, idx(X, 9, 4), idx(X, 8, 4)), '帅可上下走（在九宫内）');
  ok(!!findMove(X, st, idx(X, 9, 4), idx(X, 9, 5)), '帅可在九宫内横走');
  ok(!findMove(X, st, idx(X, 9, 4), idx(X, 9, 6)), '帅不可出九宫（第 7 列）');
  ok(!findMove(X, st, idx(X, 9, 4), idx(X, 9, 2)), '帅不可出九宫（第 3 列）');
  ok(!!findMove(X, st, idx(X, 9, 4), idx(X, 9, 3)), '帅可走到九宫边线（第 4 列）');

  // 将死：红双车将死黑将
  st = X.parse(X.start);
  st.b.fill('.');
  st.b[idx(X, 0, 4)] = 'k';
  st.b[idx(X, 0, 3)] = 'R';
  st.b[idx(X, 1, 3)] = 'R';
  st.t = 1;
  const s1 = X.status(st);
  ok(s1.over && s1.result === '红方胜' && s1.reason === '将死', '双车绝杀 → 将死', s1);

  // 困毙判负（无子可走且未被将）
  st = X.parse(X.start);
  st.b.fill('.');
  st.b[idx(X, 0, 4)] = 'k';
  st.b[idx(X, 0, 3)] = 'p';
  st.b[idx(X, 1, 3)] = 'R';
  st.b[idx(X, 2, 5)] = 'R';
  st.t = 1;
  const s2 = X.status(st);
  ok(s2.over && s2.result === '红方胜' && s2.reason === '困毙', '困毙 → 判负', s2);

  // 送将过滤：红帅 (9,4) 在九宫内，被黑车 (5,4) 将军 → 帅不能沿 d 线上下移动，但可横向脱线
  st = X.parse(X.start);
  st.b.fill('.');
  st.b[idx(X, 0, 4)] = 'k';
  st.b[idx(X, 5, 4)] = 'r';
  st.b[idx(X, 9, 4)] = 'K';
  st.t = 0;
  const kMoves = X.legal(st).filter(m => m.from === idx(X, 9, 4));
  ok(!kMoves.some(m => m.to === idx(X, 8, 4)), '被将军时帅不能上行（仍在将军线上）');
  ok(kMoves.some(m => m.to === idx(X, 9, 3)), '被将军时帅可横向脱线');
  ok(kMoves.some(m => m.to === idx(X, 9, 5)), '被将军时帅可另一侧横向脱线');
}

console.log('===== 通用 =====');
{
  ok(typeof GE.for === 'function', 'GE.for 类型分发可用');
  eq(GE.for('chess').rows, 8, '国际象棋 8 行');
  eq(GE.for('xiangqi').rows, 10, '中国象棋 10 行');
  eq(GE.for('xiangqi').cols, 9, '中国象棋 9 列');
}

console.log(`\n===== 结果：${pass} 通过 / ${pass + fail} 项，${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
