// The components the designer offers, their properties and how each property
// becomes a C option. Used by the webview (palette, property panel) and by
// codegen.js. native/designer.c builds the same kinds with the same options;
// a change here needs the same change there.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CuiComponents = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALIGN = [['', 'default'], ['start', 'CUI_ALIGN_START'], ['center', 'CUI_ALIGN_CENTER'], ['end', 'CUI_ALIGN_END'], ['stretch', 'CUI_ALIGN_STRETCH']];
  const JUSTIFY = [['start', 'CUI_JUSTIFY_START'], ['center', 'CUI_JUSTIFY_CENTER'], ['end', 'CUI_JUSTIFY_END'], ['between', 'CUI_JUSTIFY_BETWEEN'], ['around', 'CUI_JUSTIFY_AROUND']];
  const VARIANT = [['default', 'CUI_BUTTON_DEFAULT'], ['secondary', 'CUI_BUTTON_SECONDARY'], ['primary', 'CUI_BUTTON_PRIMARY'], ['outline', 'CUI_BUTTON_OUTLINE'],
                   ['ghost', 'CUI_BUTTON_GHOST'], ['danger', 'CUI_BUTTON_DANGER'], ['link', 'CUI_BUTTON_LINK']];
  const CONTROL_SIZE = [['md', 'CUI_SIZE_MD'], ['sm', 'CUI_SIZE_SM'], ['lg', 'CUI_SIZE_LG']];
  const TONE = [['neutral', 'CUI_TONE_NEUTRAL'], ['info', 'CUI_TONE_INFO'], ['success', 'CUI_TONE_SUCCESS'], ['warning', 'CUI_TONE_WARNING'],
                ['danger', 'CUI_TONE_DANGER'], ['violet', 'CUI_TONE_VIOLET'], ['teal', 'CUI_TONE_TEAL'], ['rose', 'CUI_TONE_ROSE'], ['accent', 'CUI_TONE_ACCENT']];
  const DIR = [['column', 'CUI_COLUMN'], ['row', 'CUI_ROW']];
  const TABS_VARIANT = [['underline', 'CUI_TABS_UNDERLINE'], ['pill', 'CUI_TABS_PILL']];

  // kind: text | multiline | number | bool | enum | size | icon | ident
  // c: the options field it sets; props without one are arguments or bindings.
  const P = {
    pad: { key: 'pad', label: 'Padding', kind: 'number', c: 'pad' },
    gap: { key: 'gap', label: 'Gap', kind: 'number', c: 'gap' },
    width: { key: 'width', label: 'Width', kind: 'size', c: 'width' },
    height: { key: 'height', label: 'Height', kind: 'size', c: 'height' },
    align: { key: 'align', label: 'Align', kind: 'enum', options: ALIGN, c: 'align' },
    justify: { key: 'justify', label: 'Justify', kind: 'enum', options: JUSTIFY, c: 'justify' },
    label: { key: 'label', label: 'Label', kind: 'text' },
    labelOpt: { key: 'label', label: 'Label', kind: 'text', c: 'label' },
    text: { key: 'text', label: 'Text', kind: 'text' },
    placeholder: { key: 'placeholder', label: 'Placeholder', kind: 'text', c: 'placeholder' },
    hint: { key: 'hint', label: 'Hint', kind: 'text', c: 'hint' },
    description: { key: 'description', label: 'Description', kind: 'text', c: 'description' },
    tooltip: { key: 'tooltip', label: 'Tooltip', kind: 'text', c: 'tooltip' },
    icon: { key: 'icon', label: 'Icon', kind: 'icon', c: 'icon' },
    variant: { key: 'variant', label: 'Variant', kind: 'enum', options: VARIANT, c: 'variant' },
    size: { key: 'size', label: 'Size', kind: 'enum', options: CONTROL_SIZE, c: 'size' },
    tone: { key: 'tone', label: 'Tone', kind: 'enum', options: TONE, c: 'tone' },
    disabled: { key: 'disabled', label: 'Disabled', kind: 'bool', c: 'disabled' },
    fullWidth: { key: 'full_width', label: 'Full width', kind: 'bool', c: 'full_width' },
    showValue: { key: 'show_value', label: 'Show value', kind: 'bool', c: 'show_value' },
    items: { key: 'items', label: 'Items (one per line)', kind: 'multiline' },
    index: { key: 'value', label: 'Selected index', kind: 'number' },
    bind: { key: 'bind', label: 'State field', kind: 'ident' },
    onClick: { key: 'on_click', label: 'On click', kind: 'ident', event: 'click' },
    onChange: { key: 'on_change', label: 'On change', kind: 'ident', event: 'change' },
    onSubmit: { key: 'on_submit', label: 'On Enter', kind: 'ident', event: 'submit' },
  };

  const list = [
    { type: 'column', title: 'Column', group: 'Layout', container: true,
      props: [P.pad, P.gap, P.width, P.height, P.align, P.justify], defaults: { gap: 8 } },
    { type: 'row', title: 'Row', group: 'Layout', container: true,
      props: [P.pad, P.gap, P.width, P.height, P.align, P.justify, { key: 'wrap', label: 'Wrap', kind: 'bool', c: 'wrap' }], defaults: { gap: 8 } },
    { type: 'grid', title: 'Grid', group: 'Layout', container: true,
      props: [{ key: 'columns', label: 'Columns', kind: 'number', c: 'columns' }, { key: 'min_column_width', label: 'Min column width', kind: 'number', c: 'min_column_width' },
              P.pad, P.gap, P.width, P.height], defaults: { columns: 2, gap: 8 } },
    { type: 'card', title: 'Card', group: 'Layout', container: true,
      props: [{ key: 'dir', label: 'Direction', kind: 'enum', options: DIR, c: 'dir' }, P.pad, P.gap, P.width, P.height, P.align,
              { key: 'muted', label: 'Muted', kind: 'bool', c: 'muted' }, { key: 'hoverable', label: 'Hoverable', kind: 'bool', c: 'hoverable' }],
      defaults: { gap: 8 } },
    { type: 'separator', title: 'Separator', group: 'Layout', props: [], defaults: {} },
    { type: 'spacer', title: 'Spacer', group: 'Layout', props: [], defaults: {} },

    { type: 'heading', title: 'Heading', group: 'Text',
      props: [P.text, { key: 'level', label: 'Level', kind: 'enum', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] }],
      defaults: { text: 'Heading', level: '2' } },
    { type: 'text', title: 'Text', group: 'Text',
      props: [{ key: 'text', label: 'Text', kind: 'multiline' },
              { key: 'style', label: 'Style', kind: 'enum', options: [['body', 'cui_text'], ['label', 'cui_label'], ['secondary', 'cui_secondary'], ['muted', 'cui_muted'], ['code', 'cui_code']] }],
      defaults: { text: 'Some text', style: 'body' } },

    { type: 'button', title: 'Button', group: 'Controls',
      props: [P.label, P.variant, P.size, P.icon, P.fullWidth, P.width, P.disabled, P.tooltip, P.onClick],
      defaults: { label: 'Button' } },
    { type: 'icon_button', title: 'Icon button', group: 'Controls',
      props: [{ key: 'icon', label: 'Icon', kind: 'icon' }, P.tooltip, P.variant, P.size, P.disabled, P.onClick],
      defaults: { icon: 'plus', tooltip: 'Add' } },
    { type: 'checkbox', title: 'Checkbox', group: 'Controls', state: 'bool',
      props: [P.label, P.description, { key: 'value', label: 'Checked', kind: 'bool' }, P.disabled, P.bind, P.onChange],
      defaults: { label: 'Checkbox' } },
    { type: 'switch', title: 'Switch', group: 'Controls', state: 'bool',
      props: [P.label, P.description, { key: 'value', label: 'On', kind: 'bool' }, P.disabled, P.bind, P.onChange],
      defaults: { label: 'Switch' } },
    { type: 'slider', title: 'Slider', group: 'Controls', state: 'float',
      props: [P.label, { key: 'min', label: 'Min', kind: 'number' }, { key: 'max', label: 'Max', kind: 'number' }, { key: 'value', label: 'Value', kind: 'number' },
              { key: 'step', label: 'Step', kind: 'number', c: 'step' }, P.showValue, P.width, P.disabled, P.bind, P.onChange],
      defaults: { label: 'Slider', min: 0, max: 100, value: 50 } },
    { type: 'input', title: 'Text field', group: 'Controls', state: 'text',
      props: [P.labelOpt, P.placeholder, { key: 'value', label: 'Text', kind: 'text' }, P.hint, P.icon,
              { key: 'password', label: 'Password', kind: 'bool', c: 'password' }, { key: 'clearable', label: 'Clearable', kind: 'bool', c: 'clearable' },
              P.width, P.disabled, P.bind, P.onSubmit],
      defaults: { label: 'Label', placeholder: 'Placeholder' } },
    { type: 'textarea', title: 'Text area', group: 'Controls', state: 'text',
      props: [P.labelOpt, P.placeholder, { key: 'value', label: 'Text', kind: 'multiline' }, P.hint,
              { key: 'height', label: 'Height', kind: 'number', c: 'height' }, P.width, P.disabled, P.bind, P.onChange],
      defaults: { label: 'Notes', height: 96 } },
    { type: 'select', title: 'Select', group: 'Controls', state: 'int',
      props: [P.labelOpt, P.items, P.index, P.placeholder, P.width, P.disabled, P.bind, P.onChange],
      defaults: { label: 'Choose', items: 'One\nTwo\nThree' } },
    { type: 'segmented', title: 'Segmented', group: 'Controls', state: 'int',
      props: [P.items, P.index, P.fullWidth, P.bind, P.onChange],
      defaults: { items: 'Day\nWeek\nMonth' } },
    { type: 'tabs', title: 'Tabs', group: 'Controls', state: 'int',
      props: [P.items, P.index, { key: 'variant', label: 'Variant', kind: 'enum', options: TABS_VARIANT, c: 'variant' }, P.fullWidth, P.bind, P.onChange],
      defaults: { items: 'Overview\nActivity\nSettings' } },
    { type: 'radio_group', title: 'Radio group', group: 'Controls', state: 'int',
      props: [P.items, P.index, P.bind, P.onChange],
      defaults: { items: 'Small\nMedium\nLarge' } },

    { type: 'progress', title: 'Progress', group: 'Feedback',
      props: [{ key: 'value', label: 'Value (0..1)', kind: 'number' }, P.labelOpt, P.showValue, P.tone, P.width],
      defaults: { value: 0.6 } },
    { type: 'badge', title: 'Badge', group: 'Feedback',
      props: [P.text, P.tone, { key: 'dot', label: 'Dot', kind: 'bool', c: 'dot' }, { key: 'solid', label: 'Solid', kind: 'bool', c: 'solid' }],
      defaults: { text: 'Badge' } },
    { type: 'alert', title: 'Alert', group: 'Feedback',
      props: [{ key: 'title', label: 'Title', kind: 'text' }, P.description, P.tone, P.icon],
      defaults: { title: 'Heads up', description: 'Something needs your attention.', tone: 'info' } },
  ];

  const byType = Object.fromEntries(list.map((c) => [c.type, c]));
  return { list, byType, groups: ['Layout', 'Text', 'Controls', 'Feedback'] };
});
