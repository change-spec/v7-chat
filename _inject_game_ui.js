// ===== 棋类前端：棋盘渲染 + 走子交互 + 与服务端同步 =====
// 本块被注入到 public/index.html 主脚本（IIFE）内部，可直接访问 currentGame / appendSys / api
  // ---------- 状态 ----------
  var cb = null;          // { type, roomId, G, st, sel, moves, mySide, over, keys, lastMove, view }
  var cbFlip = false;     // 翻转棋盘

  function cbSideLabel(side) {
    if (!cb) return '';
    return cb.type === 'xiangqi' ? (side === 0 ? '红方' : '黑方') : (side === 0 ? '白方' : '黑方');
  }
  function cbMySide() {
    if (!currentGame) return 0;
    return currentGame.iAmCreator ? 0 : 1;
  }
  function cbIsMine(piece) {
    if (piece === '.') return false;
    var up = piece >= 'A' && piece <= 'Z';
    return cbMySide() === 0 ? up : !up;
  }

  // 显示顺序 → 真实格索引（棋盘可上下翻转；国际象棋同时左右翻转）
  function cbBuildView() {
    var G = cb.G, out = [];
    for (var r = 0; r < G.rows; r++) {
      for (var c = 0; c < G.cols; c++) {
        var dr = cbFlip ? (G.rows - 1 - r) : r;
        var dc = (cbFlip && cb.type !== 'xiangqi') ? (G.cols - 1 - c) : c;
        var idx = G.idx(dr, dc);
        out.push({ r: dr, c: dc, idx: idx, piece: cb.st.b[idx] });
      }
    }
    return out;
  }

  // ---------- 渲染 ----------
  function cbRender() {
    if (!cb) return;
    var G = cb.G;
    var area = document.getElementById('boardArea');
    if (!area) return;
    if (!document.getElementById('cbWrap')) {
      area.innerHTML =
        '<div class="cb-wrap" id="cbWrap">' +
          '<div class="cb-bar" id="cbBar"></div>' +
          '<div class="cb-stage" id="cbStage">' +
            '<div class="cb-board" id="cbBoard"></div>' +
            '<svg class="cb-overlay" id="cbOverlay"></svg>' +
          '</div>' +
          '<div class="cb-tip" id="cbTip"></div>' +
          '<div class="tool-row" style="justify-content:center;margin:0">' +
            '<button class="btn small" id="cbFlipBtn" type="button">🔄 翻转棋盘</button>' +
            '<button class="btn small magenta" id="cbGiveUpBtn" type="button">🏳️ 认输</button>' +
          '</div>' +
        '</div>';
      document.getElementById('cbFlipBtn').addEventListener('click', function () {
        cbFlip = !cbFlip;
        cbRender();
      });
      document.getElementById('cbGiveUpBtn').addEventListener('click', function () {
        cbGiveUp();
      });
    }
    var board = document.getElementById('cbBoard');
    board.className = 'cb-board ' + (cb.type === 'xiangqi' ? 'cb-xq' : 'cb-chess');
    board.style.gridTemplateColumns = 'repeat(' + G.cols + ', 1fr)';
    board.innerHTML = '';
    cb.view = cbBuildView();
    var targets = {};
    if (cb.sel !== null && cb.moves) {
      for (var mi = 0; mi < cb.moves.length; mi++) {
        if (cb.moves[mi].from === cb.sel) targets[cb.moves[mi].to] = cb.moves[mi];
      }
    }
    for (var i = 0; i < cb.view.length; i++) {
      var cell = cb.view[i];
      var el = document.createElement('div');
      el.className = 'cb-cell ' + ((cell.r + cell.c) % 2 === 0 ? 'light' : 'dark');
      el.setAttribute('data-i', String(i));
      if (cb.sel !== null && cell.idx === cb.sel) el.classList.add('sel');
      if (cb.lastMove && (cell.idx === cb.lastMove.from || cell.idx === cb.lastMove.to)) el.classList.add('last');
      if (targets[cell.idx]) {
        var mk = document.createElement('i');
        mk.className = targets[cell.idx].cap ? 'cap' : 'dot';
        el.appendChild(mk);
      }
      if (cell.piece !== '.') {
        var p = document.createElement('span');
        p.className = 'cb-piece ' + (cbIsMine(cell.piece) ? 'up' : 'dn');
        p.textContent = G.glyph[cell.piece] || cell.piece;
        el.appendChild(p);
      }
      (function (ii) { el.addEventListener('click', function () { cbClick(ii); }); })(i);
      board.appendChild(el);
    }
    cbPaintOverlay();
    cbUpdateBar();
  }

  // 中国象棋：画九宫斜线与「楚河 汉界」
  function cbPaintOverlay() {
    var svg = document.getElementById('cbOverlay');
    if (!svg) return;
    svg.innerHTML = '';
    if (cb.type !== 'xiangqi') return;
    var board = document.getElementById('cbBoard');
    var stage = document.getElementById('cbStage');
    if (!board || !stage) return;
    var cells = board.children;
    if (!cells.length) return;
    svg.style.width = board.offsetWidth + 'px';
    svg.style.height = board.offsetHeight + 'px';
    var h = cells[0].offsetHeight;
    function seg(x1, y1, x2, y2) {
      var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      svg.appendChild(l);
    }
    // 九宫斜线：显示行 0-2（上方）与 7-9（下方），列 3-5
    [0, 7].forEach(function (r0) {
      var a = cells[r0 * 9 + 3], b = cells[r0 * 9 + 5];
      var c = cells[(r0 + 2) * 9 + 3], d = cells[(r0 + 2) * 9 + 5];
      if (a && b && c && d) {
        seg(a.offsetLeft + a.offsetWidth / 2, a.offsetTop + a.offsetHeight / 2,
            d.offsetLeft + d.offsetWidth / 2, d.offsetTop + d.offsetHeight / 2);
        seg(b.offsetLeft + b.offsetWidth / 2, b.offsetTop + b.offsetHeight / 2,
            c.offsetLeft + c.offsetWidth / 2, c.offsetTop + c.offsetHeight / 2);
      }
    });
    // 楚河 汉界
    var old = stage.querySelector('.cb-river');
    if (old) old.remove();
    var river = document.createElement('div');
    river.className = 'cb-river';
    river.style.top = (4 * h + 3) + 'px';
    river.innerHTML = '<span>楚 河</span><span>汉 界</span>';
    stage.appendChild(river);
  }

  function cbUpdateBar() {
    var bar = document.getElementById('cbBar');
    var tip = document.getElementById('cbTip');
    if (!bar) return;
    var G = cb.G;
    var mineTurn = cb.st.t === cbMySide();
    var parts = [];
    parts.push('<span>' + cbSideLabel(cb.st.t) + '走</span>');
    if (!cb.over) {
      if (G.inCheck(cb.st)) parts.push('<span class="warn">⚠ 将军！</span>');
      parts.push('<span>' + (mineTurn ? '轮到你' : '等待对手') + '</span>');
    }
    bar.innerHTML = parts.join('');
    if (tip) tip.textContent = cb.over ? '' : (mineTurn ? '点你的棋子 → 点高亮的目标格走棋' : '对手正在思考…');
  }

  // ---------- 交互 ----------
  function cbClick(i) {
    if (!cb || cb.over) return;
    var cell = cb.view[i];
    var G = cb.G;
    if (cb.st.t !== cbMySide()) { appendSys('还没轮到你走'); return; }
    if (cb.sel !== null && cb.moves) {
      var mv = null;
      for (var k = 0; k < cb.moves.length; k++) {
        if (cb.moves[k].from === cb.sel && cb.moves[k].to === cell.idx) { mv = cb.moves[k]; break; }
      }
      if (mv) { cbDoMove(mv); return; }
    }
    var piece = cb.st.b[cell.idx];
    if (piece === '.' || !cbIsMine(piece)) { cb.sel = null; cb.moves = null; cbRender(); return; }
    cb.sel = cell.idx;
    cb.moves = G.legal(cb.st).filter(function (m) { return m.from === cell.idx; });
    cbRender();
  }

  function cbDoMove(mv) {
    var G = cb.G;
    // 升变默认升为后（引擎生成 4 种变体，取第一个即后）
    if (!mv.promo) {
      var pc = cb.st.b[mv.from];
      if (G.rows === 8 && pc.toUpperCase() === 'P') {
        var lastRow = cbMySide() === 0 ? 0 : 7;
        if (G.row(mv.to) === lastRow) mv = { from: mv.from, to: mv.to, piece: pc, cap: mv.cap, promo: 'Q', castle: null, ep: mv.ep };
      }
    }
    cb.st = G.apply(cb.st, mv);
    cb.sel = null;
    cb.moves = null;
    cb.lastMove = { from: mv.from, to: mv.to };
    if (G.key && cb.keys) cb.keys.push(G.key(cb.st));
    cbRender();
    cbCheckEnd();
    api('/api/game/move', { roomId: cb.roomId, board: G.toFen(cb.st) }).then(function (r) {
      if (!r.ok) {
        appendSys('走子未生效：' + ((r.data && r.data.error) || '未知错误'));
        cbReload();
      }
    }).catch(function () {
      appendSys('走子提交失败，请检查网络');
    });
  }

  function cbCheckEnd() {
    var G = cb.G;
    var s = G.status(cb.st, cb.keys);
    if (!s.over) return;
    cb.over = true;
    cb.sel = null;
    cb.moves = null;
    cbRender();
    var w = s.winner === 'draw' ? 'draw' : (s.winner === 0 ? 'a' : 'b');
    cbShowResult(s.result + (s.reason ? '（' + s.reason + '）' : ''));
    api('/api/game/end', { roomId: cb.roomId, winner: w, result: s.result }).catch(function () {});
  }

  function cbShowResult(text) {
    var wrap = document.getElementById('cbWrap');
    if (!wrap) return;
    var old = wrap.querySelector('.cb-result');
    if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'cb-result';
    d.textContent = '🏁 ' + text;
    wrap.appendChild(d);
    appendSys('棋局结束 · ' + text);
  }

  function cbGiveUp() {
    if (!cb || cb.over) return;
    cb.over = true;
    cbShowResult(cbMySide() === 0 ? '房主认输' : '认输');
    var w = cbMySide() === 0 ? 'b' : 'a';
    api('/api/game/end', { roomId: cb.roomId, winner: w, result: '认输' }).catch(function () {});
  }

  function cbReload() {
    if (!cb) return;
    api('/api/game/state?roomId=' + encodeURIComponent(cb.roomId)).then(function (r) {
      if (r.ok && r.data && r.data.game && r.data.game.board) {
        cb.st = cb.G.parse(r.data.game.board);
        cb.sel = null;
        cb.moves = null;
        cbRender();
      }
    }).catch(function () {});
  }

  // 初始化/进入棋局
  function cbInit(type, roomId) {
    var GE = window.GameEngine;
    if (!GE) { appendSys('棋类引擎未加载'); return; }
    var G = GE.for(type);
    cb = {
      type: type, roomId: roomId, G: G,
      st: G.parse(G.start),
      sel: null, moves: null,
      mySide: cbMySide(),
      over: false, keys: [], lastMove: null, view: null
    };
    cbRender();
    api('/api/game/state?roomId=' + encodeURIComponent(roomId)).then(function (r) {
      if (!r.ok || !r.data || !r.data.game) return;
      var g = r.data.game;
      if (g.board) cb.st = G.parse(g.board);
      if (g.winner) {
        cb.over = true;
        cbRender();
        cbShowResult(g.winner === 'draw' ? '和棋' : (g.winner === currentGame.creator ? '房主胜' : '对手胜'));
      } else {
        cbRender();
      }
    }).catch(function () {});
  }

  // 对方走子
  function cbApplyRemote(board) {
    if (!cb) return;
    cb.st = cb.G.parse(board);
    cb.sel = null;
    cb.moves = null;
    cb.lastMove = null;
    cbRender();
  }

  // 收到开局通知
  function cbOnStart(board) {
    if (!cb) return;
    if (board) cb.st = cb.G.parse(board);
    cb.over = false;
    cb.keys = [];
    cb.lastMove = null;
    cbRender();
  }

  // 收到结束通知
  function cbOnEnd(winner, result) {
    if (!cb) return;
    cb.over = true;
    cb.sel = null;
    cb.moves = null;
    cbRender();
    var txt = result || (winner === 'draw' ? '和棋' : '棋局结束');
    cbShowResult(txt);
  }
