// The designer webview in a plain browser, for working on it without VS Code:
//   node test/serve.js [samples/login.cui.json]   then open http://localhost:8790/
//   (or http://localhost:8790/?design=samples/settings.cui.json for another design,
//   &select=n12 to select a node, &tab=code to show the generated code)
// A stand-in for the VS Code API sends the design in and keeps the edits in
// window.cuiDevEdits (the latest text is also printed to the console).
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const HERE = path.resolve(__dirname, '..');
const PORT = +(process.env.PORT || 8790);
const design = process.argv[2] || 'samples/login.cui.json';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html' };

const bootstrap = `<script>
window.cuiDevEdits = [];
window.cuiDevHost = {
  state: undefined,
  getState() { return this.state; },
  setState(s) { this.state = s; },
  postMessage(m) {
    const q = new URLSearchParams(location.search), design = q.get('design') || '${design}';
    if (m.type === 'ready') fetch('/' + design).then((r) => r.text()).then((text) => {
      window.postMessage({ type: 'load', text, fileName: design.split('/').pop() }, '*');
      // ?select=n12&tab=code: a node selected and a panel tab shown, for screenshots
      setTimeout(() => {
        if (q.get('select')) window.cuiDesigner.select(q.get('select'));
        if (q.get('tab')) document.querySelector('[data-tab="' + q.get('tab') + '"]').click();
      }, 100);
    });
    else if (m.type === 'edit') { window.cuiDevEdits.push(m.text); console.log('[edit]', m.text.length, 'bytes'); }
    else console.log('[host]', JSON.stringify(m));
  },
};
</script>`;

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') {
    const html = fs.readFileSync(path.join(HERE, 'media/designer.html'), 'utf8')
      .replace('{{cspMeta}}', '').replace('{{bootstrap}}', bootstrap)
      .replaceAll('{{nonce}}', 'dev').replaceAll('{{media}}', '/media');
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(html);
  }
  const file = path.join(HERE, url);
  if (!file.startsWith(HERE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`CUI designer: http://localhost:${PORT}/`));
