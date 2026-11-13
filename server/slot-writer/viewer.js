/* Wall full-screen viewer. Served by slot-writer at /wall/viewer.js; each tile's bootstrap loads it once per Grafana page.
 * Tile text is untrusted and Grafana's HTML sanitizer is off on this wall, so everything is built with DOM APIs and textContent
 * (never innerHTML). Charts are real SVG drawn at the overlay's pixel size and redrawn on resize, which is what makes every view fit. */
(function () {
  if (window.wallOpen) return;
  var LIVE_SRC = document.currentScript && document.currentScript.src;     // only set while the script first runs; the live poller needs it later
  var NS = 'http://www.w3.org/2000/svg';
  var D = null, cur = null, overlay = null, stack = [], observers = [], tipEl = null;

  // ---------------------------------------------------------------- helpers
  function el(tag, css, text, parent) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== null && text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function sv(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function col() { return D.colors; }
  function hold(on) { try { window.parent.postMessage({ wallHold: !!on }, '*'); } catch (e) { /* standalone page */ } }
  function fmtV(v) { return String(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100); }
  function fmtAx(v) { return Math.abs(v) >= 10000 ? (Math.round(v / 10) / 100) + 'k' : fmtV(v); }   // real values: 84134 -> 84.13k; mirrors app.py fmt_ax
  function fitAxis(vals) {        // mirrors app.py fit_axis: hi = lo + 2 round ticks (1/2/2.5/4/5 x 10^k) covering the data with a 3% margin
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), span = (mx - mn) || Math.max(Math.abs(mx) * 0.01, 1), pad = span * 0.03;
    var e0 = Math.floor(Math.log(span / 2) / Math.LN10) - 1, M = [1, 2, 2.5, 4, 5];
    for (var e = e0; e < e0 + 5; e++) for (var i = 0; i < M.length; i++) {
      var u = M[i] * Math.pow(10, e), lo = Math.floor((mn - pad) / u) * u;
      if (lo + 2 * u >= mx + pad) return [lo, lo + 2 * u];
    }
    return [mn, mx + span];
  }
  function pct(v) { return (Math.round(v * 10) / 10) + '%'; }
  function fmtT(t, spanS) {
    var d = new Date(t * 1000), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return spanS > 2 * 86400 ? (d.getMonth() + 1) + '/' + d.getDate() : p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function niceMax(v) {
    var n = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 100000, 1000000];
    for (var i = 0; i < n.length; i++) if (v <= n[i]) return n[i];
    return Math.ceil(v);
  }
  function kpiColor(s) { return s === 'bad' ? col().health.down : s === 'warn' ? col().health.degraded : s === 'ok' ? col().health.up : col().text; }

  // ---------------------------------------------------------------- tooltips, icons, cards
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
  function floatTip(text, x, y) {
    hideTip();
    tipEl = el('div', 'position:fixed;z-index:2147483600;left:0;top:0;max-width:34vw;padding:.8vh .9vw;border-radius:8px;background:#0b1830;border:1px solid ' + col().accent +
      ';color:' + col().text + ';font:1.9vh/1.35 Inter,"Segoe UI",Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.6);pointer-events:none;overflow-wrap:anywhere', text, document.body);
    tipEl.setAttribute('data-wl-tip', '1');
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    tipEl.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  }
  function tip(node, text) {
    if (!text) return;
    node.addEventListener('mouseenter', function () { var r = node.getBoundingClientRect(); floatTip(text, r.left, r.bottom + 6); });
    node.addEventListener('mouseleave', hideTip);
  }
  function icon(parent, text) {
    var i = el('span', 'display:inline-flex;align-items:center;justify-content:center;width:2.4vh;height:2.4vh;flex:none;border-radius:50%;border:1px solid ' + col().muted +
      ';color:' + col().muted + ';font-size:1.6vh;font-weight:700;cursor:help', 'i', parent);
    i.setAttribute('data-wl-i', '1');
    tip(i, text);
    return i;
  }
  function card(parent, css, onClick) {
    var b = el('div', 'box-sizing:border-box;border:1px solid #1f5fae;border-radius:10px;background:rgba(31,95,174,.10);padding:1.2vh 1.2vw;transition:all .15s;' + (css || ''), null, parent);
    if (onClick) {
      b.style.cursor = 'pointer';
      b.setAttribute('data-wl-click', '1');
      b.addEventListener('mouseenter', function () { b.style.borderColor = col().accent; b.style.background = 'rgba(77,163,255,.20)'; b.style.boxShadow = '0 0 14px rgba(77,163,255,.5)'; });
      b.addEventListener('mouseleave', function () { b.style.borderColor = '#1f5fae'; b.style.background = 'rgba(31,95,174,.10)'; b.style.boxShadow = 'none'; });
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
    }
    return b;
  }
  function btn(parent, text, fn) {
    var b = el('div', 'flex:none;padding:.8vh 1.2vw;border:1px solid #1f5fae;border-radius:8px;font-size:2vh;letter-spacing:.1em;color:' + col().muted + ';cursor:pointer;transition:all .15s', text, parent);
    b.setAttribute('data-wl-btn', '1');
    b.addEventListener('mouseenter', function () { b.style.borderColor = col().accent; b.style.color = col().text; });
    b.addEventListener('mouseleave', function () { b.style.borderColor = '#1f5fae'; b.style.color = col().muted; });
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    return b;
  }
  function section(parent, text) { return el('div', 'flex:none;font-size:1.7vh;letter-spacing:.16em;color:' + col().muted, text, parent); }
  function label(parent, text) { return el('div', 'font-size:1.6vh;letter-spacing:.12em;color:' + col().muted, text, parent); }

  // ---------------------------------------------------------------- frame / lifecycle
  function tri(parent, up, h) {          // small solid white triangle (CSS borders, no glyph): upright = up, upside-down = down
    var t = el('span', 'display:inline-block;flex:none;width:0;height:0;border-left:' + (h * 0.62) + 'vh solid transparent;border-right:' + (h * 0.62) + 'vh solid transparent;' +
      (up ? 'border-bottom:' : 'border-top:') + h + 'vh solid #ffffff', null, parent);
    t.setAttribute('data-wl-tri', up ? 'up' : 'down');
    return t;
  }
  function frame(title, sub, pillColor, pillText, pillTri) {
    close(true);
    overlay = el('div', 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;box-sizing:border-box;padding:2.4vh 2.2vw;display:flex;flex-direction:column;gap:1.8vh;' +
      'overflow:hidden;overflow-wrap:anywhere;background:linear-gradient(165deg,#050c16,#0a1626);color:' + col().text + ';font-family:Inter,"Segoe UI",Arial,sans-serif', null, document.body);
    overlay.setAttribute('data-wl-overlay', '1');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    var head = el('div', 'flex:none;display:flex;align-items:center;gap:1.4vw;min-width:0', null, overlay);
    if (stack.length) btn(head, '← BACK', function () { show(D, stack.pop(), false); });
    el('div', 'font-size:4.2vh;font-weight:700;letter-spacing:.02em;min-width:0', title, head);
    if (pillText && pillTri) {
      var pl = el('div', 'flex:none;display:flex;align-items:center;gap:.7vw;padding:.6vh 1.4vw;border-radius:2.6vh;background:' + pillColor + ';color:#fff;font-size:3vh;font-weight:800;letter-spacing:.04em;max-width:30vw', null, head);
      pl.setAttribute('data-wl-pill', '1');
      tri(pl, pillTri === 'up', 1.8);
      el('span', null, pillText, pl);
    } else if (pillText) el('div', 'flex:none;padding:.5vh 1.2vw;border-radius:2.4vh;background:' + pillColor + ';color:#fff;font-size:2.2vh;font-weight:700;letter-spacing:.12em;max-width:30vw', pillText, head);
    if (sub) el('div', 'font-size:2.2vh;color:' + col().muted + ';min-width:0', sub, head);
    el('div', 'flex:1', null, head);
    btn(head, 'ESC  ✕', close);
    return el('div', 'flex:1;min-height:0;display:flex;gap:1.6vw', null, overlay);
  }
  function close(keep) {
    observers.forEach(function (o) { o.disconnect(); });
    observers = [];
    hideTip();
    if (overlay) { overlay.remove(); overlay = null; }
    if (!keep) { stack = []; cur = null; hold(false); }
  }
  function show(data, target, push) {
    D = data;
    if (push && cur) stack.push(cur);
    cur = target;
    hold(true);
    try { render(target); } catch (e) { cur = null; close(); if (window.console) console.error('wall viewer', e); }
  }
  function render(t) {
    var p = String(t).split(':'), k = p[0], i = +p[1], j = +p[2];
    if (D.kind === 'grid') {
      if (k === 'cell' && D.cells && D.cells[i] && !D.cells[i].empty) return cellView(i);
      throw new Error('no such grid cell');                    // show() closes the overlay: an empty or unknown cell does nothing
    }
    if (k === 'chart' && D.charts[i]) return chartView(i);
    if (k === 'stat' && D.stats[i]) return itemView('stat', D.stats[i]);
    if (k === 'health' && D.health[i]) return itemView('health', D.health[i]);
    if (k === 'kpi' && D.charts[i] && D.charts[i].kpis[j]) return itemView('kpi', D.charts[i].kpis[j], D.charts[i]);
    return squareView();
  }

  // ---------------------------------------------------------------- charts
  function summarize(pts) {
    if (!pts || !pts.length) return null;
    var s = { n: pts.length, sum: 0, max: -Infinity, min: Infinity, zero: 0, last: pts[pts.length - 1][1] };
    pts.forEach(function (p) { var v = p[1]; s.sum += v; if (v > s.max) s.max = v; if (v < s.min) s.min = v; if (v === 0) s.zero++; });
    s.avg = s.sum / s.n; s.zeroPct = 100 * s.zero / s.n;
    return s;
  }
  function worst(pts, k) {
    return pts.map(function (p) { return { t: p[0], v: p[1] }; }).filter(function (x) { return x.v > 0; })
      .sort(function (a, b) { return b.v - a.v || b.t - a.t; }).slice(0, k);
  }
  // Calendar heat-map (kind 'calendar'): one cell per day, Sun..Sat columns by week rows, brightness = value. Points are one per day with the
  // epoch at local noon, so UTC date parts are the local date. Same colour ramp as the server's calendar_img.
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var CAL_ZERO = [15, 29, 54], CAL_MAX = [56, 166, 92], CAL_FULL = 100;    // 0 commits = dark blue, 100 or more = neutral green (same ramp as the server's cal_fill)
  function calFill(v) {
    var t = Math.min(Math.max(v, 0) / CAL_FULL, 1);
    return { fill: 'rgb(' + CAL_ZERO.map(function (a, i) { return Math.round(a + (CAL_MAX[i] - a) * t); }).join(',') + ')', dark: t >= 0.5 };
  }
  function dayKey(t) { return Math.floor(t / 86400); }                    // UTC day number of an epoch
  function dayLabel(dn) { var d = new Date(dn * 86400000); return DAYS[d.getUTCDay()] + ' ' + MONS[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function drawCalendar(wrap, W, H, pts, ch) {
    var c = col(), byDay = {};
    pts.forEach(function (p) { byDay[dayKey(p[0])] = p[1]; });
    var keys = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });
    var d0 = keys[0], d1 = keys[keys.length - 1];
    var f = new Date(d0 * 86400000), first = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1) / 86400000;
    var l = new Date(d1 * 86400000), end = Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + 1, 0) / 86400000;
    var start = first - new Date(first * 86400000).getUTCDay();             // Sunday on/before the 1st of the first month
    var rows = Math.floor((end - start) / 7) + 1;
    var labW = 72, hdr = 26, legH = 30, cw = (W - labW) / 7, chh = (H - hdr - legH) / rows;
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H }, wrap);
    svg.style.cssText = 'position:absolute;left:0;top:0;display:block';
    DAYS.forEach(function (d, i) { sv('text', { x: labW + (i + 0.5) * cw, y: 18, 'text-anchor': 'middle', fill: c.muted, 'font-size': 16 }, svg).textContent = d; });
    var fsN = Math.max(Math.min(chh * 0.5, 28), 10), fsD = Math.max(Math.min(chh * 0.32, 15), 9);
    for (var r = 0; r < rows; r++) {
      var rowStart = start + r * 7;
      if (rowStart + 6 >= first && rowStart <= end) {
        var rd = new Date(Math.max(rowStart, first) * 86400000);
        sv('text', { x: labW - 10, y: hdr + r * chh + chh / 2 + 5, 'text-anchor': 'end', fill: c.muted, 'font-size': 15 }, svg).textContent = MONS[rd.getUTCMonth()] + ' ' + rd.getUTCDate();
      }
      for (var k = 0; k < 7; k++) {
        var dn = rowStart + k;
        if (dn < first || dn > end) continue;
        var x = labW + k * cw + 2, y = hdr + r * chh + 2, has = byDay[dn] !== undefined, v = has ? byDay[dn] : 0;
        var fc = calFill(v);                                                    // every day of the month is a square; days still to come are empty ones
        var rect = sv('rect', { x: x, y: y, width: cw - 4, height: chh - 4, rx: 5, fill: fc.fill, stroke: dn === d1 ? '#ffffff' : '#1d3050', 'stroke-width': dn === d1 ? 2.5 : 1 }, svg);
        var tc = fc.dark ? '#06101f' : '#ffffff';
        sv('text', { x: x + 7, y: y + fsD + 4, fill: has ? tc : c.muted, 'fill-opacity': has ? 0.85 : 0.5, 'font-size': fsD }, svg).textContent = new Date(dn * 86400000).getUTCDate();   // day number: top-left corner
        if (has && v > 0) {                                                     // commit count: small bordered badge, bottom-right
          var lab = fmtV(v), tw = lab.length * fsN * 0.62 + 16, bh = fsN + 10, bx = x + cw - 4 - 10 - tw, by = y + chh - 4 - 8 - bh;
          sv('rect', { x: bx, y: by, width: tw, height: bh, rx: 6, fill: 'none', stroke: tc, 'stroke-opacity': 0.8, 'stroke-width': 1.5 }, svg);
          sv('text', { x: bx + tw / 2, y: by + bh / 2 + fsN * 0.36, 'text-anchor': 'middle', fill: tc, 'font-size': fsN, 'font-weight': 700 }, svg).textContent = lab;
        }
        if (has) (function (dn2, v2) {
          rect.addEventListener('mousemove', function (e) { floatTip(dayLabel(dn2) + ' — ' + fmtV(v2) + (ch.subtitle ? ' (' + ch.subtitle + ')' : ''), e.clientX + 14, e.clientY - 44); });
          rect.addEventListener('mouseleave', hideTip);
        })(dn, v);
      }
    }
    sv('text', { x: labW, y: H - 8, fill: c.muted, 'font-size': 14 }, svg).textContent = 'less';
    for (var s = 0; s < 5; s++) sv('rect', { x: labW + 44 + s * 24, y: H - 22, width: 18, height: 18, rx: 4, fill: calFill(CAL_FULL * s / 4).fill, stroke: '#1d3050' }, svg);
    sv('text', { x: labW + 44 + 5 * 24 + 4, y: H - 8, fill: c.muted, 'font-size': 14 }, svg).textContent = 'more (0 to ' + CAL_FULL + '+ commits)';
  }
  function drawChart(area, pts, ch) {
    var c = col(), wrap = el('div', 'position:relative;width:100%;height:100%', null, area);
    function paint() {
      hideTip();
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      var W = wrap.clientWidth, H = wrap.clientHeight;
      if (W < 60 || H < 40) return;
      if (!pts || !pts.length) { el('div', 'position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;color:' + c.muted + ';font-size:2.2vh', 'No data in this window', wrap); return; }
      if (ch.kind === 'calendar') return drawCalendar(wrap, W, H, pts, ch);
      var padL = 64, padR = 12, padT = 12, padB = 34, pw = W - padL - padR, ph = H - padT - padB;       // axis text is 16px: readable from across the room
      var vals = pts.map(function (p) { return p[1]; }), top = Math.max.apply(null, vals), n = pts.length, bar = ch.kind === 'bar';
      var ymax = ch.y_max ? (top <= ch.y_max ? ch.y_max : niceMax(top)) : niceMax(Math.max(top * 1.05, 1e-9));
      var bottom = Math.min.apply(null, vals), lo = 0;
      if (bottom < 0) { var M = niceMax(Math.max(top, -bottom) * 1.05); lo = -M; ymax = top > 0 ? M : 0; }   // negative values (P&L): a symmetric clean axis; lo = 0 keeps every non-negative chart as before
      if (ch.y_fit) { var fa = fitAxis(vals); lo = fa[0]; ymax = fa[1]; }                                     // real values: fit the axis to the data instead of starting at 0
      var X = function (i) { return padL + (bar ? pw * (i + 0.5) / n : (n === 1 ? pw / 2 : pw * i / (n - 1))); };
      var Y = function (v) { return padT + ph * (1 - (Math.max(Math.min(v, ymax), lo) - lo) / (ymax - lo)); };
      var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H }, wrap);
      svg.style.cssText = 'position:absolute;left:0;top:0;display:block';
      for (var g = 0; g <= 4; g++) {
        var gy = padT + ph * g / 4;
        sv('line', { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: g === 4 ? '#2a4a7a' : '#1d3050' }, svg);
        sv('text', { x: padL - 8, y: gy + 5, 'text-anchor': 'end', fill: c.muted, 'font-size': 16 }, svg).textContent = (ch.y_fit ? fmtAx : fmtV)(lo + (ymax - lo) * (1 - g / 4));
      }
      if (lo < 0) sv('line', { x1: padL, x2: W - padR, y1: Y(0), y2: Y(0), stroke: '#8fa6c8', 'stroke-dasharray': '4 4' }, svg);
      var span = pts[n - 1][0] - pts[0][0];
      for (var k = 0; k <= 4 && n > 1; k++) {
        var xi = Math.round((n - 1) * k / 4);
        sv('text', { x: X(xi), y: H - 9, 'text-anchor': k === 0 ? 'start' : k === 4 ? 'end' : 'middle', fill: c.muted, 'font-size': 16 }, svg).textContent = fmtT(pts[xi][0], span);
      }
      if (bar) {
        var bw = Math.max(pw / n * 0.7, 1.5);
        pts.forEach(function (p, i) { if (p[1] > 0) sv('rect', { x: X(i) - bw / 2, y: Y(p[1]), width: bw, height: Math.max(Y(0) - Y(p[1]), 0), fill: c.accent }, svg); });
      } else {
        var line = pts.map(function (p, i) { return X(i) + ',' + Y(p[1]); }).join(' ');
        sv('polygon', { points: X(0) + ',' + Y(0) + ' ' + line + ' ' + X(n - 1) + ',' + Y(0), fill: c.accent, 'fill-opacity': 0.18 }, svg);
        sv('polyline', { points: line, fill: 'none', stroke: c.accent, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, svg);
        sv('circle', { cx: X(n - 1), cy: Y(vals[n - 1]), r: 4, fill: '#fff' }, svg);
      }
      var cross = sv('line', { y1: padT, y2: padT + ph, stroke: '#fff', 'stroke-opacity': 0.5, visibility: 'hidden' }, svg);
      svg.addEventListener('mousemove', function (e) {
        var r = svg.getBoundingClientRect(), x = e.clientX - r.left;
        var i = Math.min(n - 1, Math.max(0, Math.round(bar ? (x - padL) / (pw / n) - 0.5 : n === 1 ? 0 : (x - padL) / pw * (n - 1))));
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
        floatTip(new Date(pts[i][0] * 1000).toLocaleString() + '   ' + fmtV(pts[i][1]), e.clientX + 14, e.clientY - 44);
      });
      svg.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    }
    paint();
    var ro = new ResizeObserver(paint);
    ro.observe(wrap);
    observers.push(ro);
  }

  // ---------------------------------------------------------------- square view
  function kpiChip(parent, k) {
    var b = card(parent, 'flex:none;padding:.5vh .8vw;display:flex;align-items:center;gap:.6vw', null);
    var t = el('div', null, null, b);
    label(t, k.label.toUpperCase());
    el('div', 'font-size:3vh;font-weight:700;color:' + kpiColor(k.state), k.value, t);
    if (k.explain) icon(b, k.explain);
    return b;
  }
  function statCard(parent, s, i) {
    var b = card(parent, 'display:flex;flex-direction:column;gap:.3vh;min-width:0;padding:.8vh 1vw', function () { show(D, 'stat:' + i, true); });
    var top = el('div', 'display:flex;align-items:baseline;gap:.6vw', null, b);
    el('div', 'font-size:3.2vh;font-weight:700', s.value, top);
    if (s.trend === 'up') el('span', 'color:#3fb950;font-size:2vh', '▲', top);
    if (s.trend === 'down') el('span', 'color:#f85149;font-size:2vh', '▼', top);
    el('div', 'flex:1', null, top);
    if (s.explain) icon(top, s.explain);
    label(b, s.label.toUpperCase());
  }
  function healthRow(parent, h, i) {
    var b = card(parent, 'display:flex;align-items:center;gap:.6vw;padding:.7vh .8vw;font-size:2.1vh;min-width:0', function () { show(D, 'health:' + i, true); });
    el('span', 'flex:none;color:' + col().health[h.state] + ';font-size:2.4vh', '●', b);
    el('span', 'flex:1;min-width:0', h.name, b);
    el('span', 'flex:none;font-size:1.5vh;letter-spacing:.04em;color:' + col().health[h.state], h.state.toUpperCase(), b);
    if (h.explain) icon(b, h.explain);
  }
  function chartCard(parent, i) {
    var ch = D.charts[i], c = col(), s = summarize(ch.points);
    var b = card(parent, 'display:flex;flex-direction:column;gap:.8vh;min-height:0;min-width:0', function () { show(D, 'chart:' + i, true); });
    var top = el('div', 'flex:none;display:flex;align-items:center;gap:.8vw;min-width:0', null, b);
    el('div', 'font-size:2.4vh;font-weight:700;letter-spacing:.06em', ch.title.toUpperCase(), top);
    el('div', 'font-size:1.8vh;color:' + c.muted, ch.subtitle, top);
    el('div', 'flex:1', null, top);
    if (ch.explain) icon(top, ch.explain);
    if (ch.kpis.length) { var kp = el('div', 'flex:none;display:flex;gap:.8vw', null, b); ch.kpis.forEach(function (k) { kpiChip(kp, k); }); }
    drawChart(el('div', 'flex:1;min-height:0', null, b), ch.points, ch);
    var f = el('div', 'flex:none;display:flex;justify-content:space-between;font-size:1.6vh;color:' + c.muted, null, b);
    var cal = ch.kind === 'calendar';
    el('span', null, cal ? '' : '-' + (ch.span_label || ''), f); el('span', null, s ? 'max ' + (ch.y_fit ? fmtAx : fmtV)(s.max) + (cal ? '/day' : '') : '-', f); el('span', null, cal ? 'today' : 'now', f);
    return b;
  }
  function squareView() {
    var c = col();
    var body = frame(D.name, [D.branch ? '⎇ ' + D.branch : '', D.activity].filter(Boolean).join('   ·   '), c.status[D.status], String(D.status_label || D.status).toUpperCase());
    var left = el('div', 'flex:none;width:34vw;display:flex;flex-direction:column;gap:1.1vh;min-height:0;overflow:auto', null, body);
    if (D.summary) el('div', 'flex:none;font-size:1.8vh;line-height:1.3;color:' + c.muted, D.summary, left);
    if (D.task) { var t = card(left, 'flex:none;font-size:2vh;padding:.8vh 1.2vw', null); label(t, 'NOW'); el('div', 'margin-top:.3vh', D.task, t); }
    if (D.alert) {                                                           // the alerts banner: every open alert, one per line
      var al = card(left, 'flex:none;font-size:2vh;padding:.8vh 1.2vw', null);
      label(al, String(D.alert.label || 'ALERT').toUpperCase());
      var its = (D.alert.items && D.alert.items.length) ? D.alert.items : [{ text: D.alert.text, state: D.alert.state }];
      var amap = { ok: c.health.up, warn: c.health.degraded, bad: c.health.down };
      its.forEach(function (it) {
        var r = el('div', 'margin-top:.4vh;display:flex;gap:.6vw;align-items:baseline', null, al);
        el('span', 'flex:none;color:' + (amap[it.state] || c.muted), '\u25CF', r);
        el('span', 'min-width:0', it.text, r);
      });
    }
    if (D.health.length) {
      section(left, 'HEALTH');
      var hg = el('div', 'flex:none;display:grid;gap:.9vh;grid-template-columns:' + (D.health.length > 4 ? '1fr 1fr' : '1fr'), null, left);
      D.health.forEach(function (h, i) { healthRow(hg, h, i); });
    }
    if (D.stats.length) {
      section(left, 'STATS');
      var sg = el('div', 'flex:none;display:grid;gap:.9vh;grid-template-columns:' + (D.stats.length > 4 ? '1fr 1fr 1fr' : '1fr 1fr'), null, left);
      D.stats.forEach(function (s, i) { statCard(sg, s, i); });
    }
    var n = D.charts.length;
    var right = el('div', 'flex:1;min-width:0;min-height:0;display:grid;gap:1.4vh;grid-auto-rows:minmax(0,1fr);grid-template-columns:' + (n >= 3 ? '1fr 1fr' : '1fr'), null, body);
    D.charts.forEach(function (ch, i) {
      var cc = chartCard(right, i);
      if (n === 3 && i === 2) cc.style.gridColumn = '1 / span 2';       // an odd last chart takes the full row instead of leaving a hole
    });
    if (!n) el('div', 'display:flex;align-items:center;justify-content:center;color:' + c.muted + ';font-size:2.4vh', 'No charts on this tile', right);
  }

  // ---------------------------------------------------------------- chart view
  function chartView(i) {
    var ch = D.charts[i], c = col(), long = !!(ch.history && ch.history.length);
    var pts = long ? ch.history : ch.points, span = long ? (ch.history_label || ch.span_label) : ch.span_label;
    var body = frame(ch.title, ch.subtitle, null, null);
    var main = card(body, 'flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:1vh', null);
    label(main, span ? 'LAST ' + span.toUpperCase() : 'HISTORY');
    drawChart(el('div', 'flex:1;min-height:0', null, main), pts, ch);
    var side = el('div', 'flex:none;width:30vw;display:flex;flex-direction:column;gap:1.2vh;min-height:0;overflow:auto', null, body);
    if (ch.explain) { section(side, 'WHAT THIS SHOWS'); el('div', 'flex:none;font-size:2.1vh;line-height:1.35', ch.explain, side); }
    var s = summarize(pts), bar = ch.kind === 'bar' || ch.kind === 'calendar';
    if (s) {
      var cells = bar ? [['QUIET BUCKETS', pct(s.zeroPct), 'Share of time buckets with a value of 0 (for an error chart: no errors).'], ['ACTIVE BUCKETS', pct(100 - s.zeroPct), 'Share of time buckets with a value above 0.'], ['TOTAL', fmtV(s.sum), 'Sum over the window.'], ['PEAK', fmtV(s.max), 'Highest single bucket.']]
                      : [['NOW', fmtV(s.last), 'Latest value.'], ['AVERAGE', fmtV(s.avg), 'Mean over the window.'], ['MIN', fmtV(s.min), 'Lowest value.'], ['MAX', fmtV(s.max), 'Highest value.']];
      section(side, 'NUMBERS');
      var g = el('div', 'flex:none;display:grid;gap:1vh;grid-template-columns:1fr 1fr', null, side);
      cells.forEach(function (x) {
        var m = card(g, 'padding:.8vh 1vw', null);
        var r = el('div', 'display:flex;justify-content:space-between;align-items:center', null, m);
        label(r, x[0]); icon(r, x[2]);
        el('div', 'font-size:3vh;font-weight:700', x[1], m);
      });
    }
    var b = ch.breakdown;
    if (b && (b.ok_pct != null || b.err_pct != null)) {
      var okp = b.ok_pct != null ? b.ok_pct : 100 - b.err_pct, erp = b.err_pct != null ? b.err_pct : 100 - b.ok_pct;
      section(side, 'SUCCESS VS ERRORS' + (b.total != null ? '  ·  ' + fmtV(b.total) + ' RUNS' : ''));
      var bb = card(side, 'flex:none;padding:.8vh 1vw', null);
      var bar2 = el('div', 'display:flex;height:2.2vh;border-radius:4px;overflow:hidden;background:#1a2640', null, bb);
      el('div', 'width:' + okp + '%;background:' + c.health.up, null, bar2);
      el('div', 'width:' + erp + '%;background:' + c.health.down, null, bar2);
      var row = el('div', 'display:flex;justify-content:space-between;margin-top:.5vh;font-size:2vh', null, bb);
      el('span', 'color:' + c.health.up, pct(okp) + ' success', row); el('span', 'color:' + c.health.down, pct(erp) + ' errors', row);
    }
    if (ch.kpis.length) { section(side, 'KEY NUMBERS'); var kp = el('div', 'flex:none;display:flex;gap:1vw', null, side); ch.kpis.forEach(function (k) { kpiChip(kp, k); }); }
    var w = (b && b.worst && b.worst.length) ? b.worst : worst(pts, 4).map(function (x) { return { label: ch.kind === 'calendar' ? dayLabel(dayKey(x.t)) : new Date(x.t * 1000).toLocaleString(), value: fmtV(x.v) }; });
    if (w.length) {
      section(side, 'WORST PERIODS');
      w.slice(0, 4).forEach(function (x) {
        var r = card(side, 'flex:none;display:flex;justify-content:space-between;padding:.5vh 1vw;font-size:2vh', null);
        el('span', null, x.label, r); el('span', 'font-weight:700', x.value, r);
      });
    }
  }

  // ---------------------------------------------------------------- item view (stat / health light / KPI)
  function itemView(kind, it, ch) {
    var c = col(), name = it.name || it.label;
    var color = kind === 'health' ? c.health[it.state] : kind === 'kpi' ? kpiColor(it.state) : c.text;
    var body = frame(name, kind === 'kpi' && ch ? 'from ' + ch.title : '', null, null);
    body.style.flexDirection = 'column';
    body.style.overflow = 'auto';
    var big = card(body, 'flex:none;display:flex;align-items:center;gap:2vw;padding:3vh 2vw', null);
    if (kind === 'health') {
      el('span', 'color:' + color + ';font-size:7vh;line-height:1', '●', big);
      el('span', 'color:' + color + ';font-size:6vh;font-weight:700;letter-spacing:.08em', it.state.toUpperCase(), big);
    } else {
      el('span', 'color:' + color + ';font-size:8vh;font-weight:700;line-height:1', it.value, big);
      if (it.trend === 'up') el('span', 'color:#3fb950;font-size:4vh', '▲', big);
      if (it.trend === 'down') el('span', 'color:#f85149;font-size:4vh', '▼', big);
      el('span', 'color:' + c.muted + ';font-size:2.6vh;letter-spacing:.12em', it.label.toUpperCase(), big);
    }
    var d = it.detail, any = false;
    if (it.explain) { any = true; var e = card(body, 'flex:none', null); label(e, 'WHAT IT IS'); el('div', 'font-size:2.4vh;line-height:1.4;margin-top:.5vh', it.explain, e); }
    if (d && d.why) { any = true; var w = card(body, 'flex:none', null); label(w, 'WHAT IS GOING ON'); el('div', 'font-size:2.4vh;line-height:1.4;margin-top:.5vh', d.why, w); }
    if (d && d.items && d.items.length) {
      any = true;
      section(body, 'MEMBERS (' + d.items.length + ')');
      var g = el('div', 'flex:none;display:grid;gap:1vh;grid-template-columns:repeat(3,1fr)', null, body);
      d.items.forEach(function (m) {
        var r = card(g, 'padding:.8vh 1vw;min-width:0', null);
        var t = el('div', 'display:flex;align-items:center;gap:.6vw;font-size:2.2vh', null, r);
        el('span', 'flex:none;color:' + c.health[m.state], '●', t);
        el('span', 'flex:1;min-width:0;font-weight:700', m.name, t);
        el('span', 'flex:none;font-size:1.6vh;letter-spacing:.1em;color:' + c.health[m.state], m.state.toUpperCase(), t);
        if (m.what) el('div', 'font-size:1.9vh;color:' + c.muted + ';margin-top:.3vh', m.what, r);
      });
    }
    if (!any) el('div', 'flex:none;font-size:2.2vh;color:' + c.muted, 'No further detail has been recorded for this item.', body);
  }

  // ---------------------------------------------------------------- cell view (grid tile: one trade in depth)
  function cellView(i) {
    var cell = D.cells[i], c = col(), d = cell.detail || {}, up = !!cell.up;
    var gc = c.grid || c.health;
    var body = frame(d.title || cell.name, d.series || '', up ? gc.up : gc.down, cell.pct_text, up ? 'up' : 'down');
    body.setAttribute('data-wl-cellview', String(i));
    var left = el('div', 'flex:none;width:32vw;display:flex;flex-direction:column;gap:1.1vh;min-height:0;overflow:auto', null, body);
    if (d.summary) { var s = card(left, 'flex:none', null); label(s, 'HOW THE % IS COMPUTED'); el('div', 'font-size:1.9vh;line-height:1.35;margin-top:.4vh', d.summary, s); }
    var kv = d.kv || [];
    if (kv.length) {
      section(left, 'KEY FACTS');
      var g = el('div', 'flex:none;display:grid;gap:.9vh;grid-template-columns:1fr 1fr', null, left);
      kv.forEach(function (x) {
        var m = card(g, 'padding:.7vh .9vw;min-width:0', null);
        label(m, String(x.label).toUpperCase());
        el('div', 'font-size:2.3vh;font-weight:700;margin-top:.2vh', x.value, m);
      });
    }
    var right = el('div', 'flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:1.3vh', null, body);
    var ch = d.chart;
    if (ch && ch.points && ch.points.length) {
      var cc = card(right, 'flex:none;height:30vh;display:flex;flex-direction:column;gap:.6vh;min-height:0', null);
      label(cc, String(ch.title || 'CHART').toUpperCase());
      drawChart(el('div', 'flex:1;min-height:0', null, cc), ch.points, { kind: ch.kind || 'line' });
    }
    var low = el('div', 'flex:1;min-height:0;display:flex;gap:1.3vw', null, right);
    var pc = card(low, 'flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:.6vh;overflow:auto', null);
    var pos = d.positions || [];
    label(pc, 'PAPER POSITIONS (' + pos.length + ')');
    if (pos.length) {
      var tb = el('table', 'width:100%;border-collapse:collapse;font-size:1.9vh', null, pc);
      var hr = el('tr', null, null, tb);
      ['MARKET', 'SIDE', 'QTY', 'ENTRY ¢', 'MARK ¢', 'P&L ¢'].forEach(function (h, k) {
        el('th', 'white-space:nowrap;text-align:' + (k ? 'right' : 'left') + ';padding:.4vh .4vw;font-size:1.5vh;letter-spacing:.1em;font-weight:400;color:' + c.muted + ';border-bottom:1px solid #1f5fae', h, hr);
      });
      pos.forEach(function (p) {
        var tr = el('tr', null, null, tb);
        [p.market, p.side, p.contracts, p.entry, p.mark, p.pnl].forEach(function (v, k) {
          var neg = k === 5 && /^-/.test(String(v));
          el('td', 'white-space:nowrap;text-align:' + (k ? 'right' : 'left') + ';padding:.4vh .4vw;border-bottom:1px solid rgba(31,95,174,.35);' + (k === 5 ? 'font-weight:700;color:' + (neg ? c.health.down : String(v) === '?' ? c.muted : c.health.up) : ''), v, tr);
        });
      });
    } else el('div', 'font-size:2vh;color:' + c.muted, 'No paper positions recorded for this trade yet.', pc);
    var ec = card(low, 'flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:.6vh;overflow:auto', null);
    var ev = d.events || [];
    label(ec, 'LATEST DECISIONS & AI REASONING (' + ev.length + ')');
    if (ev.length) ev.forEach(function (x) {
      var r = el('div', 'flex:none;display:flex;gap:.8vw;padding:.5vh 0;border-bottom:1px solid rgba(31,95,174,.35);font-size:1.8vh;line-height:1.3', null, ec);
      el('span', 'flex:none;width:8.5vw;color:' + c.muted, x.time, r);
      el('span', 'flex:1;min-width:0', x.text, r);
    });
    else el('div', 'font-size:2vh;color:' + c.muted, 'No decisions or AI calls recorded yet.', ec);
  }

  // ---------------------------------------------------------------- install
  document.addEventListener('keydown', function (e) {
    if (overlay && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
  window.wallOpen = function (node, target) {
    try {
      var root = node.closest('[data-wl-data]');
      stack = [];
      show(JSON.parse(root.getAttribute('data-wl-data')), target, false);
    } catch (e) { close(); }
  };
  window.wallShow = function (data, target) { stack = []; show(data, target, false); };
  window.wallClose = function () { close(); };
  document.documentElement.setAttribute('data-wl-viewer', '1');     // lets a live check see that the bootstrap loaded the script

  // ---------------------------------------------------------------- live updates (no reload, no flash)
  // Every tile root carries data-wl-slug and data-wl-h (hash of the HTML it shows). Every few seconds we tell the server which hash each tile
  // shows; for a tile that is out of date it returns the new HTML, which is MORPHED into the existing DOM: only the text, attributes and chart
  // images that differ are touched, so the rest of the screen never repaints. The wrapper page (our parent) is told so it can show a notice.
  var SRC = LIVE_SRC;
  var BASE = SRC ? SRC.replace(/viewer\.js.*$/, '') : location.protocol + '//' + location.hostname + ':8088/wall/';
  var POLL_MS = 3000;

  function morph(a, b) {                   // make element a identical to element b; returns how many edits it took
    var n = 0, i, at, x, y, ac = a.childNodes, bc = b.childNodes;
    for (i = 0; i < b.attributes.length; i++) {
      at = b.attributes[i];
      if (a.getAttribute(at.name) !== at.value) { a.setAttribute(at.name, at.value); n++; }
    }
    for (i = a.attributes.length - 1; i >= 0; i--) {
      at = a.attributes[i];
      if (!b.hasAttribute(at.name)) { a.removeAttribute(at.name); n++; }
    }
    for (i = 0; i < bc.length; i++) {
      x = ac[i]; y = bc[i];
      if (!x) { a.appendChild(document.importNode(y, true)); n++; }
      else if (x.nodeType === 3 && y.nodeType === 3) { if (x.nodeValue !== y.nodeValue) { x.nodeValue = y.nodeValue; n++; } }
      else if (x.nodeType === 1 && y.nodeType === 1 && x.tagName === y.tagName) n += morph(x, y);
      else { a.replaceChild(document.importNode(y, true), x); n++; }
    }
    while (ac.length > bc.length) { a.removeChild(a.lastChild); n++; }
    return n;
  }

  function applyLive(root, u) {
    var t = document.createElement('template');           // template content is inert: nothing in it loads or runs until it is imported
    t.innerHTML = u.html;
    var fresh = t.content.firstElementChild;
    if (!fresh || !fresh.hasAttribute('data-wl-slug')) return;
    if (morph(root, fresh) > 0) {
      try { window.parent.postMessage({ wallUpdated: { slug: u.slug, name: u.name, t: u.t } }, '*'); } catch (e) { /* standalone page */ }
    }
  }

  function poll() {
    var roots = Array.prototype.slice.call(document.querySelectorAll('[data-wl-slug]'));
    if (!roots.length) return setTimeout(poll, POLL_MS);
    var q = roots.map(function (r) { return 'have=' + encodeURIComponent(r.getAttribute('data-wl-slug') + ':' + (r.getAttribute('data-wl-h') || '')); }).join('&');
    fetch(BASE + 'live?' + q, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      roots.forEach(function (r) {
        var slug = r.getAttribute('data-wl-slug'), u = j[slug];
        if (u && r.isConnected) { u.slug = slug; applyLive(r, u); }
      });
    }).catch(function () { /* server restarting or unreachable: try again next round */ }).then(function () { setTimeout(poll, POLL_MS); });
  }
  setTimeout(poll, 1500);
})();
