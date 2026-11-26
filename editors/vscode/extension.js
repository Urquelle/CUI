// CUI Designer for VS Code: a custom editor for *.cui.json files and the
// commands that create designs and write their C code.
'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generate, newDocument } = require('./media/codegen.js');

const VIEW_TYPE = 'cui.designer';
const baseNameOf = (uri) => path.basename(uri.fsPath).replace(/\.cui\.json$/i, '');

// Writes <name>.ui.h and <name>.ui.c next to the design.
async function writeCode(document, announce) {
  let doc;
  try { doc = JSON.parse(document.getText()); } catch (e) {
    vscode.window.showErrorMessage(`CUI Designer: ${path.basename(document.fileName)} is not valid JSON: ${e.message}`);
    return;
  }
  const g = generate(doc, baseNameOf(document.uri));
  const dir = vscode.Uri.joinPath(document.uri, '..');
  const enc = new TextEncoder();
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, g.headerName), enc.encode(g.header));
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, g.sourceName), enc.encode(g.source));
  const msg = `CUI Designer: wrote ${g.headerName} and ${g.sourceName}`;
  if (announce) vscode.window.showInformationMessage(msg);
  else vscode.window.setStatusBarMessage(msg, 4000);
}

class DesignerProvider {
  constructor(context) {
    this.context = context;
    this.active = null;   // the document of the designer last focused
  }

  resolveCustomTextEditor(document, panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(panel.webview, media);
    this.active = document;

    let fromWebview = null;   // the text the webview sent last, so its own edits are not sent back
    const send = () => panel.webview.postMessage({ type: 'load', text: document.getText(), fileName: path.basename(document.fileName) });
    const subs = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || !e.contentChanges.length) return;
        if (document.getText() !== fromWebview) send();   // undo, redo or the text editor
      }),
      panel.onDidChangeViewState(() => { if (panel.active) this.active = document; }),
      panel.webview.onDidReceiveMessage(async (m) => {
        if (m.type === 'ready') send();
        else if (m.type === 'edit') {
          if (m.text === document.getText()) return;
          fromWebview = m.text;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), m.text);
          await vscode.workspace.applyEdit(edit);
        } else if (m.type === 'generate') writeCode(document, true);
        else if (m.type === 'error') vscode.window.showErrorMessage(m.message);
      }),
    ];
    panel.onDidDispose(() => { subs.forEach((s) => s.dispose()); if (this.active === document) this.active = null; });
  }

  html(webview, media) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const src = webview.cspSource;
    const csp = `default-src 'none'; img-src ${src} data:; style-src ${src} 'unsafe-inline'; font-src ${src}; ` +
                `connect-src ${src}; script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${src};`;
    const template = fs.readFileSync(path.join(media.fsPath, 'designer.html'), 'utf8');
    return template
      .replace('{{cspMeta}}', `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
      .replace('{{bootstrap}}', '')
      .replaceAll('{{nonce}}', nonce)
      .replaceAll('{{media}}', webview.asWebviewUri(media).toString());
  }
}

function activate(context) {
  const provider = new DesignerProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: true } }),

    vscode.commands.registerCommand('cui.designer.new', async (folder) => {
      const name = await vscode.window.showInputBox({ prompt: 'Name of the new design', value: 'screen', validateInput: (v) => /^[A-Za-z_][\w-]*$/.test(v) ? null : 'Letters, digits, _ and -' });
      if (!name) return;
      const dir = folder instanceof vscode.Uri ? folder
        : vscode.window.activeTextEditor ? vscode.Uri.joinPath(vscode.window.activeTextEditor.document.uri, '..')
        : vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!dir) { vscode.window.showErrorMessage('CUI Designer: open a folder first.'); return; }
      const uri = vscode.Uri.joinPath(dir, `${name}.cui.json`);
      try { await vscode.workspace.fs.stat(uri); vscode.window.showErrorMessage(`CUI Designer: ${name}.cui.json already exists.`); return; } catch (e) { /* free */ }
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(newDocument(name), null, 2) + '\n'));
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    }),

    vscode.commands.registerCommand('cui.designer.generate', async (uri) => {
      const document = uri instanceof vscode.Uri ? await vscode.workspace.openTextDocument(uri)
        : provider.active || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
      if (!document || !/\.cui\.json$/i.test(document.fileName)) { vscode.window.showErrorMessage('CUI Designer: open a .cui.json design first.'); return; }
      await writeCode(document, true);
    }),

    vscode.workspace.onDidSaveTextDocument((document) => {
      if (/\.cui\.json$/i.test(document.fileName) && vscode.workspace.getConfiguration('cuiDesigner').get('generateOnSave', true)) writeCode(document, false);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
