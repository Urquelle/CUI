/* The CUI designer's live preview: the webview sends in a tree of components
 * (dsg_reset, dsg_add, dsg_set, dsg_commit) and this file builds it with the
 * real components every frame. It is linked with web/host/web_host.c like the
 * documentation site's modules, which provides the instance, input and
 * rendering exports. The generated C code (media/codegen.js) makes the same
 * calls with the same options, so the preview is what the app will draw. */
#include "cui_internal.h"
#include <cui/cui_icons.h>
#include "../../../web/host/web_host.h"

#define DSG_EXPORT(name) __attribute__((export_name(#name)))

enum { DSG_MAX_NODES = 1024, DSG_MAX_PROPS = 32, DSG_MAX_ITEMS = 32, DSG_MAX_EVENTS = 64, DSG_TEXT_CAP = 256 };

typedef enum dsg_kind {
    DSG_COLUMN, DSG_ROW, DSG_GRID, DSG_CARD,
    DSG_HEADING, DSG_TEXT, DSG_BUTTON, DSG_ICON_BUTTON,
    DSG_CHECKBOX, DSG_SWITCH, DSG_SLIDER, DSG_INPUT, DSG_TEXTAREA,
    DSG_SELECT, DSG_SEGMENTED, DSG_TABS, DSG_RADIO_GROUP,
    DSG_PROGRESS, DSG_BADGE, DSG_ALERT, DSG_SEPARATOR, DSG_SPACER,
    DSG_KIND_COUNT
} dsg_kind;

/* The names media/components.js uses for the same kinds. */
static const char *const dsg_kind_names[DSG_KIND_COUNT] = {
    "column", "row", "grid", "card",
    "heading", "text", "button", "icon_button",
    "checkbox", "switch", "slider", "input", "textarea",
    "select", "segmented", "tabs", "radio_group",
    "progress", "badge", "alert", "separator", "spacer",
};

typedef struct dsg_prop { char *key, *value; } dsg_prop;

typedef struct dsg_node {
    dsg_kind kind;
    int parent, first, last, next;
    dsg_prop props[DSG_MAX_PROPS];
    int prop_count;
    char *items_text;                     /* "items" with its lines split in place */
    const char *items[DSG_MAX_ITEMS];
    int item_count;
    /* live values, so the preview can be tried out like the app */
    bool on;
    float value;
    int index;
    char text[DSG_TEXT_CAP];
    int ui_node;                          /* its first node in the latest frame, or -1 */
} dsg_node;

static dsg_node dsg_nodes[DSG_MAX_NODES];
static int dsg_node_count;
static bool dsg_design_mode = true;       /* empty containers get a size to drop into */
static cui_ctx *dsg_last_ui;              /* the context of the latest frame, for dsg_rect */
static int dsg_events[DSG_MAX_EVENTS];    /* nodes whose event fired, oldest first */
static int dsg_event_count;
static float dsg_rect_out[4];

typedef struct dsg_icon { const char *name, *glyph; } dsg_icon;
static const dsg_icon dsg_icons[] = {
#include "dsg_icons.inc"                  /* generated from cui_icons.h by build.sh */
};
enum { DSG_ICON_COUNT = (int)(sizeof dsg_icons / sizeof dsg_icons[0]) };

/* ---------------------------------------------------------------- the document */

static void dsg_free_node(dsg_node *n) {
    for (int k = 0; k < n->prop_count; k++) { free(n->props[k].key); free(n->props[k].value); }
    free(n->items_text);
    memset(n, 0, sizeof *n);
}

DSG_EXPORT(dsg_reset) void dsg_reset(void) {
    for (int i = 0; i < dsg_node_count; i++) dsg_free_node(&dsg_nodes[i]);
    dsg_node_count = 0;
    dsg_event_count = 0;
}

/* Adds a node of `kind` as the last child of `parent` (-1 for the root).
 * Returns its index, or -1 for an unknown kind or a full document. */
DSG_EXPORT(dsg_add) int dsg_add(const char *kind, int parent) {
    int k = 0;
    while (k < DSG_KIND_COUNT && strcmp(dsg_kind_names[k], kind) != 0) k++;
    if (k == DSG_KIND_COUNT || dsg_node_count == DSG_MAX_NODES) return -1;
    if (parent >= dsg_node_count) return -1;
    int i = dsg_node_count++;
    dsg_node *n = &dsg_nodes[i];
    memset(n, 0, sizeof *n);
    n->kind = (dsg_kind)k;
    n->parent = parent;
    n->first = n->last = n->next = -1;
    n->ui_node = -1;
    if (parent >= 0) {
        dsg_node *p = &dsg_nodes[parent];
        if (p->last >= 0) dsg_nodes[p->last].next = i; else p->first = i;
        p->last = i;
    }
    return i;
}

static const char *dsg_get(const dsg_node *n, const char *key) {
    for (int k = 0; k < n->prop_count; k++)
        if (strcmp(n->props[k].key, key) == 0) return n->props[k].value;
    return NULL;
}

static void dsg_split_items(dsg_node *n, const char *text) {
    free(n->items_text);
    n->items_text = strdup(text);
    n->item_count = 0;
    char *s = n->items_text;
    while (*s && n->item_count < DSG_MAX_ITEMS) {
        n->items[n->item_count++] = s;
        char *nl = strchr(s, '\n');
        if (!nl) break;
        *nl = 0;
        s = nl + 1;
    }
}

DSG_EXPORT(dsg_set) void dsg_set(int i, const char *key, const char *value) {
    if (i < 0 || i >= dsg_node_count) return;
    dsg_node *n = &dsg_nodes[i];
    for (int k = 0; k < n->prop_count; k++)
        if (strcmp(n->props[k].key, key) == 0) { free(n->props[k].value); n->props[k].value = strdup(value); goto stored; }
    if (n->prop_count == DSG_MAX_PROPS) return;
    n->props[n->prop_count].key = strdup(key);
    n->props[n->prop_count].value = strdup(value);
    n->prop_count++;
stored:
    if (strcmp(key, "items") == 0) dsg_split_items(n, value);
}

static float dsg_num(const dsg_node *n, const char *key, float fallback) {
    const char *v = dsg_get(n, key);
    if (!v || !*v) return fallback;
    return strtof(v, NULL);
}
static bool dsg_flag(const dsg_node *n, const char *key) {
    const char *v = dsg_get(n, key);
    return v && strcmp(v, "true") == 0;
}
/* A string option: NULL when empty, as the generated code leaves it out. */
static const char *dsg_opt(const dsg_node *n, const char *key) {
    const char *v = dsg_get(n, key);
    return v && *v ? v : NULL;
}
static const char *dsg_str(const dsg_node *n, const char *key) {
    const char *v = dsg_get(n, key);
    return v ? v : "";
}
static int dsg_enum(const dsg_node *n, const char *key, const char *const *names, int count) {
    const char *v = dsg_get(n, key);
    if (v) for (int k = 0; k < count; k++) if (strcmp(names[k], v) == 0) return k;
    return 0;
}
/* "" or "fit", "fill", "200" (points) or "50%" */
static cui_size dsg_size(const dsg_node *n, const char *key) {
    const char *v = dsg_get(n, key);
    if (!v || !*v || strcmp(v, "fit") == 0) return CUI_FIT;
    if (strcmp(v, "fill") == 0) return CUI_FILL;
    char *end;
    float x = strtof(v, &end);
    return *end == '%' ? CUI_PCT(x) : CUI_PX(x);
}
static const char *dsg_icon_glyph(const dsg_node *n, const char *key) {
    const char *v = dsg_get(n, key);
    if (v && *v) for (int k = 0; k < DSG_ICON_COUNT; k++) if (strcmp(dsg_icons[k].name, v) == 0) return dsg_icons[k].glyph;
    return NULL;
}

/* Sets the live values from the document, after it was sent in. */
DSG_EXPORT(dsg_commit) void dsg_commit(void) {
    for (int i = 0; i < dsg_node_count; i++) {
        dsg_node *n = &dsg_nodes[i];
        n->on = dsg_flag(n, "value");
        n->value = dsg_num(n, "value", 0);
        n->index = (int)dsg_num(n, "value", 0);
        snprintf(n->text, sizeof n->text, "%s", n->kind == DSG_INPUT || n->kind == DSG_TEXTAREA ? dsg_str(n, "value") : "");
    }
}

/* ---------------------------------------------------------------- building */

static const char *const dsg_align_names[] = { "", "start", "center", "end", "stretch" };
static const char *const dsg_justify_names[] = { "start", "center", "end", "between", "around" };
static const char *const dsg_variant_names[] = { "default", "secondary", "primary", "outline", "ghost", "danger", "link" };
static const char *const dsg_control_size_names[] = { "md", "sm", "lg" };
static const char *const dsg_tone_names[] = { "neutral", "info", "success", "warning", "danger", "violet", "teal", "rose", "accent" };
static const char *const dsg_tabs_variant_names[] = { "underline", "pill" };
static const char *const dsg_dir_names[] = { "column", "row" };
#define DSG_ENUM(n, key, names) dsg_enum((n), (key), (names), (int)(sizeof(names) / sizeof(names[0])))

static void dsg_event(int i) {
    if (dsg_event_count < DSG_MAX_EVENTS) dsg_events[dsg_event_count++] = i;
}

static void dsg_build_node(cui_ctx *ui, int i);
static void dsg_build_children(cui_ctx *ui, const dsg_node *n) {
    for (int c = n->first; c >= 0; c = dsg_nodes[c].next) dsg_build_node(ui, c);
}

static cui_box dsg_box_opts(const dsg_node *n) {
    cui_box b = { 0 };
    b.width = dsg_size(n, "width");
    b.height = dsg_size(n, "height");
    b.pad = dsg_num(n, "pad", 0);
    b.gap = dsg_num(n, "gap", 0);
    b.align = (cui_align)DSG_ENUM(n, "align", dsg_align_names);
    b.justify = (cui_justify)DSG_ENUM(n, "justify", dsg_justify_names);
    b.wrap = dsg_flag(n, "wrap");
    if (n->kind == DSG_GRID) {
        b.dir = CUI_GRID;
        b.columns = (int)dsg_num(n, "columns", 0);
        b.min_column_width = dsg_num(n, "min_column_width", 0);
    }
    if (dsg_design_mode && n->first < 0) { b.min_width = 96; b.min_height = 40; }
    return b;
}

static void dsg_build_container(cui_ctx *ui, const dsg_node *n) {
    if (n->kind == DSG_CARD) {
        cui_card_opts o = { 0 };
        o.width = dsg_size(n, "width");
        o.height = dsg_size(n, "height");
        o.pad = dsg_num(n, "pad", 0);
        o.gap = dsg_num(n, "gap", 0);
        o.dir = DSG_ENUM(n, "dir", dsg_dir_names) ? CUI_ROW : CUI_COLUMN;
        o.align = (cui_align)DSG_ENUM(n, "align", dsg_align_names);
        o.muted = dsg_flag(n, "muted");
        o.hoverable = dsg_flag(n, "hoverable");
        if (dsg_design_mode && n->first < 0) o.min_width = 96;
        cui_card_begin(ui, &o);
        if (dsg_design_mode && n->first < 0) cui_gap(ui, 40);
        dsg_build_children(ui, n);
        cui_card_end(ui);
        return;
    }
    cui_box b = dsg_box_opts(n);
    if (n->kind == DSG_ROW) cui_row_begin(ui, &b);
    else if (n->kind == DSG_COLUMN) cui_column_begin(ui, &b);
    else cui_box_begin(ui, &b);
    dsg_build_children(ui, n);
    cui_box_end(ui);
}

/* The text controls and lists need an id; the generated code uses the same one. */
static const char *dsg_id(const dsg_node *n) { return dsg_str(n, "bind"); }

static void dsg_build_control(cui_ctx *ui, int i) {
    dsg_node *n = &dsg_nodes[i];
    switch (n->kind) {
    case DSG_HEADING: cui_heading(ui, dsg_str(n, "text"), (int)dsg_num(n, "level", 2)); break;
    case DSG_TEXT: {
        const char *style = dsg_str(n, "style"), *t = dsg_str(n, "text");
        if (strcmp(style, "label") == 0) cui_label(ui, t);
        else if (strcmp(style, "secondary") == 0) cui_secondary(ui, t);
        else if (strcmp(style, "muted") == 0) cui_muted(ui, t);
        else if (strcmp(style, "code") == 0) cui_code(ui, t);
        else cui_text(ui, t);
        break;
    }
    case DSG_BUTTON:
    case DSG_ICON_BUTTON: {
        cui_button_opts o = { 0 };
        o.variant = (cui_button_variant)DSG_ENUM(n, "variant", dsg_variant_names);
        o.size = (cui_control_size)DSG_ENUM(n, "size", dsg_control_size_names);
        o.disabled = dsg_flag(n, "disabled");
        o.tooltip = dsg_opt(n, "tooltip");
        bool clicked;
        if (n->kind == DSG_BUTTON) {
            o.icon = dsg_icon_glyph(n, "icon");
            o.full_width = dsg_flag(n, "full_width");
            o.width = dsg_size(n, "width");
            clicked = cui_button_ex(ui, dsg_str(n, "label"), &o);
        } else {
            const char *g = dsg_icon_glyph(n, "icon");
            clicked = cui_icon_button_ex(ui, g ? g : CUI_ICON_PLUS, &o);
        }
        if (clicked) dsg_event(i);
        break;
    }
    case DSG_CHECKBOX:
    case DSG_SWITCH: {
        cui_check_opts o = { 0 };
        o.description = dsg_opt(n, "description");
        o.disabled = dsg_flag(n, "disabled");
        bool changed = n->kind == DSG_CHECKBOX ? cui_checkbox_ex(ui, dsg_str(n, "label"), &n->on, &o)
                                               : cui_switch_ex(ui, dsg_str(n, "label"), &n->on, &o);
        if (changed) dsg_event(i);
        break;
    }
    case DSG_SLIDER: {
        cui_slider_opts o = { 0 };
        o.step = dsg_num(n, "step", 0);
        o.show_value = dsg_flag(n, "show_value");
        o.disabled = dsg_flag(n, "disabled");
        o.width = dsg_size(n, "width");
        if (cui_slider_ex(ui, dsg_str(n, "label"), &n->value, dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o)) dsg_event(i);
        break;
    }
    case DSG_INPUT:
    case DSG_TEXTAREA: {
        cui_input_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.placeholder = dsg_opt(n, "placeholder");
        o.hint = dsg_opt(n, "hint");
        o.disabled = dsg_flag(n, "disabled");
        o.width = dsg_size(n, "width");
        int r;
        if (n->kind == DSG_INPUT) {
            o.icon = dsg_icon_glyph(n, "icon");
            o.password = dsg_flag(n, "password");
            o.clearable = dsg_flag(n, "clearable");
            r = cui_input_ex(ui, dsg_id(n), n->text, sizeof n->text, &o);
            if (r & CUI_SUBMITTED) dsg_event(i);
        } else {
            o.height = dsg_num(n, "height", 0);
            r = cui_textarea_ex(ui, dsg_id(n), n->text, sizeof n->text, &o);
            if (r & CUI_CHANGED) dsg_event(i);
        }
        break;
    }
    case DSG_SELECT: {
        cui_select_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.placeholder = dsg_opt(n, "placeholder");
        o.disabled = dsg_flag(n, "disabled");
        o.width = dsg_size(n, "width");
        if (cui_select_ex(ui, dsg_id(n), n->items, n->item_count, &n->index, &o)) dsg_event(i);
        break;
    }
    case DSG_SEGMENTED: {
        cui_segmented_opts o = { 0 };
        o.full_width = dsg_flag(n, "full_width");
        if (cui_segmented_ex(ui, dsg_id(n), n->items, n->item_count, &n->index, &o)) dsg_event(i);
        break;
    }
    case DSG_TABS: {
        cui_tabs_opts o = { 0 };
        o.variant = (cui_tabs_variant)DSG_ENUM(n, "variant", dsg_tabs_variant_names);
        o.full_width = dsg_flag(n, "full_width");
        if (cui_tabs_ex(ui, dsg_id(n), n->items, n->item_count, &n->index, &o)) dsg_event(i);
        break;
    }
    case DSG_RADIO_GROUP:
        if (cui_radio_group(ui, dsg_id(n), n->items, n->item_count, &n->index)) dsg_event(i);
        break;
    case DSG_PROGRESS: {
        cui_progress_opts o = { 0 };
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        o.label = dsg_opt(n, "label");
        o.show_value = dsg_flag(n, "show_value");
        o.width = dsg_size(n, "width");
        cui_progress_ex(ui, dsg_num(n, "value", 0), &o);
        break;
    }
    case DSG_BADGE: {
        cui_badge_opts o = { 0 };
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        o.dot = dsg_flag(n, "dot");
        o.solid = dsg_flag(n, "solid");
        cui_badge_ex(ui, dsg_str(n, "text"), &o);
        break;
    }
    case DSG_ALERT: {
        cui_alert_opts o = { 0 };
        o.description = dsg_opt(n, "description");
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        o.icon = dsg_icon_glyph(n, "icon");
        cui_alert_ex(ui, dsg_str(n, "title"), &o);
        break;
    }
    case DSG_SEPARATOR: cui_separator(ui); break;
    case DSG_SPACER: cui_spacer(ui); break;
    default: break;
    }
}

static void dsg_build_node(cui_ctx *ui, int i) {
    dsg_node *n = &dsg_nodes[i];
    int first = ui->node_count;
    if (n->kind <= DSG_CARD) dsg_build_container(ui, n);
    else dsg_build_control(ui, i);
    n->ui_node = ui->node_count > first ? first : -1;
}

/* ---------------------------------------------------------------- web_host.h */

int web_content_count(void) { return 1; }
const char *web_content_name(int i) { (void)i; return "designer"; }
float web_content_width(int i) { (void)i; return 480; }
float web_content_height(int i) { (void)i; return 360; }
int web_content_accent(int i) { (void)i; return -1; }
int web_content_theme(int i) { (void)i; return -1; }
int web_content_warmup(int i) { (void)i; return 0; }
void web_content_input(int i, cui_ctx *ui, int f) { (void)i; (void)ui; (void)f; }
void web_content_build(int i, cui_ctx *ui, int f) {
    (void)i; (void)f;
    dsg_last_ui = ui;
    for (int k = 0; k < dsg_node_count; k++) dsg_nodes[k].ui_node = -1;
    if (dsg_node_count > 0) dsg_build_node(ui, 0);
}

/* ---------------------------------------------------------------- queries */

DSG_EXPORT(dsg_set_design_mode) void dsg_set_design_mode(int on) { dsg_design_mode = on != 0; }

/* The rectangle of node i in the latest frame (x, y, w, h in points), or NULL
 * when it was not built. */
DSG_EXPORT(dsg_rect) const float *dsg_rect(int i) {
    if (!dsg_last_ui || i < 0 || i >= dsg_node_count) return NULL;
    int k = dsg_nodes[i].ui_node;
    if (k < 0 || k >= dsg_last_ui->node_count) return NULL;
    cui_rect r = dsg_last_ui->nodes[k].rect;
    dsg_rect_out[0] = r.x; dsg_rect_out[1] = r.y; dsg_rect_out[2] = r.w; dsg_rect_out[3] = r.h;
    return dsg_rect_out;
}

/* The oldest node whose event fired (a click, a change, Enter), or -1. */
DSG_EXPORT(dsg_take_event) int dsg_take_event(void) {
    if (dsg_event_count == 0) return -1;
    int i = dsg_events[0];
    memmove(dsg_events, dsg_events + 1, (size_t)(dsg_event_count - 1) * sizeof dsg_events[0]);
    dsg_event_count--;
    return i;
}

DSG_EXPORT(dsg_icon_count) int dsg_icon_count(void) { return DSG_ICON_COUNT; }
DSG_EXPORT(dsg_icon_name) const char *dsg_icon_name(int k) { return k >= 0 && k < DSG_ICON_COUNT ? dsg_icons[k].name : ""; }
