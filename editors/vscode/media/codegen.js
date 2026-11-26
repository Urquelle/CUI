// Turns a designer document (*.cui.json) into C: a header with the state
// struct, the event handlers to write and two functions, and a source file
// that builds the UI with the same calls native/designer.c makes for the
// preview. Runs in the extension (Node) and in the webview.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./components.js'));
  else root.CuiCodegen = factory(root.CuiComponents);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  const C_KEYWORDS = new Set(('auto break case char const continue default do double else enum extern float for goto if inline int long register ' +
    'restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false ui s').split(' '));
  const TEXT_CAP = 256;   // native/designer.c DSG_TEXT_CAP: the preview holds as much

  // A C identifier from any text: "Remember me" -> "remember_me".
  function ident(text, fallback) {
    let s = String(text || '').replace(/ß/g, 'ss').replace(/[æÆ]/g, 'ae').replace(/[øØ]/g, 'o').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = fallback;
    if (/^[0-9]/.test(s)) s = '_' + s;
    if (C_KEYWORDS.has(s)) s += '_';
    return s;
  }
  const isIdent = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !C_KEYWORDS.has(s);

  function walk(node, fn, parent = null) {
    fn(node, parent);
    for (const c of node.children || []) walk(c, fn, node);
  }

  // The state field of every node that keeps a value, by node id: its "bind"
  // when that is a free identifier, else one made from its label and unique.
  function resolveNames(doc) {
    const names = new Map(), used = new Set();
    walk(doc.root, (n) => {
      const spec = C.byType[n.type];
      if (!spec || !spec.state) return;
      const p = n.props || {};
      let base = p.bind && isIdent(p.bind) ? p.bind : ident(p.label || p.title || (p.items || '').split('\n')[0], n.type);
      let name = base, k = 2;
      while (used.has(name)) name = `${base}_${k++}`;
      used.add(name);
      names.set(n.id, name);
    });
    return names;
  }

  // C string literal; bytes outside ASCII as octal escapes, so the file reads
  // the same in any source encoding a compiler assumes.
  function str(s) {
    let out = '"';
    for (const b of new TextEncoder().encode(String(s))) {
      if (b === 0x22) out += '\\"';
      else if (b === 0x5c) out += '\\\\';
      else if (b === 0x0a) out += '\\n';
      else if (b === 0x09) out += '\\t';
      else if (b < 0x20 || b >= 0x7f) out += '\\' + b.toString(8).padStart(3, '0');
      else out += String.fromCharCode(b);
    }
    return out + '"';
  }
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : '0';
  }
  function floatLit(v) {
    const s = num(v);
    return /[.e]/.test(s) ? s + 'f' : s;
  }
  function size(v) {
    v = String(v ?? '').trim();
    if (!v || v === 'fit') return null;
    if (v === 'fill') return 'CUI_FILL';
    if (v.endsWith('%')) return `CUI_PCT(${num(v.slice(0, -1))})`;
    return `CUI_PX(${num(v)})`;
  }
  const iconMacro = (name) => 'CUI_ICON_' + String(name).toUpperCase();
  // "2026-11-26" as year, month and day, or null: native/designer.c reads it the same way
  function parseDate(v) {
    const m = /^(\d+)-(\d+)-(\d+)$/.exec(String(v || ''));
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
    return [+m[1], +m[2], +m[3]];
  }
  function colorExpr(spec, key, value) {   // a theme color property as an expression, or null for none
    const prop = spec.props.find((x) => x.key === key);
    const i = prop.options.findIndex((o) => o[0] === value);
    return i > 0 ? prop.options[i][1] : null;
  }

  // ", .field = value" for every option that differs from its zero value.
  function options(spec, props) {
    let out = '';
    for (const p of spec.props) {
      if (!p.c) continue;
      const v = props[p.key];
      let expr = null;
      if (p.kind === 'bool') expr = v === true ? 'true' : null;
      else if (p.kind === 'number') expr = v !== undefined && v !== '' && Number(v) !== 0 ? num(v) : null;
      else if (p.kind === 'size') expr = size(v);
      else if (p.kind === 'icon') expr = v ? iconMacro(v) : null;
      else if (p.kind === 'enum') {
        const i = p.options.findIndex((o) => o[0] === v);
        expr = i > 0 ? p.options[i][1] : null;
      } else expr = v ? str(v) : null;
      if (expr !== null) out += `, .${p.c} = ${expr}`;
    }
    return out;
  }

  function items(props) {
    const t = props.items || '';
    return t === '' ? [] : t.split('\n');
  }

  function generate(doc, baseName) {
    const prefix = ident(doc.name || baseName, 'screen');
    const type = `${prefix}_ui`;
    const names = resolveNames(doc);
    const fields = [], arrays = [], handlers = new Map(), inits = [];
    let usesIcons = false, usesText = false;

    const handlerCall = (p, key) => {
      const h = p[key];
      if (!h || !isIdent(h)) return null;
      handlers.set(h, true);
      return `${h}(ui, s);`;
    };

    function emit(n, depth) {
      const spec = C.byType[n.type];
      const pad = '    '.repeat(depth);
      if (!spec) return `${pad}/* unknown component "${n.type}" */\n`;
      const p = n.props || {};
      const o = options(spec, p);
      if (o.includes('CUI_ICON_') || (n.type === 'icon_button')) usesIcons = true;
      const field = names.get(n.id);
      const ref = field ? `s->${field}` : null;
      const wrap = (call, key, test) => {   // "if (call) handler(ui, s);" when the node has a handler
        const h = handlerCall(p, key);
        return h ? `${pad}if (${test ? test(call) : call}) ${h}\n` : `${pad}${call};\n`;
      };
      const itemsArg = () => {
        const list = items(p);
        if (!list.length) return 'NULL, 0';
        const arr = `${prefix}_${field || n.id}_items`;
        arrays.push(`static const char *const ${arr}[] = { ${list.map(str).join(', ')} };`);
        return `${arr}, ${list.length}`;
      };

      if (n.type === 'split') {   // the first child is the first pane, the others the second
        fields.push(`    float ${field};`);
        if (Number(p.value)) inits.push(`    s->${field} = ${floatLit(p.value)};`);
        const [first, ...rest] = n.children || [];
        const inner = (first ? emit(first, depth + 1) : '') + `${pad}    cui_split_next(ui);\n` + rest.map((c) => emit(c, depth + 1)).join('');
        return `${pad}cui_split(ui, ${str(field)}, &${ref}${o}) {\n${inner}${pad}}\n`;
      }
      if (spec.container) {
        let head;
        if (n.type === 'accordion') {
          fields.push(`    bool ${field};`);
          if (p.value === true) inits.push(`    s->${field} = true;`);
          head = `cui_accordion(ui, ${str(p.title || '')}, &${ref})`;
        } else if (n.type === 'grid') head = `cui_box(ui, .dir = CUI_GRID${o})`;
        else head = `cui_${n.type}(ui${o})`;
        const kids = (n.children || []).map((c) => emit(c, depth + 1)).join('');
        return kids ? `${pad}${head} {\n${kids}${pad}}\n` : `${pad}${head} {}\n`;
      }
      switch (n.type) {
        case 'separator': return `${pad}cui_separator(ui);\n`;
        case 'spacer': return `${pad}cui_spacer(ui);\n`;
        case 'heading': return `${pad}cui_heading(ui, ${str(p.text || '')}, ${num(p.level || 2)});\n`;
        case 'text': {
          const fn = (spec.props[1].options.find((x) => x[0] === p.style) || ['', 'cui_text'])[1];
          return `${pad}${fn}(ui, ${str(p.text || '')});\n`;
        }
        case 'button': return wrap(`cui_button(ui, ${str(p.label || '')}${o})`, 'on_click');
        case 'icon_button': return wrap(`cui_icon_button(ui, ${iconMacro(p.icon || 'plus')}${o})`, 'on_click');
        case 'checkbox':
        case 'switch':
          fields.push(`    bool ${field};`);
          if (p.value === true) inits.push(`    s->${field} = true;`);
          return wrap(`cui_${n.type}(ui, ${str(p.label || '')}, &${ref}${o})`, 'on_change');
        case 'slider':
          fields.push(`    float ${field};`);
          if (Number(p.value)) inits.push(`    s->${field} = ${floatLit(p.value)};`);
          return wrap(`cui_slider(ui, ${str(p.label || '')}, &${ref}, ${floatLit(p.min ?? 0)}, ${floatLit(p.max ?? 100)}${o})`, 'on_change');
        case 'input':
        case 'textarea': {
          fields.push(`    char ${field}[${TEXT_CAP}];`);
          if (p.value) usesText = true;
          if (p.value) inits.push(`    snprintf(s->${field}, sizeof s->${field}, "%s", ${str(p.value)});`);
          const call = `cui_${n.type}(ui, ${str(field)}, ${ref}, sizeof ${ref}${o})`;
          return n.type === 'input' ? wrap(call, 'on_submit', (c) => `${c} & CUI_SUBMITTED`)
                                    : wrap(call, 'on_change', (c) => `${c} & CUI_CHANGED`);
        }
        case 'select':
        case 'segmented':
        case 'tabs': {
          fields.push(`    int ${field};`);
          if (Number(p.value)) inits.push(`    s->${field} = ${num(Math.trunc(Number(p.value)))};`);
          return wrap(`cui_${n.type}(ui, ${str(field)}, ${itemsArg()}, &${ref}${o})`, 'on_change');
        }
        case 'radio_group':
          fields.push(`    int ${field};`);
          if (Number(p.value)) inits.push(`    s->${field} = ${num(Math.trunc(Number(p.value)))};`);
          return wrap(`cui_radio_group(ui, ${str(field)}, ${itemsArg()}, &${ref})`, 'on_change');
        case 'link': return wrap(`cui_link(ui, ${str(p.text || '')})`, 'on_click');
        case 'kbd': return `${pad}cui_kbd(ui, ${str(p.text || '')});\n`;
        case 'icon':
          usesIcons = true;
          return `${pad}cui_icon(ui, ${iconMacro(p.icon || 'star')}, ${floatLit(p.size ?? 0)}, ${colorExpr(spec, 'color', p.color) || 'CUI_TRANSPARENT'});\n`;
        case 'search':
          fields.push(`    char ${field}[${TEXT_CAP}];`);
          if (p.value) { usesText = true; inits.push(`    snprintf(s->${field}, sizeof s->${field}, "%s", ${str(p.value)});`); }
          return wrap(`cui_search(ui, ${str(field)}, ${ref}, sizeof ${ref}${o})`, 'on_submit', (c) => `${c} & CUI_SUBMITTED`);
        case 'number':
          fields.push(`    double ${field};`);
          if (Number(p.value)) inits.push(`    s->${field} = ${num(p.value)};`);
          return wrap(`cui_number(ui, ${str(field)}, &${ref}, ${num(p.min ?? 0)}, ${num(p.max ?? 100)}${o})`, 'on_change');
        case 'chip':
          fields.push(`    bool ${field};`);
          if (p.value === true) inits.push(`    s->${field} = true;`);
          return wrap(`cui_chip(ui, ${str(p.label || '')}, &${ref}${o})`, 'on_change');
        case 'rating':
          fields.push(`    int ${field};`);
          if (Number(p.value)) inits.push(`    s->${field} = ${num(Math.trunc(Number(p.value)))};`);
          return wrap(`cui_rating(ui, ${str(field)}, &${ref}, ${num(Math.trunc(Number(p.max ?? 5)))})`, 'on_change');
        case 'range_slider':
          fields.push(`    float ${field}_low, ${field}_high;`);
          if (Number(p.low)) inits.push(`    s->${field}_low = ${floatLit(p.low)};`);
          if (Number(p.high)) inits.push(`    s->${field}_high = ${floatLit(p.high)};`);
          return wrap(`cui_range_slider(ui, ${str(p.label || '')}, &${ref}_low, &${ref}_high, ${floatLit(p.min ?? 0)}, ${floatLit(p.max ?? 100)})`, 'on_change');
        case 'date_picker': {
          fields.push(`    cui_date ${field};`);
          const d = parseDate(p.value);
          if (d) inits.push(`    s->${field} = (cui_date){ ${d.join(', ')} };`);
          return wrap(`cui_date_picker(ui, ${str(field)}, &${ref}${o})`, 'on_change');
        }
        case 'nav_section': return `${pad}cui_nav_section(ui, ${str(p.title || '')});\n`;
        case 'nav_item': return wrap(`cui_nav_item(ui, ${str(p.label || '')}${o})`, 'on_click');
        case 'breadcrumb': return wrap(`cui_breadcrumb(ui, ${itemsArg()})`, 'on_click', (c) => `${c} >= 0`);
        case 'pagination':
          fields.push(`    int ${field};`);
          if (Number(p.value)) inits.push(`    s->${field} = ${num(Math.trunc(Number(p.value)))};`);
          return wrap(`cui_pagination(ui, ${str(field)}, &${ref}, ${num(Math.trunc(Number(p.count ?? 1)))})`, 'on_change');
        case 'stepper': return `${pad}cui_stepper(ui, ${itemsArg()}, ${num(Math.trunc(Number(p.current ?? 0)))});\n`;
        case 'spinner': return `${pad}cui_spinner(ui, ${floatLit(p.size ?? 0)}${o});\n`;
        case 'skeleton': return `${pad}cui_skeleton(ui, ${size(p.width) || 'CUI_FIT'}, ${floatLit(p.height ?? 0)});\n`;
        case 'empty_state': return wrap(`cui_empty_state(ui, ${str(p.title || '')}${o})`, 'on_click');
        case 'avatar': return `${pad}cui_avatar(ui, ${str(p.name || '')}${o});\n`;
        case 'list_item': return wrap(`cui_list_item(ui, ${str(p.title || '')}${o})`, 'on_click');
        case 'meter': return `${pad}cui_meter(ui, ${str(p.label || '')}, ${floatLit(p.used ?? 0)}, ${floatLit(p.total ?? 0)}, ${str(p.unit || '')});\n`;
        case 'progress': return `${pad}cui_progress(ui, ${floatLit(p.value ?? 0)}${o});\n`;
        case 'badge': return `${pad}cui_badge(ui, ${str(p.text || '')}${o});\n`;
        case 'alert': return `${pad}cui_alert(ui, ${str(p.title || '')}${o});\n`;
      }
      return `${pad}/* "${n.type}" is not generated yet */\n`;
    }

    const body = emit(doc.root, 1);
    const guard = `${prefix.toUpperCase()}_UI_H`;
    const headerName = `${baseName}.ui.h`, sourceName = `${baseName}.ui.c`;
    const banner = (what) => `/* Generated by the CUI designer from ${baseName}.cui.json. Do not edit: the designer\n * overwrites this file when the design is saved.${what ? '\n * ' + what : ''} */\n`;

    const header =
      banner('Write the event handlers in a file of your own.') +
      `#ifndef ${guard}\n#define ${guard}\n\n#include <cui/cui.h>\n\n` +
      `typedef struct ${type} {\n${fields.length ? fields.join('\n') : '    int unused;'}\n} ${type};\n\n` +
      (handlers.size ? `/* Events: called from ${prefix}_ui_build when they happen. */\n` +
        [...handlers.keys()].map((h) => `void ${h}(cui_ctx *ui, ${type} *s);`).join('\n') + '\n\n' : '') +
      `/* Sets the values chosen in the designer. */\nvoid ${prefix}_ui_init(${type} *s);\n` +
      `/* Builds the UI; call it every frame. */\nvoid ${prefix}_ui_build(cui_ctx *ui, ${type} *s);\n\n#endif\n`;

    const source =
      banner('') +
      `#include "${headerName}"\n` + (usesIcons ? '#include <cui/cui_icons.h>\n' : '') + (usesText ? '#include <stdio.h>\n' : '') +
      '#include <string.h>\n\n' +
      (arrays.length ? arrays.join('\n') + '\n\n' : '') +
      `void ${prefix}_ui_init(${type} *s) {\n    memset(s, 0, sizeof *s);\n${inits.join('\n')}${inits.length ? '\n' : ''}}\n\n` +
      `void ${prefix}_ui_build(cui_ctx *ui, ${type} *s) {\n${body}}\n`;

    return { headerName, sourceName, header, source };
  }

  // A new document: a padded column that fills the window.
  function newDocument(name) {
    return {
      cui_designer: 1,
      name: ident(name, 'screen'),
      preview: { width: 480, height: 360, theme: 'light', accent: 'neutral' },
      root: { id: 'n1', type: 'column', props: { pad: 24, gap: 12, width: 'fill', height: 'fill' }, children: [] },
    };
  }

  return { generate, resolveNames, ident, isIdent, newDocument, walk };
});
