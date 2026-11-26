#!/usr/bin/env bash
# Builds the designer's preview module: CUI compiled to WebAssembly with plain
# clang + wasm-ld, like the documentation site (web/tools/build.sh), plus the
# designer's interpreter (native/designer.c). Needs clang with the wasm32
# target, wasm-ld and python3 or sed. Output: media/designer.wasm and
# media/runtime.js (a copy of web/site/js/runtime.js).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WEB="$ROOT/web"
OUT="$HERE/build"
mkdir -p "$OUT/obj"

CC=${CC:-clang}
JOBS=${JOBS:-$(nproc 2>/dev/null || echo 4)}
CFLAGS=(--target=wasm32 -O2 -std=c99 -g0
        -mbulk-memory -mnontrapping-fptoint -msign-ext -msimd128
        -fno-stack-protector -fno-exceptions -ffunction-sections -fdata-sections
        -isystem "$WEB/shim/include" -I "$ROOT/include" -I "$ROOT/src" -I "$OUT"
        -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable -Wno-c11-extensions)
LDFLAGS=(--no-entry --gc-sections --strip-all -z stack-size=4194304 --initial-memory=16777216 --max-memory=4294967296)

compile() {   # src obj [extra flags...]
    local src=$1 obj=$2; shift 2
    if [[ ! -f "$obj" || "$src" -nt "$obj" || "$ROOT/include/cui/cui.h" -nt "$obj" || "$ROOT/src/cui_internal.h" -nt "$obj" ]]; then
        "$CC" "${CFLAGS[@]}" "$@" -c "$src" -o "$obj"
    fi
}

# the icon table: { "arrow_right", CUI_ICON_ARROW_RIGHT }, ...
sed -n 's/^#define CUI_ICON_\([A-Z0-9_]*\) .*/{ "\L\1\E", CUI_ICON_\1 },/p' "$ROOT/include/cui/cui_icons.h" > "$OUT/dsg_icons.inc"

pids=()
for s in "$ROOT"/src/cui_*.c "$ROOT/src/render/cui_render_sw.c"; do
    compile "$s" "$OUT/obj/lib_$(basename "${s%.c}").o" &
    pids+=($!)
    if (( ${#pids[@]} >= JOBS )); then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
done
compile "$WEB/shim/libc.c" "$OUT/obj/libc.o" -fno-builtin &
compile "$WEB/host/web_host.c" "$OUT/obj/web_host.o" &
wait
"$CC" "${CFLAGS[@]}" -Wall -Wextra -c "$HERE/native/designer.c" -o "$OUT/obj/designer.o"

wasm-ld "${LDFLAGS[@]}" "$OUT/obj/designer.o" "$OUT/obj/web_host.o" "$OUT"/obj/lib_*.o "$OUT/obj/libc.o" \
        -o "$HERE/media/designer.wasm"
cp "$WEB/site/js/runtime.js" "$HERE/media/runtime.js"
printf 'media/designer.wasm %d KB\n' $(( $(wc -c < "$HERE/media/designer.wasm") / 1024 ))
