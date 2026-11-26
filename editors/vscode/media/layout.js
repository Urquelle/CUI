// The designer's panels (components, outline, and properties with the C code)
// in columns on either side of the preview. The splitters between columns and
// panels resize them; a panel's header moves it to another place in a column,
// to a new column beside one (drop on a column's edge), or to a new column at
// a side of the preview (drop on the preview's outer quarter). The layout is a
// plain object in prefs.layout, which the extension keeps for every designer.

const PANELS = ['components', 'outline', 'inspector'];
const SIDES = ['left', 'right'];
const MIN_W = 160, MAX_W = 900, NEW_W = 240, MIN_H = 64, EDGE = 28;

const $ = (s) => document.querySelector(s);
const panelEls = new Map();   // id -> element, collected once: a render takes them out of the page for a moment
const panelEl = (id) => panelEls.get(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function defaultLayout() {
  return {
    left: [{ width: 220, panels: [{ id: 'components', grow: 3 }, { id: 'outline', grow: 2 }] }],
    right: [{ width: 280, panels: [{ id: 'inspector', grow: 1 }] }],
  };
}

// A stored layout is used when it places every panel once.
function isValid(l) {
  try {
    const seen = [];
    for (const side of SIDES) for (const c of l[side]) {
      if (!(c.width > 0) || !c.panels.length) return false;
      for (const p of c.panels) { if (!PANELS.includes(p.id) || !(p.grow > 0)) return false; seen.push(p.id); }
    }
    return seen.length === PANELS.length && new Set(seen).size === PANELS.length;
  } catch (e) { return false; }
}

let prefs = null, save = () => {};
let moving = null;   // the panel being dragged: { id, x0, y0, active, target }

export function initLayout(p, onChange) {
  prefs = p;
  save = onChange;
  if (!isValid(prefs.layout)) prefs.layout = defaultLayout();
  document.querySelectorAll('.panel').forEach((p) => panelEls.set(p.dataset.panel, p));
  render();
  document.querySelectorAll('.panel-head').forEach((h) => h.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, input, select')) return;
    moving = { id: h.closest('.panel').dataset.panel, x0: e.clientX, y0: e.clientY, active: false, target: null };
    e.preventDefault();
  }));
  window.addEventListener('pointermove', movePanel);
  window.addEventListener('pointerup', dropPanel);
  window.addEventListener('keydown', (e) => {   // Esc cancels a move, before the designer sees the key
    if (moving && moving.active && e.key === 'Escape') { e.stopImmediatePropagation(); endMove(); }
  }, true);
}

// ---------------------------------------------------------------- columns and splitters

function render() {
  const layout = prefs.layout;
  for (const side of SIDES) {
    const dock = $('#dock-' + side);
    dock.replaceChildren();
    for (const col of layout[side]) {
      const c = document.createElement('div');
      c.className = 'col';
      c.style.width = col.width + 'px';
      col.panels.forEach((p, k) => {
        if (k) c.append(rowSplitter(col, k));
        const panel = panelEl(p.id);
        panel.style.flexGrow = p.grow;
        c.append(panel);
      });
      const v = colSplitter(side, col, c);
      if (side === 'left') dock.append(c, v); else dock.append(v, c);
    }
  }
}

// Drags with the pointer captured, so the splitter keeps it over the preview's canvas too.
function dragSplitter(s, e, move) {
  if (e.button !== 0) return;
  e.preventDefault();
  s.setPointerCapture(e.pointerId);
  s.classList.add('on');
  const x0 = e.clientX, y0 = e.clientY;
  const onMove = (m) => move(m.clientX - x0, m.clientY - y0);
  const onUp = () => {
    s.removeEventListener('pointermove', onMove);
    s.removeEventListener('pointerup', onUp);
    s.removeEventListener('pointercancel', onUp);
    s.classList.remove('on');
    save();
  };
  s.addEventListener('pointermove', onMove);
  s.addEventListener('pointerup', onUp);
  s.addEventListener('pointercancel', onUp);
}

// Between a column and the preview: the column's width.
function colSplitter(side, col, c) {
  const s = document.createElement('div');
  s.className = 'vsplit';
  s.title = 'Drag to change the width; double-click for the default';
  s.addEventListener('pointerdown', (e) => {
    const w0 = c.offsetWidth;
    dragSplitter(s, e, (dx) => { col.width = Math.round(clamp(w0 + (side === 'left' ? dx : -dx), MIN_W, MAX_W)); c.style.width = col.width + 'px'; });
  });
  s.addEventListener('dblclick', () => { col.width = side === 'left' ? 220 : 280; c.style.width = col.width + 'px'; save(); });
  return s;
}

// Between two panels of a column: how the column's height is shared. The two
// keep the sum of their weights, so the other panels keep their heights.
function rowSplitter(col, k) {
  const s = document.createElement('div');
  s.className = 'hsplit';
  s.addEventListener('pointerdown', (e) => {
    const a = panelEl(col.panels[k - 1].id), b = panelEl(col.panels[k].id);
    const ha = a.offsetHeight, hb = b.offsetHeight, sum = col.panels[k - 1].grow + col.panels[k].grow;
    if (ha + hb < 2 * MIN_H) return;
    dragSplitter(s, e, (_dx, dy) => {
      const na = clamp(ha + dy, MIN_H, ha + hb - MIN_H);
      col.panels[k - 1].grow = sum * na / (ha + hb);
      col.panels[k].grow = sum - col.panels[k - 1].grow;
      a.style.flexGrow = col.panels[k - 1].grow;
      b.style.flexGrow = col.panels[k].grow;
    });
  });
  return s;
}

// ---------------------------------------------------------------- moving a panel

// Where a panel dropped at (cx, cy) goes: { side, col, at } for a place in a
// column, { side, newAt } for a new column at that index; box is the hint.
function targetAt(cx, cy) {
  const inside = (r) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  for (const side of SIDES) {
    const cols = [...$('#dock-' + side).querySelectorAll(':scope > .col')];
    for (let ci = 0; ci < cols.length; ci++) {
      const r = cols[ci].getBoundingClientRect();
      if (!inside(r)) continue;
      if (cx < r.left + EDGE) return { side, newAt: ci, box: { x: r.left, y: r.top, w: 4, h: r.height } };
      if (cx > r.right - EDGE) return { side, newAt: ci + 1, box: { x: r.right - 4, y: r.top, w: 4, h: r.height } };
      const panels = [...cols[ci].querySelectorAll(':scope > .panel')];
      let at = panels.findIndex((p) => { const b = p.getBoundingClientRect(); return cy < b.top + b.height / 2; });
      if (at < 0) at = panels.length;
      const y = at < panels.length ? panels[at].getBoundingClientRect().top : r.bottom;
      return { side, col: ci, at, box: { x: r.left, y: clamp(y - 2, r.top, r.bottom - 4), w: r.width, h: 4 } };
    }
  }
  const s = $('#stage').getBoundingClientRect();
  if (inside(s)) {
    const w = Math.min(NEW_W, s.width / 4);
    if (cx < s.left + s.width / 4) return { side: 'left', newAt: prefs.layout.left.length, box: { x: s.left, y: s.top, w, h: s.height, area: true } };
    if (cx > s.right - s.width / 4) return { side: 'right', newAt: 0, box: { x: s.right - w, y: s.top, w, h: s.height, area: true } };
  }
  return null;
}

function movePanel(e) {
  if (!moving) return;
  if (!moving.active && Math.hypot(e.clientX - moving.x0, e.clientY - moving.y0) < 4) return;
  moving.active = true;
  document.body.classList.add('moving-panel');
  const g = $('#ghost');
  g.hidden = false;
  g.textContent = panelEl(moving.id).dataset.title;
  g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px';
  const t = moving.target = targetAt(e.clientX, e.clientY);
  const h = $('#dock-hint');
  h.hidden = !t;
  if (t) {
    Object.assign(h.style, { left: t.box.x + 'px', top: t.box.y + 'px', width: t.box.w + 'px', height: t.box.h + 'px' });
    h.classList.toggle('area', !!t.box.area);
  }
}

function endMove() {
  moving = null;
  document.body.classList.remove('moving-panel');
  $('#ghost').hidden = true;
  $('#dock-hint').hidden = true;
}

function dropPanel() {
  if (!moving) return;
  const { id, active, target: t } = moving;
  endMove();
  if (!active || !t) return;
  const layout = prefs.layout;
  let src = null, k = -1;
  for (const side of SIDES) for (const c of layout[side]) { const i = c.panels.findIndex((p) => p.id === id); if (i >= 0) { src = c; k = i; } }
  const entry = src.panels[k];
  if (t.col !== undefined) {
    const col = layout[t.side][t.col];
    let at = t.at;
    if (col === src) {
      if (at === k || at === k + 1) return;   // its own place
      if (k < at) at--;
    }
    src.panels.splice(k, 1);
    entry.grow = col.panels.length ? col.panels.reduce((a, p) => a + p.grow, 0) / col.panels.length : 1;
    col.panels.splice(at, 0, entry);
  } else {
    const list = layout[t.side], si = list.indexOf(src);
    if (src.panels.length === 1 && si >= 0 && (t.newAt === si || t.newAt === si + 1)) return;   // already a column of its own there
    src.panels.splice(k, 1);
    list.splice(t.newAt, 0, { width: NEW_W, panels: [{ id, grow: 1 }] });
  }
  for (const side of SIDES) layout[side] = layout[side].filter((c) => c.panels.length);
  render();
  save();
}
