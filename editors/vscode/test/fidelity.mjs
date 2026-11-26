// Checks that the preview draws what the generated code draws: for every
// samples/*.cui.json, compiles the generated C to WebAssembly (with the
// objects build.sh made), renders a frame with it and with the designer's
// interpreter at the same size, theme and accent, and compares the pixels.
// Run after build.sh:  node test/fidelity.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from '../media/runtime.js';

const require = createRequire(import.meta.url);
const { generate, resolveNames, walk } = require('../media/codegen.js');
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'build', 'fidelity');
mkdirSync(OUT, { recursive: true });
const ACCENTS = ['neutral', 'violet', 'blue', 'green', 'amber', 'orange', 'coral', 'rose'];
const CFLAGS = ['--target=wasm32', '-O2', '-std=c99', '-g0', '-mbulk-memory', '-mnontrapping-fptoint', '-msign-ext', '-msimd128',
  '-fno-stack-protector', '-ffunction-sections', '-fdata-sections', '-Wall', '-Wextra', '-Werror',
  '-isystem', path.join(ROOT, 'web/shim/include'), '-I', path.join(ROOT, 'include'), '-I', path.join(ROOT, 'src')];
const LDFLAGS = ['--no-entry', '--gc-sections', '--strip-all', '-z', 'stack-size=4194304', '--initial-memory=16777216', '--max-memory=4294967296'];
const objs = readdirSync(path.join(HERE, 'build/obj')).filter((f) => f.endsWith('.o') && f !== 'designer.o').map((f) => path.join(HERE, 'build/obj', f));

async function render(source, doc, design) {
  const mod = await loadModule(source);
  const x = mod.exports;
  if (design) {   // send the document in, as designer.js does
    const names = resolveNames(doc), order = [], parent = new Map();
    walk(doc.root, (n, p) => { order.push(n); if (p) parent.set(n, p); });
    const s = (v) => mod.cstr(typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
    x.dsg_reset();
    x.dsg_set_design_mode(0);
    for (const n of order) {
      const i = x.dsg_add(s(n.type), parent.has(n) ? order.indexOf(parent.get(n)) : -1);
      for (const [k, v] of Object.entries(n.props || {})) if (k !== 'bind') x.dsg_set(i, s(k), s(v));
      if (names.has(n.id)) x.dsg_set(i, s('bind'), s(names.get(n.id)));
    }
    x.dsg_commit();
  }
  const p = doc.preview || {};
  const inst = x.inst_new(0, p.width || 480, p.height || 360, 1, p.theme === 'dark' ? 1 : 0, Math.max(0, ACCENTS.indexOf(p.accent || 'neutral')), 0);
  for (let f = 0; f < 4; f++) x.inst_frame(inst, 1 / 60, f === 3 ? 1 : 0);
  const px = mod.pixels(inst);
  return { w: px.w, h: px.h, data: new Uint8Array(px.data) };
}

let failed = 0;
const designer = readFileSync(path.join(HERE, 'media/designer.wasm'));
for (const f of readdirSync(path.join(HERE, 'samples')).filter((f) => f.endsWith('.cui.json'))) {
  const base = f.replace(/\.cui\.json$/, '');
  const doc = JSON.parse(readFileSync(path.join(HERE, 'samples', f), 'utf8'));
  const g = generate(doc, base);
  writeFileSync(path.join(OUT, g.headerName), g.header);
  writeFileSync(path.join(OUT, g.sourceName), g.source);
  // a host for the generated code: web_host.h's content functions and empty event handlers
  const prefix = g.header.match(/void (\w+)_ui_init/)[1];
  const handlers = [...g.header.matchAll(/^void (\w+)\(cui_ctx \*ui, \w+ \*s\);$/gm)].filter((m) => m[1] !== `${prefix}_ui_build`).map((m) => `void ${m[1]}(cui_ctx *ui, ${prefix}_ui *s) { (void)ui; (void)s; }`);
  writeFileSync(path.join(OUT, `${base}_host.c`), `#include "${g.headerName}"\n#include "../../../../web/host/web_host.h"\n${handlers.join('\n')}\n` +
    `static ${prefix}_ui state; static int ready;\n` +
    'int web_content_count(void) { return 1; }\nconst char *web_content_name(int i) { (void)i; return "generated"; }\n' +
    'float web_content_width(int i) { (void)i; return 480; }\nfloat web_content_height(int i) { (void)i; return 360; }\n' +
    'int web_content_accent(int i) { (void)i; return -1; }\nint web_content_theme(int i) { (void)i; return -1; }\nint web_content_warmup(int i) { (void)i; return 0; }\n' +
    'void web_content_input(int i, cui_ctx *ui, int f) { (void)i; (void)ui; (void)f; }\n' +
    `void web_content_build(int i, cui_ctx *ui, int f) { (void)i; (void)f; if (!ready) { ${prefix}_ui_init(&state); ready = 1; } ${prefix}_ui_build(ui, &state); }\n`);
  const wasm = path.join(OUT, `${base}.wasm`);
  try {
    for (const c of [g.sourceName, `${base}_host.c`]) execFileSync('clang', [...CFLAGS, '-c', path.join(OUT, c), '-o', path.join(OUT, c + '.o')], { stdio: 'pipe' });
    execFileSync('wasm-ld', [...LDFLAGS, path.join(OUT, g.sourceName + '.o'), path.join(OUT, `${base}_host.c.o`), ...objs, '-o', wasm], { stdio: 'pipe' });
  } catch (e) { failed++; console.log(`FAIL ${f}: build\n${e.stderr}`); continue; }
  const a = await render(designer, doc, true), b = await render(readFileSync(wasm), doc, false);
  let diff = 0;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
  const same = a.w === b.w && a.h === b.h && diff === 0;
  if (!same) failed++;
  console.log(`${same ? 'ok  ' : 'FAIL'} ${f}: ${a.w}x${a.h}, ${diff} differing bytes between the preview and the generated code`);
}
process.exit(failed ? 1 : 0);
