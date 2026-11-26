// Loads media/designer.wasm in Node, sends in a small document, builds a frame
// with the software renderer and prints each node's rectangle.
import { readFileSync } from 'node:fs';
import { loadModule } from '../media/runtime.js';
const bytes = readFileSync(new URL('../media/designer.wasm', import.meta.url));
const mod = await loadModule(bytes);
const x = mod.exports;
const call = (f, ...strs) => { const ps = strs.map((s) => typeof s === 'string' ? mod.cstr(s) : s); const r = f(...ps); ps.forEach((p, i) => typeof strs[i] === 'string' && x.web_free(p)); return r; };
x.dsg_reset();
const root = call(x.dsg_add, 'column', -1);
call(x.dsg_set, root, 'pad', '24'); call(x.dsg_set, root, 'gap', '12'); call(x.dsg_set, root, 'width', 'fill');
const h = call(x.dsg_add, 'heading', root); call(x.dsg_set, h, 'text', 'Sign in');
const inp = call(x.dsg_add, 'input', root); call(x.dsg_set, inp, 'label', 'Email'); call(x.dsg_set, inp, 'bind', 'email');
const row = call(x.dsg_add, 'row', root); call(x.dsg_set, row, 'gap', '8');
const b = call(x.dsg_add, 'button', row); call(x.dsg_set, b, 'label', 'Sign in'); call(x.dsg_set, b, 'variant', 'primary'); call(x.dsg_set, b, 'icon', 'log_in');
const sel = call(x.dsg_add, 'select', root); call(x.dsg_set, sel, 'items', 'Admin\nUser'); call(x.dsg_set, sel, 'bind', 'role');
x.dsg_commit();
const inst = x.inst_new(0, 480, 360, 1, 0, -1, 0);
x.inst_frame(inst, 1 / 60, 1);
const f32 = () => new Float32Array(mod.memory().buffer);
for (let i = 0; i < 6; i++) { const p = x.dsg_rect(i); console.log(i, p ? Array.from(f32().subarray(p >> 2, (p >> 2) + 4)) : null); }
console.log('icons', x.dsg_icon_count());
const px = mod.pixels(inst); let ink = 0; for (let i = 0; i < px.data.length; i += 4) if (px.data[i] < 128) ink++;
console.log('pixels', px.w, px.h, 'dark pixels', ink);
