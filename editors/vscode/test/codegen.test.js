// Generates C from samples/*.cui.json and checks it compiles against cui.h
// (clang -fsyntax-only, warnings as errors). Run: node test/codegen.test.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { generate } = require('../media/codegen.js');
const root = path.resolve(__dirname, '../../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cui-designer-'));
let failed = 0;
for (const f of fs.readdirSync(path.join(__dirname, '../samples')).filter((f) => f.endsWith('.cui.json'))) {
  const base = f.replace(/\.cui\.json$/, '');
  const g = generate(JSON.parse(fs.readFileSync(path.join(__dirname, '../samples', f), 'utf8')), base);
  fs.writeFileSync(path.join(out, g.headerName), g.header);
  fs.writeFileSync(path.join(out, g.sourceName), g.source);
  try {
    execFileSync('clang', ['-std=c99', '-fsyntax-only', '-Wall', '-Wextra', '-Werror', '-I', path.join(root, 'include'), path.join(out, g.sourceName)], { stdio: 'pipe' });
    console.log(`ok   ${f} -> ${g.sourceName}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${f}\n${e.stderr}`);
  }
}
console.log(`generated files in ${out}`);
process.exit(failed ? 1 : 0);
