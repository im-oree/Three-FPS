# Headless Chromium + WebGL in a Network-Restricted Arena Sandbox

**Portable setup guide — copy this file into any Arena project.**
Proven in `im-oree/Three-FPS` (branch `arena/01a09389-three-fps`, `tools/verify/`).
Goal: real headless Chrome with **real WebGL 2 rendering and screenshots** inside
an Arena sandbox that has **no GPU** and **blocks every browser-download CDN**.

---

## 1. The problem

Arena sandboxes typically allow only a short network allowlist. Measured in this
environment (re-check with `curl -s -o /dev/null -w "%{http_code}" <url>`):

| Reachable | Blocked |
|---|---|
| `registry.npmjs.org` (npm) | `storage.googleapis.com` (puppeteer's Chrome) |
| `pypi.org` + `files.pythonhosted.org` (pip) | `cdn.playwright.dev`, `playwright.azureedge.net` |
| `github.com` HTML + git protocol | GitHub **release assets** (`objects.githubusercontent.com`), `raw.githubusercontent.com`, `codeload.github.com` |
| | Debian/Ubuntu mirrors (`apt-get install chromium` ✗), `conda.anaconda.org` |

So the normal routes all die: `puppeteer` install, `playwright` install,
`apt-get chromium`, Electron/nw.js zips, conda-forge chromium.
Two more sandbox facts: **no X server, no GPU** (software rendering only), and
the base image lacks the NSS/NSPR shared libraries Chrome links against.

## 2. The working recipe (three ingredients)

1. **Browser binary from npm**: `@sparticuz/chromium` ships a full Chromium
   build *inside its npm tarball* (brotli-compressed, ~67 MB). No CDN needed.
2. **Missing shared libraries from PyPI**: the wheel `kaleido==0.2.1` (Plotly's
   image exporter, ~80 MB) bundles a complete `libnss3/libnspr4/libnssutil3/…`
   set **plus SwiftShader** (`libEGL.so`, `libGLESv2.so`). Extract them once.
3. **One-symbol ABI bridge**: Chrome ≥ ~M130 requires symbol version `NSS_3.30`
   for exactly one symbol, `PK11_HasAttributeSet`; kaleido's older NSS defines
   versions only up to `NSS_3.22`. Fix = (a) relax that single ELF
   `Elf64_Vernaux` entry (`NSS_3.30` → `NSS_3.22`, same byte length, recompute
   the ELF hash), and (b) `LD_PRELOAD` a 20-line shim that implements
   `PK11_HasAttributeSet` on top of the real NSS's `PK11_ReadRawAttribute`.

Result verified: `HeadlessChrome/153.x`, `WebGL 2.0 (OpenGL ES 3.0 Chromium)`,
`ANGLE (Vulkan 1.3.0, SwiftShader Device (Subzero))`, correct pixel readback.

## 3. Drop-in bootstrap (copy this script verbatim into your project)

Save as `tools/verify-bootstrap.sh`, `chmod +x`, run once per sandbox.
Idempotent; **cold ≈ 8 s, warm ≈ 0 s**. Only needs bash, python3, gcc, node, npm, pip.

```bash
#!/usr/bin/env bash
set -euo pipefail
VERIFY_HOME="${VERIFY_HOME:-$HOME/.verify}"          # cache (libs, shim, node deps)
LIBS="$VERIFY_HOME/runtime-libs"; SHIM="$VERIFY_HOME/patch/nss_compat_shim.so"
CHROME_SRC=/tmp/chromium; CHROME_BIN=/tmp/chromium-patched
mkdir -p "$VERIFY_HOME/patch"

# 1) puppeteer-core + browser-in-tarball chromium
if [ ! -f "$VERIFY_HOME/node_modules/@sparticuz/chromium/package.json" ]; then
  [ -f "$VERIFY_HOME/package.json" ] || echo '{"name":"verify-cache","private":true,"type":"module"}' > "$VERIFY_HOME/package.json"
  ( cd "$VERIFY_HOME" && npm install --silent --no-audit --no-fund puppeteer-core@latest @sparticuz/chromium@latest )
fi

# 2) NSS/NSPR + SwiftShader libs from the kaleido wheel
if [ ! -f "$LIBS/libnss3.so" ]; then
  W=$(mktemp -d); python3 -m pip download --no-deps --quiet --dest "$W" kaleido==0.2.1
  python3 - "$W" "$LIBS" <<'PY'
import sys, zipfile, glob, os, shutil
work, libs = sys.argv[1], sys.argv[2]; os.makedirs(libs, exist_ok=True)
z = zipfile.ZipFile(glob.glob(os.path.join(work, 'kaleido-*.whl'))[0])
for n in [n for n in z.namelist() if n.endswith(('.so', '.so.0')) and ('/lib/' in n or '/swiftshader/' in n)]:
    with z.open(n) as s, open(os.path.join(libs, os.path.basename(n)), 'wb') as d: shutil.copyfileobj(s, d)
    os.chmod(os.path.join(libs, os.path.basename(n)), 0o755)
PY
  rm -rf "$W"
fi

# 3) inflate chromium, then relax its single NSS_3.30 verneed entry
if [ ! -x "$CHROME_BIN" ]; then
  if [ ! -x "$CHROME_SRC" ]; then
    cat > "$VERIFY_HOME/extract.mjs" <<'MJ'
import chromium from '@sparticuz/chromium';
chromium.setGraphicsMode = true;
console.log(await chromium.executablePath());
MJ
    ( cd "$VERIFY_HOME" && node extract.mjs )
  fi
  python3 - "$CHROME_SRC" "$CHROME_BIN" <<'PY'
import sys, shutil, os, stat, struct
SRC, DST = sys.argv[1], sys.argv[2]
FROM, TO = b"NSS_3.30", b"NSS_3.22"
def elf_hash(name):
    h = 0
    for c in name:
        h = ((h << 4) + c) & 0xFFFFFFFF; g = h & 0xF0000000
        if g: h ^= g >> 24
        h &= ~g & 0xFFFFFFFF
    return h
def sections(f):
    f.seek(0x28); (shoff,) = struct.unpack("<Q", f.read(8))
    f.seek(0x3A); es, num, strndx = struct.unpack("<HHH", f.read(6))
    f.seek(shoff + strndx*es + 0x18); so, ss = struct.unpack("<QQ", f.read(16))
    f.seek(so); shstr = f.read(ss); out = {}
    for i in range(num):
        f.seek(shoff + i*es)
        nm, ty, _fl, _ad, off, size, _lk, _inf, _al, _en = struct.unpack("<IIQQQQIIQQ", f.read(64))
        out[shstr[nm:shstr.index(b"\0", nm)].decode()] = (off, size)
    return out
shutil.copyfile(SRC, DST); os.chmod(DST, os.stat(SRC).st_mode | stat.S_IXUSR)
with open(DST, "r+b") as f:
    sec = sections(f); do, dsz = sec[".dynstr"]; vo, vsz = sec[".gnu.version_r"]
    f.seek(do); ds = f.read(dsz); f.seek(vo); vn = f.read(vsz)
    needle = struct.pack("<I", elf_hash(FROM)); patched = 0
    for off in range(0, len(vn) - 15, 4):
        if vn[off:off+4] != needle: continue
        _h, _fl, _o, name, _n = struct.unpack_from("<IHHII", vn, off)
        if ds[name:ds.index(b"\0", name)] != FROM: continue
        f.seek(do + name); f.write(TO + b"\0")
        f.seek(vo + off);  f.write(struct.pack("<I", elf_hash(TO))); patched += 1
    f.flush()
print(f"[patch-nss] patched={patched}")
sys.exit(0 if patched else 1)
PY
fi

# 4) the PK11_HasAttributeSet shim
if [ ! -f "$SHIM" ]; then
  cat > "$VERIFY_HOME/patch/shim.c" <<'CE'
typedef unsigned long CK_RV, CK_ATTRIBUTE_TYPE;
typedef struct SECItemStr { int type; unsigned char *data; unsigned int len; } SECItem;
extern CK_RV PK11_ReadRawAttribute(int, void*, CK_ATTRIBUTE_TYPE, SECItem*);
extern void SECITEM_FreeItem(SECItem*, int);
CK_RV PK11_HasAttributeSet(void *slot, void *cert, CK_ATTRIBUTE_TYPE *set, int count) {
    (void)slot;
    for (int i = 0; i < count; i++) {
        SECItem item = {0,0,0};
        CK_RV rv = PK11_ReadRawAttribute(3, cert, set[i], &item);
        if (rv != 0) return rv;
        SECITEM_FreeItem(&item, 0);
    }
    return 1UL; /* CKR_TRUE */
}
CE
  cat > "$VERIFY_HOME/patch/shim.map" <<'ME'
NSS_3.22 { global: PK11_HasAttributeSet; local: *; };
ME
  gcc -shared -fPIC -O2 -o "$SHIM" "$VERIFY_HOME/patch/shim.c" -Wl,--version-script="$VERIFY_HOME/patch/shim.map"
fi

# 5) sanity
[ "$(LD_LIBRARY_PATH="$LIBS" ldd "$CHROME_BIN" 2>/dev/null | grep -c 'not found')" = "0" ] || { echo "unresolved libs"; exit 1; }
echo "[verify-bootstrap] ready"
```

## 4. Launching it (puppeteer-core)

```js
import { createRequire } from 'node:module';
const require = createRequire(`${process.env.VERIFY_HOME || `${process.env.HOME}/.verify`}/noop.js`);
const puppeteer = require('puppeteer-core');

const LIBS = `${process.env.HOME}/.verify/runtime-libs`;
const browser = await puppeteer.launch({
  executablePath: '/tmp/chromium-patched',
  headless: true,
  env: {
    ...process.env,
    LD_LIBRARY_PATH: LIBS,                          // NSS + SwiftShader libs
    LD_PRELOAD: `${process.env.HOME}/.verify/patch/nss_compat_shim.so`,
  },
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
         '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
```

Sanity probe (proves shaders really execute):

```js
const page = await browser.newPage();
await page.setContent(`<canvas id=c width=64 height=64></canvas><script>
  const gl = document.getElementById('c').getContext('webgl2');
  gl.clearColor(0.2,0.9,0.4,1); gl.clear(gl.COLOR_BUFFER_BIT);
  const px = new Uint8Array(4); gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
  window.px = [...px];</script>`);
console.log(await page.evaluate(() => window.px));   // [51,230,102,255]
await page.screenshot({ path: 'shot.png' });          // real screenshots work
```

## 5. Reuse across Arena sessions

- **Commit the bootstrap script** to your repo; commit **nothing binary**.
  The ~9 MB of libs and the ~200 MB browser re-derive in ~8 s from npm+PyPI,
  and repo binary budget is usually needed for real deliverables.
- Cache dirs: `$VERIFY_HOME` (default `~/.verify`) survives while the workspace
  does; `/tmp` is wiped between sandbox boots. The script rebuilds whatever is
  missing, so a fresh session costs one 8-second run.
- Fastest possible reuse: `git clone`/copy `tools/verify/` from
  `im-oree/Three-FPS` (it contains this guide, a ready `bootstrap.sh`, a
  launch helper, a WebGL probe, and a generic dev-server smoke tester).

## 6. Gotchas & troubleshooting

| Symptom | Cause / fix |
|---|---|
| `error while loading shared libraries: libnspr4.so` | `LD_LIBRARY_PATH` not set at launch (step 4 env). |
| `version 'NSS_3.30' not found (required by /tmp/chromium)` | Patch step didn't run, or Chrome version changed. The patcher is hash-based and parameterized (`FROM`/`TO`): for a future Chrome needing e.g. `NSS_3.34`, patch to any version the NSS lib defines ≤ its max (inspect with `objdump -T libnss3.so | grep -o 'NSS_[0-9.]*' | sort -uV`), and add the missing symbols to the shim the same way. |
| `spawn /tmp/chromium-patched EACCES` | Lost exec bit — the patcher `chmod +x`s; if you copy manually, `chmod 700`. |
| WebGL context null | Missing `--enable-unsafe-swiftshader` / graphics mode: `chromium.setGraphicsMode = true` **before** `executablePath()`, else SwiftShader isn't extracted. |
| Slow frames | Expected: SwiftShader is CPU rendering. Keep viewports ≤ 1280×720 in tests; FPS numbers here say nothing about real hardware. |
| `pip install` blocked by PEP 668 | Use `pip download` (as above) — no install needed; or `--target`/venv. |
| Different Chrome major from npm | `@sparticuz/chromium` versions track Chrome majors; pin the one whose NSS requirement your shim+patch cover (153 verified). |

## 7. Rules of the road

- The patched binary is a **local test artifact only** — never ship/commit it.
- The shim implements one cert-attribute helper as upstream NSS does; it is
  loaded only into your test browser process via `LD_PRELOAD`.
- Pointer lock, audio output, and GPU-dependent features behave differently
  headless; assert logic via CDP/DOM, and treat screenshots as the visual gate.
