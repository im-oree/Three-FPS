#!/usr/bin/env bash
# bootstrap.sh — idempotent setup of the headless-verification environment.
#
# Safe to re-run at any time; each step skips itself when its cache is warm.
# Cold cost ≈ 40 s (npm tarballs + one 80 MB PyPI wheel + brotli inflate);
# warm cost ≈ 1 s.
#
# Network reality of this sandbox: only registry.npmjs.org, PyPI and
# github.com (HTML/git only) are reachable — see README.md for the full story.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFY_HOME="${VERIFY_HOME:-/home/user/.verify}"
CHROME_SRC=/tmp/chromium
CHROME_BIN="${OPERATOR_CHROME_BIN:-/tmp/chromium-patched}"
LIBS="$VERIFY_HOME/runtime-libs"
SHIM="$VERIFY_HOME/patch/nss_compat_shim.so"
KALEIDO=0.2.1

log() { printf '\033[1;36m[verify-bootstrap]\033[0m %s\n' "$*"; }

mkdir -p "$VERIFY_HOME" "$VERIFY_HOME/patch" "$SCRIPT_DIR/out"

# --- 1. node deps: puppeteer-core + @sparticuz/chromium (browser in npm tarball)
if [ -f "$VERIFY_HOME/node_modules/puppeteer-core/package.json" ] && \
   [ -f "$VERIFY_HOME/node_modules/@sparticuz/chromium/package.json" ]; then
  log "node deps: cached"
else
  log "node deps: installing puppeteer-core + @sparticuz/chromium"
  [ -f "$VERIFY_HOME/package.json" ] || echo '{ "name": "operator-verify-cache", "private": true, "type": "module" }' > "$VERIFY_HOME/package.json"
  ( cd "$VERIFY_HOME" && npm install --no-audit --no-fund --silent puppeteer-core@latest @sparticuz/chromium@latest )
fi

# --- 2. NSS/NSPR + SwiftShader shared libs (from the PyPI `kaleido` wheel)
if [ -f "$LIBS/libnss3.so" ] && [ -f "$LIBS/libnspr4.so" ]; then
  log "runtime libs: cached"
else
  log "runtime libs: fetching kaleido==$KALEIDO wheel from PyPI"
  WORK="$(mktemp -d)"
  python3 -m pip download --no-deps --quiet --dest "$WORK" "kaleido==$KALEIDO"
  python3 - "$WORK" "$LIBS" <<'PY'
import sys, zipfile, glob, os, shutil
work, libs = sys.argv[1], sys.argv[2]
os.makedirs(libs, exist_ok=True)
wheel = glob.glob(os.path.join(work, 'kaleido-*.whl'))[0]
z = zipfile.ZipFile(wheel)
names = [n for n in z.namelist()
         if n.endswith(('.so', '.so.0')) and ('/lib/' in n or '/swiftshader/' in n)]
for n in names:
    base = os.path.basename(n)
    with z.open(n) as src, open(os.path.join(libs, base), 'wb') as dst:
        shutil.copyfileobj(src, dst)
    os.chmod(os.path.join(libs, base), 0o755)
print(f"[verify-bootstrap] extracted {len(names)} shared libs -> {libs}")
PY
  rm -rf "$WORK"
fi

# --- 3. inflate the Chromium binary, then relax its NSS_3.30 verneed entry
if [ -x "$CHROME_BIN" ]; then
  log "chromium: patched binary cached at $CHROME_BIN"
else
  if [ ! -x "$CHROME_SRC" ]; then
    log "chromium: inflating from @sparticuz/chromium"
    cat > "$VERIFY_HOME/extract-chromium.mjs" <<'MJ'
import chromium from '@sparticuz/chromium';
chromium.setGraphicsMode = true;
console.log(await chromium.executablePath());
MJ
    ( cd "$VERIFY_HOME" && node extract-chromium.mjs )
  fi
  log "chromium: patching NSS_3.30 -> NSS_3.22 verneed entry"
  python3 "$SCRIPT_DIR/patch/patch_nss_version.py" "$CHROME_SRC" "$CHROME_BIN"
fi

# --- 4. build the PK11_HasAttributeSet shim
if [ -f "$SHIM" ]; then
  log "nss shim: cached"
else
  log "nss shim: compiling"
  gcc -shared -fPIC -O2 -o "$SHIM" \
      "$SCRIPT_DIR/patch/nss_compat_shim.c" \
      -Wl,--version-script="$SCRIPT_DIR/patch/nss_compat_shim.map"
fi

# --- 5. sanity: every dynamic dependency of the patched binary resolves
MISSING="$(LD_LIBRARY_PATH="$LIBS" ldd "$CHROME_BIN" 2>/dev/null | grep -c 'not found' || true)"
if [ "$MISSING" != "0" ]; then
  log "ERROR: $MISSING unresolved shared libraries for $CHROME_BIN"
  LD_LIBRARY_PATH="$LIBS" ldd "$CHROME_BIN" | grep 'not found' || true
  exit 1
fi
log "deps check: all shared libraries resolve"
log "ready. Try: node $SCRIPT_DIR/probe-webgl.mjs"
