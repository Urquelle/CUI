// The designer webview: a palette, an outline, the live preview (CUI in
// WebAssembly, native/designer.c) with selection and drag and drop on top of
// it, and a property panel. The document is the *.cui.json text that VS Code
// holds; every change is sent back to it as a whole, so undo, save and dirty
// state are VS Code's.
import { loadModule } from './runtime.js';

const { list: COMPONENTS, byType, groups: GROUPS } = window.CuiComponents;
const { resolveNames, generate, isIdent, walk } = window.CuiCodegen;
const host = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : window.cuiDevHost;
const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
};

// cui_key values (include/cui/cui.h), as web/site/js/preview.js maps them
const KEYS = { Tab: 1, Enter: 2, NumpadEnter: 2, Escape: 3, Backspace: 4, Delete: 5, Space: 6,
  ArrowLeft: 7, ArrowRight: 8, ArrowUp: 9, ArrowDown: 10, Home: 11, End: 12, PageUp: 13, PageDown: 14,
  Minus: 51, Equal: 52, Comma: 53, Period: 54, Slash: 55 };
for (let i = 0; i < 26; i++) KEYS['Key' + String.fromCharCode(65 + i)] = 15 + i;
for (let i = 0; i < 10; i++) { KEYS['Digit' + i] = 41 + i; KEYS['Numpad' + i] = 41 + i; }
const ACCENTS = ['neutral', 'violet', 'blue', 'green', 'amber', 'orange', 'coral', 'rose'];   // cui_accent order
const CURSORS = ['default', 'pointer', 'text', 'ew-resize', 'ns-resize', 'move', 'not-allowed'];

let doc = null;            // the parsed document
let fileName = 'screen.cui.json';
let selected = null;       // node id
let hovered = null;
let mode = 'design';
let mod, x, inst;
let order = [];            // wasm index -> node
let parentOf = new Map();  // node id -> parent node
let names = new Map();     // node id -> state field
let dirty = true, raf = 0, lastT = 0, wakeAt = 0;

// ---------------------------------------------------------------- document

const nodeById = (id) => order.find((n) => n.id === id) || null;
const specOf = (n) => byType[n.type];
const isContainer = (n) => !!(specOf(n) && specOf(n).container);
const baseName = () => fileName.replace(/\.cui\.json$/i, '').replace(/\.json$/i, '');

function index() {
  order = []; parentOf = new Map();
  walk(doc.root, (n, p) => { order.push(n); if (p) parentOf.set(n.id, p); n.props ||= {}; if (specOf(n) && specOf(n).container) n.children ||= []; });
  names = resolveNames(doc);
}

function nextId() {
  let m = 0;
  walk(doc.root, (n) => { const k = /^n(\d+)$/.exec(n.id); if (k) m = Math.max(m, +k[1]); });
  return 'n' + (m + 1);
}

// Every change goes through here: the preview, the panels and VS Code's copy.
let postTimer = 0;
function changed(opts = {}) {
  index();
  sendToPreview();
  renderOutline();
  if (!opts.keepPanel) renderPanel();
  renderCode();
  clearTimeout(postTimer);
  const post = () => host.postMessage({ type: 'edit', text: JSON.stringify(doc, null, 2) + '\n' });
  if (opts.typing) postTimer = setTimeout(post, 300); else post();
}

function load(text, name) {
  if (name) fileName = name;
  let d;
  try { d = text.trim() ? JSON.parse(text) : null; } catch (e) { status(`<b>Invalid JSON</b>: ${esc(e.message)}. Fix it in the text editor (Reopen Editor With… Text Editor).`); return; }
  if (!d || !d.root) d = window.CuiCodegen.newDocument(baseName());
  doc = d;
  doc.preview ||= {};
  index();
  if (selected && !nodeById(selected)) selected = null;
  syncToolbar();
  if (mod) { applyPreviewSettings(); sendToPreview(); }
  renderOutline(); renderPanel(); renderCode();
}

function removeNode(n) {
  const p = parentOf.get(n.id);
  if (!p) return;
  p.children.splice(p.children.indexOf(n), 1);
}
function insertNode(n, parent, at) {
  parent.children.splice(Math.max(0, Math.min(at, parent.children.length)), 0, n);
}
function newNode(type) {
  const spec = byType[type];
  const n = { id: nextId(), type, props: structuredClone(spec.defaults || {}) };
  if (spec.container) n.children = [];
  return n;
}
function clone(n) {   // a copy with ids past every id in the document
  let m = +nextId().slice(1) - 1;
  const c = structuredClone(n);
  walk(c, (k) => { k.id = 'n' + (++m); });
  return c;
}

// Where a new component goes when it is clicked rather than dragged.
function insertionPoint() {
  const s = selected && nodeById(selected);
  if (!s) return { parent: doc.root, at: doc.root.children.length };
  if (isContainer(s)) return { parent: s, at: s.children.length };
  const p = parentOf.get(s.id);
  return { parent: p, at: p.children.indexOf(s) + 1 };
}

// ---------------------------------------------------------------- preview

function withStrings(strs, fn) {
  const ps = strs.map((s) => mod.cstr(s));
  try { return fn(...ps); } finally { ps.forEach((p) => x.web_free(p)); }
}
const propText = (v) => typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);

function sendToPreview() {
  if (!x) return;
  x.dsg_reset();
  order.forEach((n) => {
    const p = parentOf.get(n.id);
    const parentIndex = p ? order.indexOf(p) : -1;
    const i = withStrings([n.type], (t) => x.dsg_add(t, parentIndex));
    for (const [k, v] of Object.entries(n.props)) if (k !== 'bind') withStrings([k, propText(v)], (a, b) => x.dsg_set(i, a, b));
    if (names.has(n.id)) withStrings(['bind', names.get(n.id)], (a, b) => x.dsg_set(i, a, b));
  });
  x.dsg_commit();
  poke();
}

const previewSize = () => ({ w: Math.max(120, +doc.preview.width || 480), h: Math.max(80, +doc.preview.height || 360) });

// Zoom is the viewer's, not the design's: "fit" shrinks a large preview to the stage, never enlarges it.
let zoomSetting = 'fit', zoom = 1;
function applyZoom() {
  const { w, h } = previewSize(), st = $('#stage');
  zoom = zoomSetting === 'fit' ? Math.max(0.1, Math.min(1, (st.clientWidth - 48) / w, (st.clientHeight - 48) / h)) : +zoomSetting;
  Object.assign($('#frame').style, { width: w + 'px', height: h + 'px', transform: zoom === 1 ? '' : `scale(${zoom})` });
  $('#sizer').style.width = w * zoom + 'px';
  $('#sizer').style.height = h * zoom + 'px';
  // render at the zoomed resolution, so the preview stays sharp
  if (inst) { x.inst_resize(inst, w, h, (window.devicePixelRatio || 1) * zoom); poke(); }
}

function applyPreviewSettings() {
  const { w, h } = previewSize();
  const c = $('#canvas');
  c.style.width = w + 'px'; c.style.height = h + 'px';
  applyZoom();
  x.inst_set_theme(inst, doc.preview.theme === 'dark' ? 1 : 0);
  x.inst_set_accent(inst, Math.max(0, ACCENTS.indexOf(doc.preview.accent || 'neutral')));
  poke();
}

function poke() { dirty = true; if (!raf) raf = requestAnimationFrame(frame); }
setInterval(() => { if (wakeAt && performance.now() >= wakeAt) poke(); }, 50);

function frame(now) {
  raf = 0;
  if (!inst) return;
  const dt = lastT ? Math.min((now - lastT) / 1000, 0.25) : 1 / 60;
  lastT = now;
  dirty = false;
  x.inst_frame(inst, dt, 1);
  const px = mod.pixels(inst), c = $('#canvas');
  if (c.width !== px.w || c.height !== px.h) { c.width = px.w; c.height = px.h; }
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
  if (mode === 'test') {
    c.style.cursor = CURSORS[x.inst_cursor(inst)] || 'default';
    for (let e; (e = x.dsg_take_event()) >= 0;) reportEvent(order[e]);
  } else {
    while (x.dsg_take_event() >= 0) { /* design mode: no input reaches the preview */ }
  }
  drawOverlay();
  const animating = !!x.inst_needs_redraw(inst);
  const w = x.inst_next_wakeup(inst);
  wakeAt = w >= 0 ? now + w * 1000 : 0;
  if (animating || dirty) raf = requestAnimationFrame(frame); else lastT = 0;
}

function rectOf(n) {
  const i = order.indexOf(n);
  const p = i >= 0 ? x.dsg_rect(i) : 0;
  if (!p) return null;
  const f = new Float32Array(mod.memory().buffer, p, 4);
  return { x: f[0], y: f[1], w: f[2], h: f[3] };
}

// ---------------------------------------------------------------- overlay

function box(r, cls, tag) {
  const b = el('div', { class: 'box ' + cls });
  Object.assign(b.style, { left: r.x + 'px', top: r.y + 'px', width: Math.max(r.w, 1) + 'px', height: Math.max(r.h, 1) + 'px' });
  if (tag) { b.append(el('span', { class: 'tag' }, tag)); if (r.y < 22) b.classList.add('tag-below'); }
  return b;
}
let dropHint = null;   // { parent, at, line: {x, y, w, h} } while dragging
function drawOverlay() {
  const o = $('#overlay');
  o.replaceChildren();
  for (const n of order) {
    if (isContainer(n) && n.children.length === 0) { const r = rectOf(n); if (r) o.append(box(r, 'empty')); }
  }
  if (dropHint) {
    const r = rectOf(dropHint.parent);
    if (r) o.append(box(r, 'target'));
    const l = dropHint.line, d = el('div', { class: 'drop' });
    Object.assign(d.style, { left: l.x + 'px', top: l.y + 'px', width: l.w + 'px', height: l.h + 'px' });
    o.append(d);
  }
  const h = hovered && hovered !== selected && nodeById(hovered);
  if (h) { const r = rectOf(h); if (r) o.append(box(r, 'hover')); }
  const s = selected && nodeById(selected);
  if (s) { const r = rectOf(s); if (r) o.append(box(r, 'sel', label(s))); }
}

function label(n) {
  const spec = specOf(n), p = n.props;
  const t = p.label || p.text || p.title || p.name || (p.items ? p.items.split('\n')[0] + '…' : '');
  return spec ? spec.title + (t ? ` · ${String(t).slice(0, 24)}` : '') : n.type;
}

function pointIn(r, px, py) { return r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }

// The deepest node under the point (only containers when `containers`), skipping `skip` and what is inside it.
function hit(px, py, containers, skip) {
  let best = null, bestDepth = -1;
  const visit = (n, depth) => {
    if (skip && n === skip) return;
    if ((!containers || isContainer(n)) && pointIn(rectOf(n), px, py) && depth >= bestDepth) { best = n; bestDepth = depth; }
    for (const c of n.children || []) visit(c, depth + 1);
  };
  visit(doc.root, 0);
  return best || (containers ? doc.root : null);
}

const axisOf = (n) => n.type === 'row' || (n.type === 'card' && n.props.dir === 'row') || (n.type === 'split' && !n.props.vertical) ? 'x'
  : n.type === 'grid' ? 'grid' : 'y';

// Where a drop at the point would go: the container and the index among its children.
function dropAt(px, py, moving) {
  const parent = hit(px, py, true, moving);
  const kids = parent.children.filter((c) => c !== moving);
  const pr = rectOf(parent) || { x: 0, y: 0, w: 0, h: 0 };
  const axis = axisOf(parent);
  let at = kids.length;
  for (let i = 0; i < kids.length; i++) {
    const r = rectOf(kids[i]);
    if (!r) continue;
    const before = axis === 'x' ? px < r.x + r.w / 2
                 : axis === 'y' ? py < r.y + r.h / 2
                 : py < r.y || (py <= r.y + r.h && px < r.x + r.w / 2);
    if (before) { at = i; break; }
  }
  // the line: before the child at `at`, or after the last one
  const ref = kids[at] ? rectOf(kids[at]) : kids.length ? rectOf(kids[kids.length - 1]) : null;
  const after = !kids[at];
  let line;
  if (!ref) line = axis === 'x' ? { x: pr.x + 4, y: pr.y + 4, w: 3, h: Math.max(pr.h - 8, 12) } : { x: pr.x + 4, y: pr.y + 4, w: Math.max(pr.w - 8, 12), h: 3 };
  else if (axis === 'y') line = { x: ref.x, y: (after ? ref.y + ref.h + 2 : ref.y - 3), w: ref.w, h: 3 };
  else line = { x: (after ? ref.x + ref.w + 2 : ref.x - 3), y: ref.y, w: 3, h: ref.h };
  // index in the real children list (with the moving node still in it)
  const realAt = at < kids.length ? parent.children.indexOf(kids[at]) : parent.children.length;
  return { parent, at: realAt, line };
}

function overlayPos(e) {
  return toPoints($('#overlay'), e);
}
// Client pixels to preview points, by the size the element really has on screen: the
// zoom here and any scaling around the page (the webview's own zoom) both count.
function toPoints(elem, e) {
  const r = elem.getBoundingClientRect(), k = r.width / elem.offsetWidth || 1;
  return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
}

// ---------------------------------------------------------------- drag and drop

let drag = null;   // { type } for a new component, { node } to move one; .active once it moved
function startDrag(e, what) {
  drag = { ...what, x0: e.clientX, y0: e.clientY, active: false };
  e.preventDefault();
}
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.active && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
  drag.active = true;
  const g = $('#ghost');
  g.hidden = false;
  g.textContent = drag.type ? byType[drag.type].title : label(drag.node);
  g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px';
  const r = $('#overlay').getBoundingClientRect();
  if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
    const [px, py] = overlayPos(e);
    dropHint = dropAt(px, py, drag.node);
  } else dropHint = null;
  drawOverlay();
});
window.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag, hint = dropHint;
  drag = null; dropHint = null; $('#ghost').hidden = true;
  if (!d.active) {   // a click
    if (d.type) { const n = newNode(d.type), ip = insertionPoint(); insertNode(n, ip.parent, ip.at); selected = n.id; changed(); }
    drawOverlay();
    return;
  }
  if (!hint) { drawOverlay(); return; }
  if (d.type) {
    const n = newNode(d.type);
    insertNode(n, hint.parent, hint.at);
    selected = n.id;
  } else {
    const n = d.node, old = parentOf.get(n.id);
    let at = hint.at;
    if (old === hint.parent && old.children.indexOf(n) < at) at--;
    removeNode(n);
    insertNode(n, hint.parent, at);
    selected = n.id;
  }
  changed();
});

// ---------------------------------------------------------------- design mode input

function bindOverlay() {
  const o = $('#overlay');
  o.addEventListener('pointermove', (e) => {
    if (drag) return;
    const [px, py] = overlayPos(e);
    const h = hit(px, py, false);
    const id = h ? h.id : null;
    if (id !== hovered) { hovered = id; drawOverlay(); }
  });
  o.addEventListener('pointerleave', () => { if (hovered) { hovered = null; drawOverlay(); } });
  o.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [px, py] = overlayPos(e);
    const n = hit(px, py, false) || doc.root;
    select(n.id);
    if (n !== doc.root) startDrag(e, { node: n });
  });
}

function select(id) {
  if (selected === id) return;
  selected = id;
  renderOutline(); renderPanel(); drawOverlay();
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (mode === 'test') { if (t === $('#canvas')) testKey(e, 1); return; }
  if (e.key === 't' && !e.ctrlKey && !e.metaKey) { setMode('test'); return; }
  const s = selected && nodeById(selected);
  if (!s) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && s !== doc.root) { e.preventDefault(); act('delete'); }
  else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); act('up'); }
  else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); act('down'); }
  else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); act('duplicate'); }
  else if (e.key === 'Escape') { const p = parentOf.get(s.id); if (p) select(p.id); }
});
document.addEventListener('keyup', (e) => { if (mode === 'test' && e.target === $('#canvas')) testKey(e, 0); });

function act(what) {
  const s = selected && nodeById(selected);
  if (!s || s === doc.root) return;
  const p = parentOf.get(s.id), i = p.children.indexOf(s);
  if (what === 'delete') { removeNode(s); selected = (p.children[i] || p.children[i - 1] || p).id; }
  else if (what === 'up' && i > 0) { p.children.splice(i, 1); p.children.splice(i - 1, 0, s); }
  else if (what === 'down' && i < p.children.length - 1) { p.children.splice(i, 1); p.children.splice(i + 1, 0, s); }
  else if (what === 'duplicate') { const c = clone(s); p.children.splice(i + 1, 0, c); selected = c.id; }
  else if (what === 'wrap-row' || what === 'wrap-column') {
    const w = newNode(what === 'wrap-row' ? 'row' : 'column');
    p.children.splice(i, 1, w);
    w.children.push(s);
  } else return;
  changed();
}

// ---------------------------------------------------------------- test mode input

const mods = (e) => (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
function testKey(e, down) {
  const k = KEYS[e.code];
  if (k) x.inst_key(inst, k, down, mods(e));
  if (down && e.key.length >= 1 && [...e.key].length === 1 && !e.ctrlKey && !e.metaKey) mod.text(inst, e.key);
  if (k || (down && e.key.length === 1)) e.preventDefault();
  poke();
}
function bindCanvas() {
  const c = $('#canvas');
  const pos = (e) => toPoints(c, e);
  const button = (e) => e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
  c.addEventListener('pointermove', (e) => { if (mode !== 'test') return; x.inst_mouse_move(inst, ...pos(e)); poke(); });
  c.addEventListener('pointerdown', (e) => {
    if (mode !== 'test') return;
    c.focus({ preventScroll: true });
    try { c.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    x.inst_mouse_move(inst, ...pos(e)); x.inst_mouse_button(inst, button(e), 1); poke(); e.preventDefault();
  });
  c.addEventListener('pointerup', (e) => { if (mode !== 'test') return; x.inst_mouse_move(inst, ...pos(e)); x.inst_mouse_button(inst, button(e), 0); poke(); });
  c.addEventListener('pointerleave', () => { x.inst_mouse_leave(inst); poke(); });
  c.addEventListener('wheel', (e) => {
    if (mode !== 'test') return;
    const k = e.deltaMode === 1 ? 1 : e.deltaMode === 2 ? 10 : 1 / 100;
    x.inst_mouse_move(inst, ...pos(e)); x.inst_scroll(inst, -e.deltaX * k, -e.deltaY * k); poke(); e.preventDefault();
  }, { passive: false });
  c.addEventListener('paste', (e) => {
    if (mode !== 'test') return;
    mod.setClipboardCache(e.clipboardData?.getData('text/plain') ?? '');
    x.inst_key(inst, KEYS.KeyV, 1, 2); x.inst_key(inst, KEYS.KeyV, 0, 2); poke(); e.preventDefault();
  });
  c.addEventListener('focus', () => { x.inst_focus(inst, 1); poke(); });
  c.addEventListener('blur', () => { for (const k of Object.values(KEYS)) x.inst_key(inst, k, 0, 0); x.inst_focus(inst, 0); poke(); });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
}

function reportEvent(n) {
  if (!n) return;
  const p = n.props, ev = (specOf(n).props || []).find((x) => x.event), key = ev ? ev.key : 'on_change';
  const h = p[key] && isIdent(p[key]) ? `calls <b>${esc(p[key])}(ui, s)</b>` : `no handler (set “${key.replace('_', ' ')}” to call one)`;
  status(`${esc(label(n))}: ${key.slice(3)} → ${h}`);
}

function setMode(m) {
  mode = m;
  document.body.classList.toggle('test', m === 'test');
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  x.dsg_set_design_mode(m === 'design' ? 1 : 0);
  x.inst_mouse_leave(inst);
  if (m === 'test') { $('#canvas').focus(); status('Try it: the preview takes the mouse and keyboard. Events show here. The Design button goes back.'); }
  else { $('#canvas').style.cursor = 'default'; $('#canvas').blur(); status(hint()); sendToPreview(); }
  poke();
}
const hint = () => 'Drag components from the palette onto the preview, or click one to add it after the selection. <b>Del</b> deletes, <b>Alt+↑/↓</b> moves, <b>Ctrl+D</b> duplicates, <b>Esc</b> selects the parent.';

// ---------------------------------------------------------------- panels

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function status(html) { $('#status').innerHTML = html; }

function renderPalette() {
  const p = $('#palette');
  for (const g of GROUPS) {
    p.append(el('h3', {}, g));
    for (const c of COMPONENTS.filter((c) => c.group === g))
      p.append(el('div', { class: 'pal', title: `Drag onto the preview, or click to add (${c.type})`, onpointerdown: (e) => startDrag(e, { type: c.type }) }, c.title));
  }
}

function renderOutline() {
  const o = $('#outline');
  o.replaceChildren();
  const row = (n, depth) => {
    const spec = specOf(n), t = n.props.label || n.props.text || n.props.title || '';
    const r = el('div', { class: 'tree-row' + (n.id === selected ? ' sel' : ''), role: 'treeitem', style: `padding-left:${4 + depth * 14}px`,
                          onpointerdown: (e) => { select(n.id); if (n !== doc.root) startDrag(e, { node: n }); } },
                 spec ? spec.title : n.type, t ? el('span', { class: 'kind' }, ` ${String(t).slice(0, 28)}`) : null);
    o.append(r);
    for (const c of n.children || []) row(c, depth + 1);
  };
  row(doc.root, 0);
}

function renderCode() {
  try {
    const g = generate(doc, baseName());
    $('#code').textContent = `/* ${g.headerName} */\n${g.header}\n/* ${g.sourceName} */\n${g.source}`;
  } catch (e) { $('#code').textContent = String(e); }
}

function field(prop, n) {
  const p = n.props, v = p[prop.key];
  const set = (val, typing) => {
    if (val === '' || val === undefined || val === false || (typeof val === 'number' && Number.isNaN(val))) delete p[prop.key];
    else p[prop.key] = val;
    changed({ keepPanel: true, typing });
  };
  let input;
  switch (prop.kind) {
    case 'bool':
      input = el('input', { type: 'checkbox', onchange: (e) => set(e.target.checked) });
      input.checked = v === true;
      break;
    case 'number':
      input = el('input', { type: 'number', step: 'any', value: v ?? '', oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value), true) });
      break;
    case 'enum':
      input = el('select', { onchange: (e) => set(e.target.value) }, ...prop.options.map(([val]) => el('option', { value: val }, val || 'default')));
      input.value = v ?? prop.options[0][0];
      break;
    case 'multiline':
      input = el('textarea', { rows: 3, oninput: (e) => set(e.target.value, true) });
      input.value = v ?? '';
      break;
    case 'ident': {
      const placeholder = prop.key === 'bind' ? names.get(n.id) || '' : 'function name';
      input = el('input', { type: 'text', value: v ?? '', placeholder, spellcheck: 'false',
                            oninput: (e) => { const ok = !e.target.value || isIdent(e.target.value); e.target.classList.toggle('bad', !ok); if (ok) set(e.target.value, true); } });
      break;
    }
    default:
      input = el('input', { type: 'text', value: v ?? '', list: prop.kind === 'icon' ? 'icons' : prop.kind === 'size' ? 'sizes' : null,
                            placeholder: prop.kind === 'size' ? 'fit' : prop.kind === 'icon' ? 'none' : '', spellcheck: 'false',
                            oninput: (e) => set(e.target.value, true) });
  }
  return el('label', { class: 'field' + (prop.kind === 'multiline' ? ' top' : '') }, el('span', { title: prop.key }, prop.label), input);
}

function renderPanel() {
  const panel = $('#props');
  panel.replaceChildren();
  const n = (selected && nodeById(selected)) || doc.root;
  const spec = specOf(n);
  panel.append(el('div', { class: 'title' }, el('b', {}, spec ? spec.title : n.type), el('code', {}, n.type)));
  if (n !== doc.root) {
    panel.append(el('div', { class: 'actions' },
      el('button', { onclick: () => act('up'), title: 'Alt+↑' }, '↑'), el('button', { onclick: () => act('down'), title: 'Alt+↓' }, '↓'),
      el('button', { onclick: () => act('duplicate'), title: 'Ctrl+D' }, 'Duplicate'),
      el('button', { onclick: () => act('wrap-row') }, 'Wrap in row'), el('button', { onclick: () => act('wrap-column') }, 'Wrap in column'),
      el('button', { onclick: () => act('delete'), title: 'Del' }, 'Delete')));
  }
  if (spec && spec.note) panel.append(el('p', { class: 'note' }, spec.note));
  if (spec) for (const prop of spec.props) panel.append(field(prop, n));
  if (spec && spec.state) {
    const f = names.get(n.id);
    panel.append(el('p', { class: 'note' }, spec.state === 'range' ? `Its values live in s->${f}_low and s->${f}_high.` : `Its value lives in s->${f}.`));
  }
  if (n === doc.root) {
    panel.append(el('h3', {}, 'Design'));
    const name = el('input', { type: 'text', value: doc.name || '', placeholder: baseName(), spellcheck: 'false',
                               oninput: (e) => { const ok = !e.target.value || isIdent(e.target.value); e.target.classList.toggle('bad', !ok); if (ok) { doc.name = e.target.value || undefined; changed({ keepPanel: true, typing: true }); } } });
    panel.append(el('label', { class: 'field' }, el('span', {}, 'C prefix'), name));
    panel.append(el('p', { class: 'note' }, 'The generated header declares a state struct <prefix>_ui and the functions <prefix>_ui_init and <prefix>_ui_build.'));
  }
}

function syncToolbar() {
  const p = doc.preview, { w, h } = previewSize();
  $('#pw').value = w; $('#ph').value = h;
  $('#theme').value = p.theme === 'dark' ? 'dark' : 'light';
  $('#accent').value = ACCENTS.includes(p.accent) ? p.accent : 'neutral';
}

function bindToolbar() {
  $('#accent').append(...ACCENTS.map((a) => el('option', { value: a }, a)));
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const setPreview = (k, v, typing) => { doc.preview[k] = v; applyPreviewSettings(); changed({ keepPanel: true, typing }); };
  $('#pw').addEventListener('input', (e) => { if (+e.target.value >= 120) setPreview('width', +e.target.value, true); });
  $('#ph').addEventListener('input', (e) => { if (+e.target.value >= 80) setPreview('height', +e.target.value, true); });
  $('#theme').addEventListener('change', (e) => setPreview('theme', e.target.value));
  $('#accent').addEventListener('change', (e) => setPreview('accent', e.target.value));
  $('#gen').addEventListener('click', () => host.postMessage({ type: 'generate' }));
  $('#zoom').addEventListener('change', (e) => { zoomSetting = e.target.value; if (doc) applyZoom(); });
  new ResizeObserver(() => { if (doc && zoomSetting === 'fit') applyZoom(); }).observe($('#stage'));
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((k) => k.classList.toggle('on', k === b));
    $('#props').hidden = b.dataset.tab !== 'props';
    $('#code').hidden = b.dataset.tab !== 'code';
  }));
}

// ---------------------------------------------------------------- start

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.type === 'load') load(m.text, m.fileName);
});

async function main() {
  renderPalette();
  bindToolbar();
  try {
    mod = await loadModule(document.body.dataset.wasm);
  } catch (e) {
    status(`<b>The preview did not load</b>: ${esc(e.message)}. Run editors/vscode/build.sh to build media/designer.wasm.`);
    host.postMessage({ type: 'error', message: 'CUI Designer: ' + e.message });
    return;
  }
  x = mod.exports;
  const icons = $('#icons');
  for (let i = 0; i < x.dsg_icon_count(); i++) {
    const p = x.dsg_icon_name(i);
    const u8 = new Uint8Array(mod.memory().buffer);
    let end = p; while (u8[end]) end++;
    icons.append(el('option', { value: new TextDecoder().decode(u8.subarray(p, end)) }));
  }
  inst = x.inst_new(0, 480, 360, window.devicePixelRatio || 1, 0, -1, 0);
  bindOverlay();
  bindCanvas();
  status(hint());
  // for tests and the console: the document, the module and a node's rectangle
  window.cuiDesigner = { get doc() { return doc; }, mod, inst, rect: (id) => rectOf(nodeById(id)), select, setMode, frame: () => frame(performance.now()) };
  if (doc) { applyPreviewSettings(); sendToPreview(); }
  host.postMessage({ type: 'ready' });
}
main();
