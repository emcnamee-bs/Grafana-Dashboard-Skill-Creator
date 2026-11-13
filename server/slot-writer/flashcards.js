/* flashcards.js - the interactive flashcard tile for the Grafana wall.
 *
 * Served by the slot-writer at /wall/flashcards.js and loaded once per Grafana page by the tile's 1x1 bootstrap image.
 * The tile HTML is only <div class="wl-fc" data-fc='{json}'></div>; this script builds everything inside it with DOM calls
 * (textContent only, never innerHTML) and keeps state in memory, so a Grafana re-render of the element is rebuilt in place.
 *
 *   data-fc = {"key": "flashcards", "title": "Flashcards", "sets": [{"id","name","cards":[{"front","back"}]}]}
 *
 * Click zones on the card: left 25% = previous, right 25% = next, middle 50% = flip. Both ends wrap around forever.
 * The Word/Def switch picks which side a card starts on (default: word) every time a card is shown.
 * Persisted per browser (localStorage, optional): selected set and switch position. The card position is never persisted.
 */
(function () {
  if (window.wallFlashcards) return;
  window.wallFlashcards = { reset: function () { S = {}; } };   // reset: forget in-memory card state (used by the tests)

  var S = {};            // key -> {set: id, i: index, flipped: bool, defFirst: bool}
  var STORE = "wlfc:";

  function load(key) {
    try { var v = JSON.parse(localStorage.getItem(STORE + key) || "null"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; }
  }
  function save(key) {
    try { localStorage.setItem(STORE + key, JSON.stringify({ set: S[key].set, defFirst: S[key].defFirst })); } catch (e) { /* storage is optional */ }
  }

  var CSS = [
    ".wl-fc{box-sizing:border-box;height:100%;padding:12px 14px;border:1px solid #1f5fae;border-radius:8px;box-shadow:inset 0 0 18px rgba(31,95,174,.25);",
    "background:linear-gradient(165deg,#08101c,#0c1a2e);font-family:Inter,sans-serif;color:#e8eefc;overflow:hidden;user-select:none;-webkit-user-select:none}",
    ".wl-fc *{box-sizing:border-box}",
    ".wl-fc .fc-in{height:100%;display:flex;flex-direction:column;gap:8px}",
    ".wl-fc .fc-bar{flex:0 0 calc(20% - 4px);min-height:0;border:1px solid #1f5fae;border-radius:8px;background:rgba(31,95,174,.10);padding:0 12px;display:flex;align-items:center;gap:12px}",
    ".wl-fc .fc-title{font-size:22px;font-weight:700;letter-spacing:.02em;white-space:nowrap}",
    ".wl-fc .fc-sel{flex:1 1 auto;min-width:0;height:34px;border:1px solid #1f5fae;border-radius:8px;background:#0c1a2e;color:#e8eefc;font:600 15px Inter,sans-serif;padding:0 8px;color-scheme:dark;cursor:pointer}",
    ".wl-fc .fc-sel:hover{border-color:#4da3ff}",
    ".wl-fc .fc-sh{flex:0 0 auto;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid #1f5fae;border-radius:8px;background:#0c1a2e;color:#8fa6c8;cursor:pointer;transition:border-color .15s,color .15s,background-color .15s}",
    ".wl-fc .fc-sh:hover{border-color:#4da3ff;color:#e8eefc}",
    ".wl-fc .fc-sh.on{border-color:#4da3ff;color:#4da3ff;background:rgba(77,163,255,.16)}",
    ".wl-fc .fc-sh svg{width:20px;height:20px;pointer-events:none}",
    ".wl-fc .fc-tg{flex:0 0 auto;display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.08em;color:#8fa6c8}",
    ".wl-fc .fc-tg .on{color:#e8eefc}",
    ".wl-fc .fc-track{position:relative;width:34px;height:18px;border-radius:9px;border:1px solid #1f5fae;background:#0c1a2e;transition:border-color .15s}",
    ".wl-fc .fc-tg:hover .fc-track{border-color:#4da3ff}",
    ".wl-fc .fc-knob{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#4da3ff;transition:left .15s}",
    ".wl-fc .fc-tg[aria-checked=true] .fc-knob{left:18px}",
    ".wl-fc .fc-card{position:relative;flex:1 1 auto;min-height:0;border:1px solid #1f5fae;border-radius:8px;background:rgba(31,95,174,.10);cursor:pointer;overflow:hidden}",
    ".wl-fc .fc-z{position:absolute;top:0;bottom:0;pointer-events:none;display:flex;align-items:center;justify-content:center;font-size:34px;color:#4da3ff;opacity:.22;transition:opacity .12s,background-color .12s}",
    ".wl-fc .fc-z.l{left:0;width:25%}.wl-fc .fc-z.r{right:0;width:25%}.wl-fc .fc-z.m{left:25%;width:50%;font-size:0}",
    ".wl-fc .fc-card[data-zone=l] .fc-z.l,.wl-fc .fc-card[data-zone=r] .fc-z.r{opacity:.95;background:rgba(77,163,255,.14)}",
    ".wl-fc .fc-card[data-zone=m] .fc-z.m{background:rgba(77,163,255,.08)}",
    ".wl-fc .fc-side{position:absolute;top:8px;left:0;right:0;text-align:center;font-size:12px;font-weight:700;letter-spacing:.18em;color:#8fa6c8;pointer-events:none}",
    ".wl-fc .fc-pos{position:absolute;bottom:7px;left:0;right:0;text-align:center;font-size:13px;color:#8fa6c8;pointer-events:none}",
    ".wl-fc .fc-text{position:absolute;left:12%;right:12%;top:28px;bottom:28px;display:flex;align-items:center;justify-content:center;text-align:center;",
    "font-weight:700;line-height:1.2;overflow:hidden;overflow-wrap:anywhere;pointer-events:none;transition:transform .12s ease-in,opacity .12s ease-in}",
    ".wl-fc .fc-card.out .fc-text{transform:scaleX(.05);opacity:0}",
    ".wl-fc .fc-empty{margin:auto;color:#8fa6c8;font-size:16px;text-align:center;padding:0 24px}"
  ].join("");

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function addCss() {
    if (document.getElementById("wl-fc-css")) return;
    var s = document.createElement("style");
    s.id = "wl-fc-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function cfgOf(root) {
    try { return JSON.parse(root.getAttribute("data-fc")); } catch (e) { return null; }
  }

  function curSet(cfg, st) {
    for (var k = 0; k < cfg.sets.length; k++) if (cfg.sets[k].id === st.set) return cfg.sets[k];
    return cfg.sets[0];
  }

  function init(root) {
    var cfg = cfgOf(root);
    root._fcDone = true;
    root.textContent = "";
    if (!cfg || !cfg.sets || !cfg.sets.length) {
      var e0 = el("div", "fc-in");
      e0.appendChild(el("div", "fc-empty", "No flashcard sets yet. Run /flashcards in Claude Code to create one."));
      root.appendChild(e0);
      return;
    }
    var key = cfg.key || "flashcards";
    if (!S[key]) {
      var p = load(key);
      S[key] = { set: p.set, i: 0, flipped: false, defFirst: p.defFirst === true, order: {} };   // order: set id -> shuffled card indices (in memory only)
    }
    var st = S[key];
    st.set = curSet(cfg, st).id;

    var inner = el("div", "fc-in");
    var bar = el("div", "fc-bar");
    bar.appendChild(el("div", "fc-title", cfg.title || "Flashcards"));
    var sel = el("select", "fc-sel");
    sel.title = "Choose a flashcard set";
    cfg.sets.forEach(function (s) {
      var o = el("option", "", s.name + " (" + s.cards.length + ")");
      o.value = s.id;
      if (s.id === st.set) o.selected = true;
      sel.appendChild(o);
    });
    bar.appendChild(sel);
    var sh = el("div", "fc-sh");
    sh.setAttribute("role", "button");
    sh.appendChild(shuffleIcon());
    bar.appendChild(sh);
    var tg = el("div", "fc-tg");
    tg.setAttribute("role", "switch");
    tg.title = "Which side each card starts on";
    var lw = el("span", "", "WORD"), ld = el("span", "", "DEF");
    var track = el("div", "fc-track");
    track.appendChild(el("div", "fc-knob"));
    tg.appendChild(lw); tg.appendChild(track); tg.appendChild(ld);
    bar.appendChild(tg);

    var card = el("div", "fc-card");
    var zl = el("div", "fc-z l", "‹"), zm = el("div", "fc-z m"), zr = el("div", "fc-z r", "›");
    var side = el("div", "fc-side"), text = el("div", "fc-text"), pos = el("div", "fc-pos");
    [zl, zm, zr, side, text, pos].forEach(function (n) { card.appendChild(n); });
    inner.appendChild(bar); inner.appendChild(card);
    root.appendChild(inner);

    root._fc = { cfg: cfg, st: st, key: key, sel: sel, sh: sh, tg: tg, lw: lw, ld: ld, card: card, side: side, text: text, pos: pos };
    paint(root);
  }

  function shuffleIcon() {
    var ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    ["M16 3h5v5", "M4 20 21 3", "M21 16v5h-5", "M15 15l6 6", "M4 4l5 5"].forEach(function (d) {
      var p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  // Fisher-Yates over card indices. Never returns the original order for 2+ cards (that would look like the button did nothing).
  function shuffled(n) {
    var a = [], k, j, t, same = true;
    for (k = 0; k < n; k++) a.push(k);
    for (k = n - 1; k > 0; k--) { j = Math.floor(Math.random() * (k + 1)); t = a[k]; a[k] = a[j]; a[j] = t; }
    for (k = 0; k < n; k++) if (a[k] !== k) same = false;
    if (same && n > 1) a.push(a.shift());
    return a;
  }

  function showingBack(st) { return st.defFirst !== st.flipped; }   // XOR: switch says def-first, a flip inverts it

  function fit(node, big, small) {
    var size = big;
    node.style.fontSize = size + "px";
    while (size > small && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      size -= 2;
      node.style.fontSize = size + "px";
    }
  }

  // Keep the text on ONE line: shrink one px at a time until it fits with a little room. A Range measures the text's real width
  // (scrollWidth under-reports overflow on a centred flex box). Returns false if it still does not fit at `small`.
  function fitOneLine(node, big, small) {
    var size = big, rg = document.createRange();
    node.style.whiteSpace = "nowrap";
    node.style.fontSize = size + "px";
    rg.selectNodeContents(node);
    while (size > small && rg.getBoundingClientRect().width > node.clientWidth * 0.94) {
      size -= 1;
      node.style.fontSize = size + "px";
    }
    return rg.getBoundingClientRect().width <= node.clientWidth;
  }

  function paint(root) {
    var f = root._fc;
    if (!f) return;
    var set = curSet(f.cfg, f.st), n = set.cards.length;
    f.st.i = ((f.st.i % n) + n) % n;
    var ord = f.st.order[set.id];
    var c = set.cards[ord ? ord[f.st.i] : f.st.i], back = showingBack(f.st);
    f.sh.className = ord ? "fc-sh on" : "fc-sh";
    f.sh.title = ord ? "Shuffled. Click to shuffle again (reload restores the original order)" : "Shuffle the order of this set";
    var t = back ? c.back : c.front;
    f.side.textContent = back ? "DEFINITION" : "WORD";
    f.text.textContent = t;
    f.text.style.fontWeight = back ? "500" : "700";
    f.text.style.color = back ? "#e8eefc" : "#ffffff";
    f.pos.textContent = (f.st.i + 1) + " / " + n;
    f.tg.setAttribute("aria-checked", f.st.defFirst ? "true" : "false");
    f.lw.className = f.st.defFirst ? "" : "on";
    f.ld.className = f.st.defFirst ? "on" : "";
    var L = t.length;
    f.text.style.whiteSpace = "";
    if (back) fit(f.text, L <= 60 ? 30 : L <= 110 ? 26 : L <= 170 ? 22 : 19, 13);
    else {
      // A word or short phrase shrinks to one line: a single token (existingSecretName) down to 12px, a phrase down to 24px;
      // a phrase too long for that falls back to wrapping at its spaces.
      var big = L <= 12 ? 58 : L <= 24 ? 46 : L <= 40 ? 36 : 28;
      if (!fitOneLine(f.text, big, /\s/.test(t) ? 24 : 12)) {
        f.text.style.whiteSpace = "";
        fit(f.text, big, 14);
      }
    }
  }

  // Run a state change, animating the text out and back in around the repaint.
  function swap(root, change) {
    var f = root._fc;
    if (!f) return;
    change(f.st);
    f.card.classList.add("out");
    clearTimeout(f.timer);
    f.timer = setTimeout(function () { paint(root); f.card.classList.remove("out"); }, 120);
  }

  function zoneOf(card, x) {
    var r = card.getBoundingClientRect(), u = (x - r.left) / r.width;
    return u < 0.25 ? "l" : u > 0.75 ? "r" : "m";
  }

  function rootOf(node) { var r = node && node.closest && node.closest(".wl-fc"); return r && r._fc ? r : null; }

  document.addEventListener("click", function (e) {
    var root = rootOf(e.target);
    if (!root) return;
    var f = root._fc;
    if (e.target.closest(".fc-tg")) {
      f.st.defFirst = !f.st.defFirst;
      f.st.flipped = false;
      save(f.key);
      swap(root, function () {});
      return;
    }
    if (e.target.closest(".fc-sh")) {
      swap(root, function (st) {
        st.order[curSet(f.cfg, st).id] = shuffled(curSet(f.cfg, st).cards.length);
        st.i = 0; st.flipped = false;
      });
      return;
    }
    var card = e.target.closest(".fc-card");
    if (!card) return;
    var z = zoneOf(card, e.clientX);
    if (z === "l") swap(root, function (st) { st.i -= 1; st.flipped = false; });
    else if (z === "r") swap(root, function (st) { st.i += 1; st.flipped = false; });
    else swap(root, function (st) { st.flipped = !st.flipped; });
  }, true);

  document.addEventListener("change", function (e) {
    var root = rootOf(e.target);
    if (!root || !e.target.classList.contains("fc-sel")) return;
    var f = root._fc;
    f.st.set = e.target.value; f.st.i = 0; f.st.flipped = false;
    save(f.key);
    swap(root, function () {});
  }, true);

  document.addEventListener("mousemove", function (e) {
    var card = e.target.closest && e.target.closest(".wl-fc .fc-card");
    document.querySelectorAll(".wl-fc .fc-card[data-zone]").forEach(function (c) { if (c !== card) c.removeAttribute("data-zone"); });
    if (card) card.setAttribute("data-zone", zoneOf(card, e.clientX));
  }, true);

  function scan() {
    addCss();
    var roots = document.querySelectorAll(".wl-fc");
    for (var k = 0; k < roots.length; k++) if (!roots[k]._fcDone) init(roots[k]);
  }
  scan();
  setInterval(scan, 1000);   // Grafana may replace the element; a fresh one is rebuilt from the kept state
})();
