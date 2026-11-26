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

enum { DSG_MAX_NODES = 1024, DSG_MAX_PROPS = 32, DSG_MAX_ITEMS = 32, DSG_MAX_EVENTS = 64, DSG_TEXT_CAP = 256, DSG_MAX_COLUMNS = 16 };

typedef enum dsg_kind {
    /* containers first: dsg_is_container relies on it */
    DSG_COLUMN, DSG_ROW, DSG_GRID, DSG_CARD, DSG_SCROLL, DSG_ACCORDION, DSG_SPLIT, DSG_DIALOG, DSG_SHEET, DSG_BUTTON_GROUP, DSG_EXPANDABLE_CARD, DSG_DIALOG_FOOTER,
    DSG_HEADING, DSG_TEXT, DSG_LINK, DSG_KBD, DSG_ICON, DSG_BUTTON, DSG_ICON_BUTTON,
    DSG_CHECKBOX, DSG_SWITCH, DSG_SLIDER, DSG_INPUT, DSG_TEXTAREA,
    DSG_SELECT, DSG_SEGMENTED, DSG_TABS, DSG_RADIO_GROUP,
    DSG_SEARCH, DSG_NUMBER, DSG_CHIP, DSG_RATING, DSG_RANGE_SLIDER, DSG_DATE_PICKER,
    DSG_NAV_SECTION, DSG_NAV_ITEM, DSG_BREADCRUMB, DSG_PAGINATION, DSG_STEPPER,
    DSG_PROGRESS, DSG_BADGE, DSG_ALERT, DSG_SPINNER, DSG_SKELETON, DSG_EMPTY_STATE,
    DSG_AVATAR, DSG_LIST_ITEM, DSG_METER, DSG_SEPARATOR, DSG_SPACER, DSG_TABLE, DSG_DATA_GRID,
    DSG_COLOR_PICKER, DSG_TAG_INPUT, DSG_OTP, DSG_RADIO_CARDS, DSG_COPY_BUTTON, DSG_HOLD_BUTTON,
    DSG_PASSWORD_STRENGTH, DSG_PROGRESS_RING, DSG_METRIC, DSG_TIMELINE_ITEM,
    /* from "More components" */
    DSG_EXPANDABLE_TEXT, DSG_SHIMMER_TEXT, DSG_GRADIENT_TEXT,
    DSG_SPLIT_BUTTON, DSG_TOGGLE_GROUP, DSG_CONFIRM_BUTTON, DSG_STATUS_BUTTON,
    DSG_INLINE_EDIT, DSG_SCRUB, DSG_MONEY, DSG_SHORTCUT_RECORDER, DSG_MULTI_SELECT, DSG_DATE_RANGE, DSG_TIME_PICKER, DSG_WHEEL_PICKER,
    DSG_KNOB, DSG_FADER, DSG_RULER_SLIDER, DSG_RATIO_SLIDER, DSG_STEP_SLIDER, DSG_GRADIENT_SLIDER, DSG_ASPECT_PICKER, DSG_SEED_FIELD,
    DSG_BANNER, DSG_COUNTDOWN, DSG_STATUS_SPINNER, DSG_LOADER, DSG_STATUS_TAG,
    DSG_COUNTER, DSG_RADIAL_GAUGE, DSG_READOUT,
    DSG_KIND_COUNT
} dsg_kind;
#define dsg_is_container(k) ((k) <= DSG_DIALOG_FOOTER)

/* The names media/components.js uses for the same kinds. */
static const char *const dsg_kind_names[DSG_KIND_COUNT] = {
    "column", "row", "grid", "card", "scroll", "accordion", "split", "dialog", "sheet", "button_group", "expandable_card", "dialog_footer",
    "heading", "text", "link", "kbd", "icon", "button", "icon_button",
    "checkbox", "switch", "slider", "input", "textarea",
    "select", "segmented", "tabs", "radio_group",
    "search", "number", "chip", "rating", "range_slider", "date_picker",
    "nav_section", "nav_item", "breadcrumb", "pagination", "stepper",
    "progress", "badge", "alert", "spinner", "skeleton", "empty_state",
    "avatar", "list_item", "meter", "separator", "spacer", "table", "data_grid",
    "color_picker", "tag_input", "otp", "radio_cards", "copy_button", "hold_button",
    "password_strength", "progress_ring", "metric", "timeline_item",
    "expandable_text", "shimmer_text", "gradient_text",
    "split_button", "toggle_group", "confirm_button", "status_button",
    "inline_edit", "scrub", "money", "shortcut_recorder", "multi_select", "date_range", "time_picker", "wheel_picker",
    "knob", "fader", "ruler_slider", "ratio_slider", "step_slider", "gradient_slider", "aspect_picker", "seed_field",
    "banner", "countdown", "status_spinner", "loader", "status_tag",
    "counter", "radial_gauge", "readout",
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
    float value, high;                    /* a slider's value or a split's ratio; a range's low and high */
    int index;
    double number;
    cui_date date;
    cui_color color;
    char text[DSG_TEXT_CAP];
    bool shown;                           /* a dialog or sheet that was open in the latest frame */
    /* a table's "columns" and "rows", split in place */
    char *columns_text, *rows_text;
    int column_count, row_count;
    cui_table_column table_columns[DSG_MAX_COLUMNS];
    cui_grid_column grid_columns[DSG_MAX_COLUMNS];
    const char **cells;                   /* row_count * column_count, "" where a row is short */
    char *choices_text;                   /* radio cards' "choices", split in place */
    cui_choice choices[DSG_MAX_ITEMS];
    int choice_count;
    float spark[DSG_MAX_ITEMS];           /* a metric's sparkline */
    int spark_count;
    bool flags[DSG_MAX_ITEMS];            /* the items that are on: a toggle group's, a multi-select's */
    const char *icons[DSG_MAX_ITEMS];     /* "icons" beside the items, NULL where a line names none */
    bool has_icons;
    char *labels_text;                    /* a step slider's "labels", split in place */
    const char *labels[DSG_MAX_ITEMS];
    int label_count;
    int hour, minute;
    cui_date_range range;
    cui_key_combo combo;
    uint32_t seed;
    bool locked;
    int ui_node;                          /* its first node in the latest frame, or -1 */
} dsg_node;

static dsg_node dsg_nodes[DSG_MAX_NODES];
static int dsg_node_count;
static bool dsg_design_mode = true;       /* empty containers get a size to drop into */
static cui_ctx *dsg_last_ui;              /* the context of the latest frame, for dsg_rect */
static int dsg_events[DSG_MAX_EVENTS];    /* nodes whose event fired, oldest first */
static int dsg_event_count;
static float dsg_rect_out[4];
static int dsg_selected = -1;             /* the node selected in the designer, which shows the dialog it is in */

typedef struct dsg_icon { const char *name, *glyph; } dsg_icon;
static const dsg_icon dsg_icons[] = {
#include "dsg_icons.inc"                  /* generated from cui_icons.h by build.sh */
};
enum { DSG_ICON_COUNT = (int)(sizeof dsg_icons / sizeof dsg_icons[0]) };

/* ---------------------------------------------------------------- the document */

static void dsg_free_node(dsg_node *n) {
    for (int k = 0; k < n->prop_count; k++) { free(n->props[k].key); free(n->props[k].value); }
    free(n->items_text);
    free(n->columns_text);
    free(n->rows_text);
    free(n->cells);
    free(n->choices_text);
    free(n->labels_text);
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

/* The lines of text, in a copy kept in *store and split in place; a last empty
 * line is dropped. Returns how many, at most DSG_MAX_ITEMS. media/codegen.js lines. */
static int dsg_split_lines(char **store, const char *text, const char **out) {
    free(*store);
    *store = strdup(text);
    int count = 0;
    char *s = *store;
    while (*s && count < DSG_MAX_ITEMS) {
        out[count++] = s;
        char *nl = strchr(s, '\n');
        if (!nl) break;
        *nl = 0;
        s = nl + 1;
    }
    return count;
}
static void dsg_split_items(dsg_node *n, const char *text) { n->item_count = dsg_split_lines(&n->items_text, text, n->items); }

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
static const char *dsg_find_icon(const char *name) {
    if (name && *name) for (int k = 0; k < DSG_ICON_COUNT; k++) if (strcmp(dsg_icons[k].name, name) == 0) return dsg_icons[k].glyph;
    return NULL;
}
static const char *dsg_icon_glyph(const dsg_node *n, const char *key) { return dsg_find_icon(dsg_get(n, key)); }

/* "2026-11-26"; anything else is no date. */
static cui_date dsg_parse_date(const char *v) {
    cui_date d = { 0, 0, 0 };
    int part[3] = { 0, 0, 0 }, k = 0, digits = 0;
    for (; v && *v && k < 3; v++) {
        if (*v >= '0' && *v <= '9') { part[k] = part[k] * 10 + (*v - '0'); digits++; }
        else if (*v == '-' && digits) { k++; digits = 0; }
        else return d;
    }
    if (k == 2 && digits && part[1] >= 1 && part[1] <= 12 && part[2] >= 1 && part[2] <= 31) { d.year = part[0]; d.month = part[1]; d.day = part[2]; }
    return d;
}

/* Leading and trailing blanks off, in place. */
static char *dsg_trim(char *s) {
    while (*s == ' ' || *s == '\t' || *s == '\r') s++;
    size_t len = strlen(s);
    while (len && (s[len - 1] == ' ' || s[len - 1] == '\t' || s[len - 1] == '\r')) s[--len] = 0;
    return s;
}

/* One line of "columns": "Title, 120, right". After the title come a width
 * (points, "fill" or a percentage) and an alignment, in any order.
 * media/codegen.js parseColumns reads it the same way. */
static void dsg_parse_column(char *line, cui_table_column *t, cui_grid_column *g) {
    memset(t, 0, sizeof *t);
    memset(g, 0, sizeof *g);
    for (int k = 0; line; k++) {
        char *comma = strchr(line, ',');
        if (comma) *comma = 0;
        char *v = dsg_trim(line);
        if (k == 0) t->title = g->title = v;
        else if (strcmp(v, "left") == 0) t->align = g->align = CUI_TEXT_LEFT;
        else if (strcmp(v, "right") == 0) t->align = g->align = CUI_TEXT_RIGHT;
        else if (strcmp(v, "center") == 0) t->align = g->align = CUI_TEXT_CENTER;
        else if (strcmp(v, "end") == 0) t->align = g->align = CUI_TEXT_END;
        else if (strcmp(v, "fill") == 0) t->width = CUI_FILL;
        else if (*v) {
            char *end;
            float x = strtof(v, &end);
            if (end != v && *end == '%') t->width = CUI_PCT(x);
            else if (end != v) { t->width = CUI_PX(x); g->width = x; }
        }
        line = comma ? comma + 1 : NULL;
    }
}

/* "columns" one per line, "rows" one per line with cells between "|"; blank lines are skipped. */
static void dsg_parse_table(dsg_node *n) {
    free(n->columns_text); free(n->rows_text); free(n->cells);
    n->columns_text = strdup(dsg_str(n, "columns"));
    n->rows_text = strdup(dsg_str(n, "rows"));
    n->column_count = n->row_count = 0;
    n->cells = NULL;
    for (char *line = n->columns_text; line && n->column_count < DSG_MAX_COLUMNS;) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = 0;
        if (*dsg_trim(line)) { dsg_parse_column(line, &n->table_columns[n->column_count], &n->grid_columns[n->column_count]); n->column_count++; }
        line = nl ? nl + 1 : NULL;
    }
    int lines = 1;
    for (const char *c = n->rows_text; *c; c++) lines += *c == '\n';
    n->cells = calloc((size_t)lines * (size_t)(n->column_count ? n->column_count : 1), sizeof *n->cells);
    for (char *line = n->rows_text; line;) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = 0;
        char *row = dsg_trim(line);
        if (*row && n->column_count) {
            const char **out = n->cells + (size_t)n->row_count * (size_t)n->column_count;
            for (int c = 0; c < n->column_count; c++) {
                char *bar = row ? strchr(row, '|') : NULL;
                if (bar) *bar = 0;
                out[c] = row ? dsg_trim(row) : "";
                row = bar ? bar + 1 : NULL;
            }
            n->row_count++;
        }
        line = nl ? nl + 1 : NULL;
    }
}

/* "#3b82f6" or "3b82f6"; anything else is no color, as in media/codegen.js parseHex. */
static cui_color dsg_parse_hex(const char *v) {
    cui_color c = { 0, 0, 0, 0 };
    if (!v) return c;
    if (*v == '#') v++;
    unsigned x = 0;
    for (int k = 0; k < 6; k++) {
        char h = v[k];
        int d = h >= '0' && h <= '9' ? h - '0' : h >= 'a' && h <= 'f' ? h - 'a' + 10 : h >= 'A' && h <= 'F' ? h - 'A' + 10 : -1;
        if (d < 0) return c;
        x = x * 16 + (unsigned)d;
    }
    if (v[6]) return c;
    c.r = (uint8_t)(x >> 16); c.g = (uint8_t)(x >> 8); c.b = (uint8_t)x; c.a = 255;
    return c;
}

/* Radio cards' "choices": one per line, "title | description | icon | badge"; blank
 * lines are skipped, empty parts are left out. As in media/codegen.js parseChoices. */
static void dsg_parse_choices(dsg_node *n) {
    free(n->choices_text);
    n->choices_text = strdup(dsg_str(n, "choices"));
    n->choice_count = 0;
    for (char *line = n->choices_text; line && n->choice_count < DSG_MAX_ITEMS;) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = 0;
        char *rest = dsg_trim(line);
        if (*rest) {
            const char *part[4] = { NULL, NULL, NULL, NULL };
            for (int k = 0; k < 4 && rest; k++) {
                char *bar = strchr(rest, '|');
                if (bar) *bar = 0;
                char *t = dsg_trim(rest);
                part[k] = *t ? t : NULL;
                rest = bar ? bar + 1 : NULL;
            }
            cui_choice *ch = &n->choices[n->choice_count++];
            ch->title = part[0] ? part[0] : "";
            ch->description = part[1];
            ch->icon = dsg_find_icon(part[2]);
            ch->badge = part[3];
        }
        line = nl ? nl + 1 : NULL;
    }
}

/* A metric's "spark": numbers between commas; a part that is not a plain number is
 * skipped. As in media/codegen.js parseSpark. */
static void dsg_parse_spark(dsg_node *n) {
    n->spark_count = 0;
    const char *v = dsg_str(n, "spark");
    while (*v && n->spark_count < DSG_MAX_ITEMS) {
        const char *comma = strchr(v, ',');
        size_t len = comma ? (size_t)(comma - v) : strlen(v);
        char tok[48];
        if (len < sizeof tok) {
            memcpy(tok, v, len);
            tok[len] = 0;
            char *t = dsg_trim(tok), *end;
            bool plain = *t != 0;
            for (const char *c = t; *c; c++) if (!strchr("0123456789.eE+-", *c)) plain = false;
            float x = plain ? strtof(t, &end) : 0;
            if (plain && !*end) n->spark[n->spark_count++] = x;
        }
        if (!comma) break;
        v = comma + 1;
    }
}

/* A one-time code field's box count, 1..12, 6 when unset: media/codegen.js otpLength. */
static int dsg_otp_length(const dsg_node *n) {
    int len = (int)dsg_num(n, "length", 6);
    return len < 1 ? 1 : len > 12 ? 12 : len;
}

/* The kinds whose state is text, which a password strength meter can rate. */
static bool dsg_holds_text(dsg_kind k) {
    return k == DSG_INPUT || k == DSG_TEXTAREA || k == DSG_SEARCH || k == DSG_TAG_INPUT || k == DSG_OTP || k == DSG_INLINE_EDIT;
}

/* "0, 2": the items that are on; a part that is not a number below the item count is
 * skipped. As in media/codegen.js parseIndexes. */
static void dsg_parse_flags(dsg_node *n) {
    memset(n->flags, 0, sizeof n->flags);
    for (const char *v = dsg_str(n, "value");;) {
        const char *comma = strchr(v, ',');
        size_t len = comma ? (size_t)(comma - v) : strlen(v);
        const char *t = v;
        while (len && (*t == ' ' || *t == '\t' || *t == '\r' || *t == '\n')) { t++; len--; }
        while (len && (t[len - 1] == ' ' || t[len - 1] == '\t' || t[len - 1] == '\r' || t[len - 1] == '\n')) len--;
        bool digits = len > 0;
        long x = 0;
        for (size_t k = 0; k < len && digits; k++) {
            if (t[k] < '0' || t[k] > '9') digits = false;
            else if (x < 100000) x = x * 10 + (t[k] - '0');
        }
        if (digits && x < n->item_count) n->flags[x] = true;
        if (!comma) break;
        v = comma + 1;
    }
}

/* "icons": one name per line beside the items, as in media/codegen.js iconsOpt. */
static void dsg_parse_icons(dsg_node *n) {
    memset(n->icons, 0, sizeof n->icons);
    n->has_icons = false;
    const char *v = dsg_str(n, "icons");
    for (int k = 0; k < n->item_count; k++) {
        const char *nl = strchr(v, '\n');
        size_t len = nl ? (size_t)(nl - v) : strlen(v);
        char name[64];
        if (len < sizeof name) {
            memcpy(name, v, len);
            name[len] = 0;
            n->icons[k] = dsg_find_icon(dsg_trim(name));
            if (n->icons[k]) n->has_icons = true;
        }
        if (!nl) break;
        v = nl + 1;
    }
}

/* "09:30": one or two digits, a colon, one or two digits; anything else is 0:00.
 * As in media/codegen.js parseTime. */
static void dsg_parse_time(const char *v, int *hour, int *minute) {
    *hour = *minute = 0;
    if (!v) return;
    while (*v == ' ' || *v == '\t') v++;
    int part[2] = { 0, 0 };
    for (int k = 0; k < 2; k++) {
        int digits = 0;
        while (*v >= '0' && *v <= '9' && digits < 3) { part[k] = part[k] * 10 + (*v++ - '0'); digits++; }
        if (digits < 1 || digits > 2) return;
        if (k == 0 && *v++ != ':') return;
    }
    while (*v == ' ' || *v == '\t') v++;
    if (*v || part[0] > 23 || part[1] > 59) return;
    *hour = part[0];
    *minute = part[1];
}

/* A seed: a whole number 0..4294967295, else 0, as in media/codegen.js seedOf. */
static uint32_t dsg_parse_seed(const char *v) {
    if (!v || !*v) return 0;
    char *end;
    double d = strtod(v, &end);
    while (*end == ' ' || *end == '\t') end++;
    if (*end || !(d >= 0 && d < 4294967296.0)) return 0;
    return (uint32_t)d;
}

static const char *const dsg_work_names[] = { "idle", "busy", "success", "error" };

/* Sets the live values from the document, after it was sent in. */
DSG_EXPORT(dsg_commit) void dsg_commit(void) {
    for (int i = 0; i < dsg_node_count; i++) {
        dsg_node *n = &dsg_nodes[i];
        n->on = dsg_flag(n, "value");
        n->value = n->kind == DSG_RANGE_SLIDER ? dsg_num(n, "low", 0) : dsg_num(n, "value", 0);
        n->high = dsg_num(n, "high", 0);
        n->index = (int)dsg_num(n, "value", n->kind == DSG_TABLE || n->kind == DSG_DATA_GRID ? -1 : 0);
        if (n->kind == DSG_TABLE || n->kind == DSG_DATA_GRID) dsg_parse_table(n);
        const char *v = dsg_get(n, "value");
        n->number = v && *v ? strtod(v, NULL) : 0;
        n->date = dsg_parse_date(v);
        snprintf(n->text, sizeof n->text, "%s", dsg_holds_text(n->kind) && n->kind != DSG_OTP ? dsg_str(n, "value") : "");
        if (n->kind == DSG_OTP) {   /* printable ASCII, at most one character per box: media/codegen.js otpInit */
            int len = dsg_otp_length(n), k = 0;
            for (const char *c = dsg_str(n, "value"); *c && k < len; c++) if (*c >= 0x20 && *c < 0x7f) n->text[k++] = *c;
            n->text[k] = 0;
        }
        n->color = dsg_parse_hex(v);
        if (n->kind == DSG_RADIO_CARDS) dsg_parse_choices(n);
        if (n->kind == DSG_METRIC) dsg_parse_spark(n);
        if (n->kind == DSG_TOGGLE_GROUP || n->kind == DSG_MULTI_SELECT) dsg_parse_flags(n);
        if (n->kind == DSG_TOGGLE_GROUP || n->kind == DSG_MULTI_SELECT || n->kind == DSG_SPLIT_BUTTON) dsg_parse_icons(n);
        if (n->kind == DSG_STEP_SLIDER) n->label_count = dsg_split_lines(&n->labels_text, dsg_str(n, "labels"), n->labels);
        if (n->kind == DSG_STATUS_BUTTON || n->kind == DSG_STATUS_SPINNER) n->index = dsg_enum(n, "value", dsg_work_names, 4);
        dsg_parse_time(v, &n->hour, &n->minute);
        n->range.start = dsg_parse_date(dsg_get(n, "start"));
        n->range.end = dsg_parse_date(dsg_get(n, "end"));
        memset(&n->combo, 0, sizeof n->combo);
        n->seed = dsg_parse_seed(v);
        n->locked = dsg_flag(n, "locked");
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
static const char *const dsg_color_names[] = { "", "background", "surface", "surface_muted", "foreground", "secondary", "muted", "border",
                                               "accent", "accent_subtle", "success", "warning", "danger", "info" };
static const char *const dsg_spinner_names[] = { "arc", "comet", "dot_matrix", "radar", "ripple", "orbit", "bounce", "pulse" };
static const cui_spinner_style dsg_spinner_styles[] = { CUI_SPINNER_ARC, CUI_SPINNER_COMET, CUI_SPINNER_DOT_MATRIX, CUI_SPINNER_RADAR,
                                                        CUI_SPINNER_RIPPLE, CUI_SPINNER_ORBIT, CUI_SPINNER_BOUNCE, CUI_SPINNER_PULSE };
static const char *const dsg_status_names[] = { "", "online", "busy", "away", "offline" };
static const char *const dsg_tag_status_names[] = { "pending", "in_progress", "submitted", "in_review", "success", "failed", "expired", "custom" };
static const char *const dsg_loader_names[] = { "dots", "bars", "pulse", "orbit", "grid" };
static const char *const dsg_track_names[] = { "hue", "temperature", "opacity" };
#define DSG_ENUM(n, key, names) dsg_enum((n), (key), (names), (int)(sizeof(names) / sizeof(names[0])))

/* A theme color by its name in media/components.js; zero (the component's default) for none. */
static cui_color dsg_color(const dsg_node *n, const char *key) {
    static const cui_color colors[] = { { 0, 0, 0, 0 }, CUI_COLOR_BACKGROUND, CUI_COLOR_SURFACE, CUI_COLOR_SURFACE_MUTED, CUI_COLOR_FOREGROUND,
                                        CUI_COLOR_TEXT_SECONDARY, CUI_COLOR_TEXT_MUTED, CUI_COLOR_BORDER, CUI_COLOR_ACCENT, CUI_COLOR_ACCENT_SUBTLE,
                                        CUI_COLOR_SUCCESS, CUI_COLOR_WARNING, CUI_COLOR_DANGER, CUI_COLOR_INFO };
    return colors[DSG_ENUM(n, key, dsg_color_names)];
}

static void dsg_event(int i) {
    if (dsg_event_count < DSG_MAX_EVENTS) dsg_events[dsg_event_count++] = i;
}

/* A button's "opens" and "closes": the state field of a dialog or sheet. */
static void dsg_open_by_field(const dsg_node *n, const char *key, bool open) {
    const char *field = dsg_opt(n, key);
    if (!field) return;
    for (int k = 0; k < dsg_node_count; k++)
        if ((dsg_nodes[k].kind == DSG_DIALOG || dsg_nodes[k].kind == DSG_SHEET) && strcmp(dsg_str(&dsg_nodes[k], "bind"), field) == 0)
            dsg_nodes[k].on = open;
}
static void dsg_clicked(int i) {
    dsg_open_by_field(&dsg_nodes[i], "opens", true);
    dsg_open_by_field(&dsg_nodes[i], "closes", false);
    dsg_event(i);
}

/* Is the designer's selection n or inside it? */
static bool dsg_selection_inside(const dsg_node *n) {
    for (int k = dsg_selected; k >= 0 && k < dsg_node_count; k = dsg_nodes[k].parent)
        if (&dsg_nodes[k] == n) return true;
    return false;
}

/* The controls with a state need an id; the generated code uses the same one. */
static const char *dsg_id(const dsg_node *n) { return dsg_str(n, "bind"); }

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
    b.bg = dsg_color(n, "bg");
    b.border = dsg_num(n, "border", 0);
    b.radius = dsg_num(n, "radius", 0);
    if (n->kind == DSG_GRID) {
        b.dir = CUI_GRID;
        b.columns = (int)dsg_num(n, "columns", 0);
        b.min_column_width = dsg_num(n, "min_column_width", 0);
    }
    if (dsg_design_mode && n->first < 0) { b.min_width = 96; b.min_height = 40; }
    return b;
}

/* An empty container in design mode: room to drop into. */
static void dsg_drop_room(cui_ctx *ui, const dsg_node *n) {
    if (dsg_design_mode && n->first < 0) cui_gap(ui, 40);
}

/* A dialog or sheet: open while its state says so, and in design mode also while
 * the selection is in it, so it can be edited. */
static void dsg_build_modal(cui_ctx *ui, dsg_node *n) {
    bool forced = true, was = n->on;
    bool *open = dsg_design_mode && dsg_selection_inside(n) ? &forced : &n->on;
    if (n->kind == DSG_DIALOG) {
        cui_dialog_opts o = { 0 };
        o.description = dsg_opt(n, "description");
        o.width = dsg_num(n, "width", 0);
        o.no_close_button = dsg_flag(n, "no_close_button");
        o.persistent = dsg_flag(n, "persistent");
        o.draggable = dsg_flag(n, "draggable");
        n->shown = cui_dialog_begin(ui, dsg_str(n, "title"), open, &o);
    } else {
        static const char *const sides[] = { "right", "left", "bottom", "top" };
        cui_sheet_opts o = { 0 };
        o.side = (cui_side)DSG_ENUM(n, "side", sides);
        o.size = dsg_num(n, "size", 0);
        o.description = dsg_opt(n, "description");
        n->shown = cui_sheet_begin(ui, dsg_str(n, "title"), open, &o);
    }
    if (n->shown) {
        dsg_drop_room(ui, n);
        dsg_build_children(ui, n);
        if (n->kind == DSG_DIALOG) cui_dialog_end(ui); else cui_sheet_end(ui);
    }
    if (n->on != was) dsg_event((int)(n - dsg_nodes));
}

static void dsg_build_container(cui_ctx *ui, dsg_node *n) {
    if (n->kind == DSG_DIALOG || n->kind == DSG_SHEET) { dsg_build_modal(ui, n); return; }
    if (n->kind == DSG_DIALOG_FOOTER) {
        cui_dialog_footer_begin(ui);
        dsg_drop_room(ui, n);
        dsg_build_children(ui, n);
        cui_dialog_footer_end(ui);
        return;
    }
    if (n->kind == DSG_BUTTON_GROUP) {
        cui_button_group_begin(ui);
        dsg_drop_room(ui, n);
        dsg_build_children(ui, n);
        cui_button_group_end(ui);
        return;
    }
    if (n->kind == DSG_EXPANDABLE_CARD) {
        cui_expandable_card_opts o = { 0 };
        o.description = dsg_opt(n, "description");
        o.icon = dsg_icon_glyph(n, "icon");
        o.badge = dsg_opt(n, "badge");
        o.badge_tone = (cui_tone)DSG_ENUM(n, "badge_tone", dsg_tone_names);
        bool was = n->on;
        if (cui_expandable_card_begin(ui, dsg_str(n, "title"), &n->on, &o)) {
            dsg_drop_room(ui, n);
            dsg_build_children(ui, n);
            cui_expandable_card_end(ui);
        }
        if (n->on != was) dsg_event((int)(n - dsg_nodes));
        return;
    }
    if (n->kind == DSG_SCROLL) {
        cui_scroll_opts o = { 0 };
        o.width = dsg_size(n, "width");
        o.height = dsg_size(n, "height");
        o.pad = dsg_num(n, "pad", 0);
        o.gap = dsg_num(n, "gap", 0);
        o.fade_edges = dsg_flag(n, "fade_edges");
        cui_scroll_begin(ui, &o);
        dsg_drop_room(ui, n);
        dsg_build_children(ui, n);
        cui_scroll_end(ui);
        return;
    }
    if (n->kind == DSG_ACCORDION) {
        bool was = n->on;
        if (cui_accordion_begin(ui, dsg_str(n, "title"), &n->on)) {
            dsg_drop_room(ui, n);
            dsg_build_children(ui, n);
            cui_accordion_end(ui);
        }
        if (n->on != was) dsg_event((int)(n - dsg_nodes));
        return;
    }
    if (n->kind == DSG_SPLIT) {
        cui_split_opts o = { 0 };
        o.vertical = dsg_flag(n, "vertical");
        o.min_first = dsg_num(n, "min_first", 0);
        o.min_second = dsg_num(n, "min_second", 0);
        o.width = dsg_size(n, "width");
        o.height = dsg_size(n, "height");
        float was = n->value;
        cui_split_begin(ui, dsg_id(n), &n->value, &o);
        if (n->first >= 0) dsg_build_node(ui, n->first);
        else dsg_drop_room(ui, n);
        cui_split_next(ui);
        for (int c = n->first >= 0 ? dsg_nodes[n->first].next : -1; c >= 0; c = dsg_nodes[c].next) dsg_build_node(ui, c);
        cui_split_end(ui);
        if (n->value != was) dsg_event((int)(n - dsg_nodes));
        return;
    }
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
        dsg_drop_room(ui, n);
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

/* The kinds from "More components" (docs/components-more.md). */
static void dsg_build_more(cui_ctx *ui, int i) {
    dsg_node *n = &dsg_nodes[i];
    switch (n->kind) {
    case DSG_EXPANDABLE_TEXT: {
        cui_expandable_text_opts o = { 0 };
        o.lines = (int)dsg_num(n, "lines", 0);
        cui_expandable_text_ex(ui, dsg_id(n), dsg_str(n, "text"), &o);
        break;
    }
    case DSG_SHIMMER_TEXT: {
        cui_text_fx_opts o = { 0 };
        o.size = dsg_num(n, "size", 0);
        o.nowrap = dsg_flag(n, "nowrap");
        cui_shimmer_text_ex(ui, dsg_str(n, "text"), &o);
        break;
    }
    case DSG_GRADIENT_TEXT: {
        cui_gradient_text_opts o = { 0 };
        o.size = dsg_num(n, "size", 0);
        o.animate = dsg_flag(n, "animate");
        cui_gradient_text_ex(ui, dsg_str(n, "text"), &o);
        break;
    }
    case DSG_SPLIT_BUTTON: {   /* 0 for the main part, 1 + i for menu item i */
        cui_split_button_opts o = { 0 };
        o.variant = (cui_button_variant)DSG_ENUM(n, "variant", dsg_variant_names);
        o.size = (cui_control_size)DSG_ENUM(n, "size", dsg_control_size_names);
        o.icon = dsg_icon_glyph(n, "icon");
        o.item_icons = n->has_icons ? n->icons : NULL;
        o.disabled = dsg_flag(n, "disabled");
        int r = cui_split_button_ex(ui, dsg_str(n, "label"), n->items, n->item_count, &o);
        if (r >= 0) { n->index = r; dsg_clicked(i); }
        break;
    }
    case DSG_TOGGLE_GROUP: {
        cui_toggle_group_opts o = { 0 };
        o.icons = n->has_icons ? n->icons : NULL;
        o.exclusive = dsg_flag(n, "exclusive");
        o.icon_only = dsg_flag(n, "icon_only");
        o.size = (cui_control_size)DSG_ENUM(n, "size", dsg_control_size_names);
        if (cui_toggle_group_ex(ui, dsg_id(n), n->items, n->item_count, n->flags, &o)) dsg_event(i);
        break;
    }
    case DSG_CONFIRM_BUTTON: {
        cui_confirm_opts o = { 0 };
        o.confirm_label = dsg_opt(n, "confirm_label");
        o.icon = dsg_icon_glyph(n, "icon");
        o.variant = (cui_button_variant)DSG_ENUM(n, "variant", dsg_variant_names);
        o.size = (cui_control_size)DSG_ENUM(n, "size", dsg_control_size_names);
        o.timeout = dsg_num(n, "timeout", 0);
        if (cui_confirm_button_ex(ui, dsg_str(n, "label"), &o)) dsg_clicked(i);
        break;
    }
    case DSG_STATUS_BUTTON: {
        cui_status_button_opts o = { 0 };
        o.busy_label = dsg_opt(n, "busy_label");
        o.success_label = dsg_opt(n, "success_label");
        o.error_label = dsg_opt(n, "error_label");
        o.icon = dsg_icon_glyph(n, "icon");
        o.variant = (cui_button_variant)DSG_ENUM(n, "variant", dsg_variant_names);
        o.size = (cui_control_size)DSG_ENUM(n, "size", dsg_control_size_names);
        if (cui_status_button_ex(ui, dsg_str(n, "label"), (cui_status)n->index, &o)) dsg_clicked(i);
        break;
    }
    case DSG_INLINE_EDIT: {
        cui_inline_edit_opts o = { 0 };
        o.size = dsg_num(n, "size", 0);
        o.placeholder = dsg_opt(n, "placeholder");
        o.width = dsg_size(n, "width");
        if (cui_inline_edit_ex(ui, dsg_id(n), n->text, sizeof n->text, &o) & CUI_CHANGED) dsg_event(i);
        break;
    }
    case DSG_SCRUB: {
        cui_scrub_opts o = { 0 };
        o.step = dsg_num(n, "step", 0);
        o.format = dsg_opt(n, "format");
        o.suffix = dsg_opt(n, "suffix");
        o.icon = dsg_icon_glyph(n, "icon");
        o.width = dsg_size(n, "width");
        if (cui_scrub_ex(ui, dsg_str(n, "label"), &n->value, dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o)) dsg_event(i);
        break;
    }
    case DSG_MONEY: {
        cui_money_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.symbol = dsg_opt(n, "symbol");
        o.code = dsg_opt(n, "code");
        o.decimals = (int)dsg_num(n, "decimals", 0);
        o.width = dsg_size(n, "width");
        o.hint = dsg_opt(n, "hint");
        if (cui_money_input_ex(ui, dsg_id(n), &n->number, &o)) dsg_event(i);
        break;
    }
    case DSG_SHORTCUT_RECORDER: {
        cui_shortcut_recorder_opts o = { 0 };
        o.placeholder = dsg_opt(n, "placeholder");
        o.width = dsg_size(n, "width");
        if (cui_shortcut_recorder_ex(ui, dsg_id(n), &n->combo, &o)) dsg_event(i);
        break;
    }
    case DSG_MULTI_SELECT: {
        cui_multi_select_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.placeholder = dsg_opt(n, "placeholder");
        o.icons = n->has_icons ? n->icons : NULL;
        o.searchable = dsg_flag(n, "searchable");
        o.max_chips = (int)dsg_num(n, "max_chips", 0);
        o.width = dsg_size(n, "width");
        if (cui_multi_select_ex(ui, dsg_id(n), n->items, n->item_count, n->flags, &o)) dsg_event(i);
        break;
    }
    case DSG_DATE_RANGE: {
        cui_date_range_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.placeholder = dsg_opt(n, "placeholder");
        o.width = dsg_size(n, "width");
        o.no_presets = dsg_flag(n, "no_presets");
        if (cui_date_range_picker_ex(ui, dsg_id(n), &n->range, &o)) dsg_event(i);
        break;
    }
    case DSG_TIME_PICKER: {
        cui_time_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.twelve_hour = dsg_flag(n, "twelve_hour");
        o.minute_step = (int)dsg_num(n, "minute_step", 0);
        o.width = dsg_size(n, "width");
        if (cui_time_picker_ex(ui, dsg_id(n), &n->hour, &n->minute, &o)) dsg_event(i);
        break;
    }
    case DSG_WHEEL_PICKER: {
        cui_wheel_opts o = { 0 };
        o.rows = (int)dsg_num(n, "rows", 0);
        o.width = dsg_size(n, "width");
        o.loop = dsg_flag(n, "loop");
        if (cui_wheel_picker_ex(ui, dsg_id(n), n->items, n->item_count, &n->index, &o)) dsg_event(i);
        break;
    }
    case DSG_KNOB: {
        cui_knob_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.format = dsg_opt(n, "format");
        o.unit = dsg_opt(n, "unit");
        o.size = dsg_num(n, "size", 0);
        o.step = dsg_num(n, "step", 0);
        o.bipolar = dsg_flag(n, "bipolar");
        o.hide_value = dsg_flag(n, "hide_value");
        o.disabled = dsg_flag(n, "disabled");
        if (cui_knob_ex(ui, dsg_id(n), &n->value, dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o)) dsg_event(i);
        break;
    }
    case DSG_FADER: {
        cui_fader_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.format = dsg_opt(n, "format");
        o.unit = dsg_opt(n, "unit");
        o.length = dsg_num(n, "length", 0);
        o.horizontal = dsg_flag(n, "horizontal");
        o.step = dsg_num(n, "step", 0);
        o.hide_value = dsg_flag(n, "hide_value");
        o.disabled = dsg_flag(n, "disabled");
        if (cui_fader_ex(ui, dsg_id(n), &n->value, dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o)) dsg_event(i);
        break;
    }
    case DSG_RULER_SLIDER: {
        cui_ruler_opts o = { 0 };
        o.step = dsg_num(n, "step", 0);
        o.major_every = (int)dsg_num(n, "major_every", 0);
        o.format = dsg_opt(n, "format");
        o.unit = dsg_opt(n, "unit");
        o.width = dsg_size(n, "width");
        if (cui_ruler_slider_ex(ui, dsg_str(n, "label"), &n->value, dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o)) dsg_event(i);
        break;
    }
    case DSG_RATIO_SLIDER: {
        cui_ratio_slider_opts o = { 0 };
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        o.height = dsg_num(n, "height", 0);
        o.width = dsg_size(n, "width");
        o.disabled = dsg_flag(n, "disabled");
        if (cui_ratio_slider_ex(ui, dsg_str(n, "first"), dsg_str(n, "second"), &n->value, &o)) dsg_event(i);
        break;
    }
    case DSG_STEP_SLIDER: {   /* the stop names only with one for every stop: it shows labels[value - min] */
        cui_step_slider_opts o = { 0 };
        int lo = (int)dsg_num(n, "min", 0), hi = (int)dsg_num(n, "max", 0);
        if (hi >= lo && n->label_count >= hi - lo + 1) o.labels = n->labels;
        o.format = dsg_opt(n, "format");
        o.disabled = dsg_flag(n, "disabled");
        if (cui_step_slider_ex(ui, dsg_str(n, "label"), &n->index, lo, hi, &o) & CUI_WELL_CHANGED) dsg_event(i);
        break;
    }
    case DSG_GRADIENT_SLIDER: {
        cui_gradient_slider_opts o = { 0 };
        o.track = (cui_gradient_track)DSG_ENUM(n, "track", dsg_track_names);
        o.step = dsg_num(n, "step", 0);
        o.format = dsg_opt(n, "format");
        o.swatch = dsg_flag(n, "swatch");
        o.disabled = dsg_flag(n, "disabled");
        if (cui_gradient_slider_ex(ui, dsg_str(n, "label"), &n->value, dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o) & CUI_WELL_CHANGED) dsg_event(i);
        break;
    }
    case DSG_ASPECT_PICKER: {
        cui_aspect_picker_opts o = { 0 };
        o.custom = dsg_flag(n, "custom");
        o.base = (int)dsg_num(n, "base", 0);
        if (cui_aspect_picker_ex(ui, dsg_str(n, "label"), &n->index, &o)) dsg_event(i);
        break;
    }
    case DSG_SEED_FIELD: {
        cui_seed_field_opts o = { 0 };
        o.value = dsg_opt(n, "caption");
        if (cui_seed_field_ex(ui, dsg_str(n, "label"), &n->seed, &n->locked, &o) & CUI_WELL_CHANGED) dsg_event(i);
        break;
    }
    case DSG_BANNER: {   /* in design mode it shows even when its state says hidden, so it can be selected */
        cui_banner_opts o = { 0 };
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        o.icon = dsg_icon_glyph(n, "icon");
        o.action = dsg_opt(n, "action");
        o.dismissible = dsg_flag(n, "dismissible");
        bool forced = true;
        if (cui_banner_ex(ui, dsg_str(n, "text"), dsg_design_mode ? &forced : &n->on, &o)) dsg_clicked(i);
        break;
    }
    case DSG_COUNTDOWN: {
        cui_countdown_opts o = { 0 };
        o.hide_days = dsg_flag(n, "hide_days");
        o.compact = dsg_flag(n, "compact");
        const char *v = dsg_get(n, "seconds");
        cui_countdown_ex(ui, dsg_id(n), v && *v ? strtod(v, NULL) : 0, &o);
        break;
    }
    case DSG_STATUS_SPINNER: {
        cui_status_spinner_opts o = { 0 };
        o.size = dsg_num(n, "size", 0);
        o.keep = dsg_flag(n, "keep");
        cui_status_spinner_ex(ui, dsg_id(n), (cui_status)n->index, &o);
        break;
    }
    case DSG_LOADER: {
        cui_loader_opts o = { 0 };
        o.style = (cui_loader_style)DSG_ENUM(n, "style", dsg_loader_names);
        o.size = dsg_num(n, "size", 0);
        o.color = dsg_color(n, "color");
        cui_loader_ex(ui, &o);
        break;
    }
    case DSG_STATUS_TAG: {
        cui_status_tag_opts o = { 0 };
        o.size = (cui_control_size)DSG_ENUM(n, "size", dsg_control_size_names);
        o.removable = dsg_flag(n, "removable");
        o.icon = dsg_icon_glyph(n, "icon");
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        if (cui_status_tag_ex(ui, dsg_opt(n, "label"), (cui_tag_status)DSG_ENUM(n, "status", dsg_tag_status_names), &o)) dsg_clicked(i);
        break;
    }
    case DSG_COUNTER: {
        cui_counter_opts o = { 0 };
        o.format = dsg_opt(n, "format");
        o.size = dsg_num(n, "size", 0);
        o.group_thousands = dsg_flag(n, "group_thousands");
        cui_counter_ex(ui, dsg_id(n), n->number, &o);
        break;
    }
    case DSG_RADIAL_GAUGE: {
        cui_radial_gauge_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.unit = dsg_opt(n, "unit");
        o.format = dsg_opt(n, "format");
        o.detail = dsg_opt(n, "detail");
        o.size = dsg_num(n, "size", 0);
        o.sweep = dsg_num(n, "sweep", 0);
        cui_radial_gauge_ex(ui, dsg_id(n), dsg_num(n, "value", 0), dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o);
        break;
    }
    case DSG_READOUT: {
        cui_readout_opts o = { 0 };
        o.unit = dsg_opt(n, "unit");
        o.detail = dsg_opt(n, "detail");
        o.size = (cui_control_size)DSG_ENUM(n, "size", dsg_control_size_names);
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        o.accent = dsg_flag(n, "accent");
        o.width = dsg_size(n, "width");
        cui_readout_ex(ui, dsg_str(n, "label"), dsg_str(n, "value"), &o);
        break;
    }
    default: break;
    }
}

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
    case DSG_LINK: if (cui_link(ui, dsg_str(n, "text"))) dsg_clicked(i); break;
    case DSG_KBD: cui_kbd(ui, dsg_str(n, "text")); break;
    case DSG_ICON: {
        const char *g = dsg_icon_glyph(n, "icon");
        cui_icon(ui, g ? g : CUI_ICON_STAR, dsg_num(n, "size", 0), dsg_color(n, "color"));
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
        if (clicked) dsg_clicked(i);
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
        o.searchable = dsg_flag(n, "searchable");
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
    case DSG_SEARCH: {
        cui_input_opts o = { 0 };
        o.placeholder = dsg_opt(n, "placeholder");
        o.disabled = dsg_flag(n, "disabled");
        o.width = dsg_size(n, "width");
        if (cui_search_ex(ui, dsg_id(n), n->text, sizeof n->text, &o) & CUI_SUBMITTED) dsg_event(i);
        break;
    }
    case DSG_NUMBER: {
        cui_number_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.step = dsg_num(n, "step", 0);
        o.decimals = (int)dsg_num(n, "decimals", 0);
        o.suffix = dsg_opt(n, "suffix");
        o.disabled = dsg_flag(n, "disabled");
        o.width = dsg_size(n, "width");
        if (cui_number_ex(ui, dsg_id(n), &n->number, dsg_num(n, "min", 0), dsg_num(n, "max", 100), &o)) dsg_event(i);
        break;
    }
    case DSG_CHIP: {
        cui_chip_opts o = { 0 };
        o.icon = dsg_icon_glyph(n, "icon");
        o.disabled = dsg_flag(n, "disabled");
        if (cui_chip_ex(ui, dsg_str(n, "label"), &n->on, &o)) dsg_event(i);
        break;
    }
    case DSG_RATING: if (cui_rating(ui, dsg_id(n), &n->index, (int)dsg_num(n, "max", 5))) dsg_event(i); break;
    case DSG_RANGE_SLIDER:
        if (cui_range_slider(ui, dsg_str(n, "label"), &n->value, &n->high, dsg_num(n, "min", 0), dsg_num(n, "max", 100))) dsg_event(i);
        break;
    case DSG_DATE_PICKER: {
        cui_date_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.placeholder = dsg_opt(n, "placeholder");
        o.width = dsg_size(n, "width");
        if (cui_date_picker_ex(ui, dsg_id(n), &n->date, &o)) dsg_event(i);
        break;
    }
    case DSG_NAV_SECTION: cui_nav_section(ui, dsg_str(n, "title")); break;
    case DSG_NAV_ITEM: {
        cui_nav_opts o = { 0 };
        o.icon = dsg_icon_glyph(n, "icon");
        o.badge = dsg_opt(n, "badge");
        o.selected = dsg_flag(n, "selected");
        o.group = dsg_opt(n, "group");
        if (cui_nav_item_ex(ui, dsg_str(n, "label"), &o)) dsg_event(i);
        break;
    }
    case DSG_BREADCRUMB: if (cui_breadcrumb(ui, n->items, n->item_count) >= 0) dsg_event(i); break;
    case DSG_PAGINATION: if (cui_pagination(ui, dsg_id(n), &n->index, (int)dsg_num(n, "count", 1))) dsg_event(i); break;
    case DSG_STEPPER: cui_stepper(ui, n->items, n->item_count, (int)dsg_num(n, "current", 0)); break;
    case DSG_SPINNER: {
        cui_spinner_opts o = { 0 };
        o.style = dsg_spinner_styles[DSG_ENUM(n, "style", dsg_spinner_names)];
        o.color = dsg_color(n, "color");
        cui_spinner_ex(ui, dsg_num(n, "size", 0), &o);
        break;
    }
    case DSG_SKELETON: cui_skeleton(ui, dsg_size(n, "width"), dsg_num(n, "height", 0)); break;
    case DSG_EMPTY_STATE: {
        cui_empty_opts o = { 0 };
        o.icon = dsg_icon_glyph(n, "icon");
        o.description = dsg_opt(n, "description");
        o.action = dsg_opt(n, "action");
        if (cui_empty_state_ex(ui, dsg_str(n, "title"), &o)) dsg_event(i);
        break;
    }
    case DSG_AVATAR: {
        cui_avatar_opts o = { 0 };
        o.size = dsg_num(n, "size", 0);
        int st = DSG_ENUM(n, "status", dsg_status_names);
        o.status = st ? dsg_status_names[st] : NULL;
        o.square = dsg_flag(n, "square");
        cui_avatar_ex(ui, dsg_str(n, "name"), &o);
        break;
    }
    case DSG_LIST_ITEM: {
        cui_list_item_opts o = { 0 };
        o.icon = dsg_icon_glyph(n, "icon");
        o.subtitle = dsg_opt(n, "subtitle");
        o.trailing = dsg_opt(n, "trailing");
        o.avatar = dsg_opt(n, "avatar");
        o.selected = dsg_flag(n, "selected");
        if (cui_list_item_ex(ui, dsg_str(n, "title"), &o)) dsg_event(i);
        break;
    }
    case DSG_TABLE: {
        if (!n->column_count) break;
        cui_table_opts o = { 0 };
        o.height = dsg_size(n, "height");
        o.striped = dsg_flag(n, "striped");
        o.compact = dsg_flag(n, "compact");
        o.selectable = dsg_flag(n, "selectable");
        if (cui_table_begin_ex(ui, dsg_id(n), n->table_columns, n->column_count, &o)) {
            for (int r = 0; r < n->row_count; r++) {
                if (cui_table_row(ui, n->index == r)) { n->index = r; dsg_event(i); }
                for (int c = 0; c < n->column_count; c++) cui_table_cell_text(ui, n->cells[r * n->column_count + c]);
            }
            cui_table_end(ui);
        }
        break;
    }
    case DSG_DATA_GRID: {
        if (!n->column_count) break;
        cui_grid_opts o = { 0 };
        o.width = dsg_size(n, "width");
        o.height = dsg_size(n, "height");
        o.row_height = dsg_num(n, "row_height", 0);
        o.striped = dsg_flag(n, "striped");
        int first = 0, last = 0;
        if (cui_data_grid_begin_ex(ui, dsg_id(n), n->grid_columns, n->column_count, n->row_count, &first, &last, &o)) {
            for (int r = first; r < last; r++) {
                if (cui_data_grid_row(ui, r)) { n->index = r; dsg_event(i); }
                for (int c = 0; c < n->column_count; c++) cui_data_grid_cell_text(ui, n->cells[r * n->column_count + c]);
            }
            cui_data_grid_end(ui);
        }
        break;
    }
    case DSG_METER: cui_meter(ui, dsg_str(n, "label"), dsg_num(n, "used", 0), dsg_num(n, "total", 0), dsg_str(n, "unit")); break;
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
    case DSG_COLOR_PICKER: if (cui_color_picker(ui, dsg_id(n), &n->color)) dsg_event(i); break;
    case DSG_TAG_INPUT: {
        cui_tag_opts o = { 0 };
        o.label = dsg_opt(n, "label");
        o.placeholder = dsg_opt(n, "placeholder");
        o.max_tags = (int)dsg_num(n, "max_tags", 0);
        o.width = dsg_size(n, "width");
        if (cui_tag_input_ex(ui, dsg_id(n), n->text, sizeof n->text, &o)) dsg_event(i);
        break;
    }
    case DSG_OTP: if (cui_otp_input(ui, dsg_id(n), n->text, dsg_otp_length(n))) dsg_event(i); break;
    case DSG_RADIO_CARDS: {
        cui_radio_cards_opts o = { 0 };
        o.columns = (int)dsg_num(n, "columns", 0);
        if (cui_radio_cards_ex(ui, dsg_id(n), n->choice_count ? n->choices : NULL, n->choice_count, &n->index, &o)) dsg_event(i);
        break;
    }
    case DSG_COPY_BUTTON: if (cui_copy_button(ui, dsg_id(n), dsg_str(n, "text"))) dsg_event(i); break;
    case DSG_HOLD_BUTTON: {
        cui_hold_opts o = { 0 };
        o.duration = dsg_num(n, "duration", 0);
        o.icon = dsg_icon_glyph(n, "icon");
        o.variant = (cui_button_variant)DSG_ENUM(n, "variant", dsg_variant_names);
        if (cui_hold_button_ex(ui, dsg_str(n, "label"), &o)) dsg_clicked(i);
        break;
    }
    case DSG_PASSWORD_STRENGTH: {   /* rates the live text of the field named by "of" */
        const char *of = dsg_opt(n, "of"), *pw = "";
        for (int k = 0; of && k < dsg_node_count; k++)
            if (dsg_holds_text(dsg_nodes[k].kind) && strcmp(dsg_str(&dsg_nodes[k], "bind"), of) == 0) { pw = dsg_nodes[k].text; break; }
        cui_password_strength(ui, pw);
        break;
    }
    case DSG_PROGRESS_RING: cui_progress_ring(ui, dsg_str(n, "label"), dsg_num(n, "value", 0), dsg_num(n, "size", 0)); break;
    case DSG_METRIC: {
        cui_metric_opts o = { 0 };
        o.delta = dsg_num(n, "delta", 0);
        o.delta_label = dsg_opt(n, "delta_label");
        o.lower_is_better = dsg_flag(n, "lower_is_better");
        if (n->spark_count) { o.spark = n->spark; o.spark_count = n->spark_count; }
        o.icon = dsg_icon_glyph(n, "icon");
        o.width = dsg_size(n, "width");
        cui_metric_ex(ui, dsg_str(n, "label"), dsg_str(n, "value"), &o);
        break;
    }
    case DSG_TIMELINE_ITEM: {
        cui_timeline_opts o = { 0 };
        o.time = dsg_opt(n, "time");
        o.description = dsg_opt(n, "description");
        o.icon = dsg_icon_glyph(n, "icon");
        o.tone = (cui_tone)DSG_ENUM(n, "tone", dsg_tone_names);
        o.last = dsg_flag(n, "last");
        cui_timeline_item_ex(ui, dsg_str(n, "title"), &o);
        break;
    }
    default: dsg_build_more(ui, i); break;
    }
}

static void dsg_build_node(cui_ctx *ui, int i) {
    dsg_node *n = &dsg_nodes[i];
    int first = ui->node_count;
    if (dsg_is_container(n->kind)) dsg_build_container(ui, n);
    else dsg_build_control(ui, i);
    n->ui_node = ui->node_count > first ? first : -1;
    /* a dialog's first node is the scrim over the whole window; select its panel instead */
    if ((n->kind == DSG_DIALOG || n->kind == DSG_SHEET) && n->shown && ui->nodes[first].first >= 0) n->ui_node = ui->nodes[first].first;
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
    for (int k = 0; k < dsg_node_count; k++) { dsg_nodes[k].ui_node = -1; dsg_nodes[k].shown = false; }
    if (dsg_node_count > 0) dsg_build_node(ui, 0);
}

/* ---------------------------------------------------------------- queries */

DSG_EXPORT(dsg_set_design_mode) void dsg_set_design_mode(int on) { dsg_design_mode = on != 0; }
DSG_EXPORT(dsg_set_selected) void dsg_set_selected(int i) { dsg_selected = i; }
/* Was dialog or sheet i open in the latest frame? */
DSG_EXPORT(dsg_shown) int dsg_shown(int i) { return i >= 0 && i < dsg_node_count && dsg_nodes[i].shown; }

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
