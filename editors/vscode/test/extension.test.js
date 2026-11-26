// Runs extension.js against a stand-in for the `vscode` module: activation,
// the webview's HTML and content security policy, an edit from the webview,
// and the C files written on save. Run: node test/extension.test.js
'use strict';
const Module = require('module');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');

const HERE = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cui-designer-ext-'));
const designPath = path.join(tmp, 'login.cui.json');
fs.copyFileSync(path.join(HERE, 'samples/login.cui.json'), designPath);

class Uri {
  constructor(p) { this.fsPath = p; }
  static file(p) { return new Uri(p); }
  static joinPath(u, ...parts) { return new Uri(path.join(u.fsPath, ...parts)); }
  toString() { return 'file://' + this.fsPath.replace(/\\/g, '/'); }
}
const listeners = { change: [], save: [] };
const registered = {};
const shown = [];
const document = {
  uri: Uri.file(designPath), fileName: designPath,
  getText: () => fs.readFileSync(designPath, 'utf8'),
  get lineCount() { return this.getText().split('\n').length; },
};
const vscode = {
  Uri,
  Range: class { constructor(...a) { this.a = a; } },
  WorkspaceEdit: class { replace(uri, range, text) { this.op = { uri, range, text }; } },
  window: {
    registerCustomEditorProvider: (type, p) => { registered[type] = p; return { dispose() {} }; },
    showInformationMessage: (m) => shown.push(m), showErrorMessage: (m) => shown.push('ERROR ' + m), setStatusBarMessage: (m) => shown.push(m),
    activeTextEditor: undefined,
  },
  commands: { registerCommand: (id, f) => { registered[id] = f; return { dispose() {} }; }, executeCommand: async () => {} },
  workspace: {
    onDidChangeTextDocument: (f) => { listeners.change.push(f); return { dispose() {} }; },
    onDidSaveTextDocument: (f) => { listeners.save.push(f); return { dispose() {} }; },
    applyEdit: async (e) => { fs.writeFileSync(e.op.uri.fsPath, e.op.text); listeners.change.forEach((f) => f({ document, contentChanges: [{}] })); return true; },
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    fs: { writeFile: async (u, bytes) => fs.writeFileSync(u.fsPath, bytes), stat: async (u) => fs.statSync(u.fsPath) },
    workspaceFolders: [{ uri: Uri.file(tmp) }],
  },
};
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : load.call(this, req, ...rest); };

(async () => {
  const ext = require('../extension.js');
  const subs = [];
  const globalState = new Map();
  const context = { extensionUri: Uri.file(HERE), subscriptions: subs,
                    globalState: { get: (k) => globalState.get(k), update: async (k, v) => { globalState.set(k, v); } } };
  ext.activate(context);
  assert.ok(registered['cui.designer'] && registered['cui.designer.new'] && registered['cui.designer.generate'], 'provider and commands registered');

  // the webview
  const posted = [];
  let onMessage, onDispose;
  const panel = {
    webview: {
      options: null, html: '', cspSource: 'vscode-resource:',
      asWebviewUri: (u) => 'vscode-resource:' + u.fsPath.replace(/\\/g, '/'),
      postMessage: (m) => { posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: (f) => { onMessage = f; return { dispose() {} }; },
    },
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: (f) => { onDispose = f; },
    active: true,
  };
  registered['cui.designer'].resolveCustomTextEditor(document, panel);
  const html = panel.webview.html;
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /'wasm-unsafe-eval'/, 'the CSP lets the preview compile WebAssembly');
  assert.doesNotMatch(html, /\{\{/, 'every placeholder is filled');
  const nonce = /nonce-([^']+)'/.exec(html)[1];
  for (const s of html.match(/<script[^>]*>/g)) assert.ok(s.includes(`nonce="${nonce}"`), 'every script carries the nonce: ' + s);
  assert.match(html, /window\.cuiPrefs = null;/, 'no layout kept yet');
  assert.deepStrictEqual(panel.webview.options.localResourceRoots.map((u) => path.basename(u.fsPath)), ['media']);

  await onMessage({ type: 'ready' });
  assert.strictEqual(posted.at(-1).type, 'load');
  assert.strictEqual(posted.at(-1).fileName, 'login.cui.json');

  // an edit from the webview reaches the document, and is not sent back
  const doc = JSON.parse(document.getText());
  doc.root.children[0].children[0].props.text = 'Hallo';
  const before = posted.length;
  await onMessage({ type: 'edit', text: JSON.stringify(doc, null, 2) + '\n' });
  assert.match(document.getText(), /"Hallo"/);
  assert.strictEqual(posted.length, before, 'no echo of the webview\'s own edit');

  // an edit from elsewhere (undo, the text editor) is sent to the webview
  fs.writeFileSync(designPath, document.getText().replace('"Hallo"', '"Hallo Welt"'));
  listeners.change.forEach((f) => f({ document, contentChanges: [{}] }));
  assert.match(posted.at(-1).text, /Hallo Welt/);

  // saving writes the C files
  listeners.save.forEach((f) => f(document));
  await new Promise((r) => setTimeout(r, 50));
  assert.match(fs.readFileSync(path.join(tmp, 'login.ui.c'), 'utf8'), /cui_heading\(ui, "Hallo Welt", 2\)/);
  assert.ok(fs.existsSync(path.join(tmp, 'login.ui.h')));

  // the generate button and the new design command
  await onMessage({ type: 'generate' });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(shown.some((m) => /wrote login\.ui\.h and login\.ui\.c/.test(m)), shown.join('\n'));
  vscode.window.showInputBox = async () => 'dashboard';
  await registered['cui.designer.new'](Uri.file(tmp));
  const created = JSON.parse(fs.readFileSync(path.join(tmp, 'dashboard.cui.json'), 'utf8'));
  assert.strictEqual(created.name, 'dashboard');
  // the panel layout is kept for the next designer, safely inside its script
  const prefs = { folded: ['Layout'], layout: { left: [], right: [{ width: 300, panels: [{ id: 'inspector', grow: 1 }] }] }, note: '</script>' };
  await onMessage({ type: 'prefs', prefs });
  const next = registered['cui.designer'].html(panel.webview, Uri.file(path.join(HERE, 'media')));
  const kept = /window\.cuiPrefs = (.*);<\/script>/.exec(next);
  assert.ok(kept && !kept[1].includes('</'), 'the prefs cannot end the script early');
  assert.deepStrictEqual(JSON.parse(kept[1]), prefs);
  onDispose();
  console.log('ok   extension: activation, webview HTML and CSP, edits both ways, generate on save, new design, kept layout');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
