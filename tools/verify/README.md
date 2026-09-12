# Headless Verification Harness

Automated browser verification for this project: real Chromium, real WebGL 2,
real screenshots — inside a sandbox that has **no GPU and no package CDN access
except npm/PyPI/github.com**.

Everything here is plain JS/Python/shell on purpose: it runs *outside* the app's
`tsconfig` and must work before (and without) the project's own `node_modules`.

## Why this exists in such a weird shape

The sandbox's network allowlist permits only `registry.npmjs.org`,
`pypi.org`/`files.pythonhosted.org` and `github.com` (HTML + git only — release
assets, raw and codeload redirect to blocked hosts). That rules out the normal
routes:

| Normal route | Why it fails here |
|---|---|
| `@puppeteer/browsers` / `puppeteer` install | downloads from `storage.googleapis.com` (blocked) |
| `playwright` / `patchright` | downloads from `cdn.playwright.dev` (blocked) |
| `apt-get install chromium libnss3 libnspr4` | Debian mirrors blocked |
| Electron / nw.js / Chrome-for-Testing zips | GitHub *release assets* blocked |
| conda-forge `chromium`/`nss` | anaconda.org blocked |

Working route that was found:

1. **Browser binary**: `@sparticuz/chromium` ships a full Chromium 153 build
   *inside its npm tarball* (brotli-compressed) → reachable via npm.
2. **Missing shared libraries**: the image lacks `libnss3`/`libnspr4`
   (`libnssutil3` too). The PyPI wheel `kaleido==0.2.1` (79 MB, Plotly's image
   exporter) bundles a complete NSS/NSPR library set **plus SwiftShader** →
   reachable via pip. Extracted into `runtime-libs/`.
3. **One remaining ABI gap**: Chrome 153 requires symbol version `NSS_3.30` for
   exactly one symbol, `PK11_HasAttributeSet` (added in NSS 3.30); kaleido's NSS
   defines versions only up to `NSS_3.22`. `patch/patch_nss_version.py` relaxes
   that single `Elf64_Vernaux` entry (`NSS_3.30` → `NSS_3.22`, same byte length,
   ELF hash recomputed) and `patch/nss_compat_shim.c` supplies the missing
   symbol via `LD_PRELOAD`, implemented exactly as upstream NSS does on top of
   `PK11_ReadRawAttribute`. Everything else Chrome needs — including
   `NSS_SetAlgorithmPolicy@NSSUTIL_3.12.3` — the kaleido build provides.
4. Rendering uses ANGLE over SwiftShader (software Vulkan), i.e. real shader
   execution, real framebuffers, real screenshots — just no GPU.

Verified result: `HeadlessChrome/153.0.8010.0`,
`WebGL 2.0 (OpenGL ES 3.0 Chromium)`,
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`.

## Layout

```
tools/verify/
├── bootstrap.sh               idempotent full setup (safe to re-run; ~40 s cold, ~1 s warm)
├── browser.mjs                launch helper (dep resolution, env, flags)
├── probe-webgl.mjs            self-test: raw WebGL2 triangle + readPixels + screenshot
├── verify.mjs                 smoke-test a running dev server (errors, WebGL, FPS, shot)
├── patch/
│   ├── patch_nss_version.py   the ELF verneed relaxer (dependency-free, idempotent)
│   ├── nss_compat_shim.c      PK11_HasAttributeSet shim source
│   └── nss_compat_shim.map    version script (tags the symbol NSS_3.22)
└── out/                       screenshots (gitignored)
```

Cache locations (deliberately **not** in git — see “What is committed”):

| Path | Contents | Survives? |
|---|---|---|
| `$VERIFY_HOME` (default `/home/user/.verify`) | `node_modules` (puppeteer-core, @sparticuz/chromium), `runtime-libs/` (NSS + SwiftShader), built shim, `out/` | workspace snapshot |
| `/tmp/chromium`, `/tmp/chromium-patched`, swiftshader libs | inflated + patched browser | per-boot; rebuilt in ~25 s |

## Usage

```bash
npm run verify:setup                                                # once per sandbox (idempotent)
npm run verify:probe                                                # prove WebGL works -> out/probe-webgl.png
npm run dev & npm run verify -- --url http://localhost:5173         # generic smoke test
npm run verify:acceptance -- --url http://localhost:5173            # per-document acceptance suite
```

`acceptance-doc1.mjs` automates the Document 1 §9 checklist end-to-end (boot
health, §6.2 scene screenshot, F3 overlay toggle, resize/aspect, EventBus
reserved events, InputManager action tracking, SettingsStore persistence
across reload, AssetLoader preload progress, /assets reachability). It
provisions and removes its own temporary texture fixture. Each later document
adds its own `acceptance-docN.mjs` the same way.

`verify.mjs` prints a JSON report `{ url, webgl, errors, warnings, fps, title }`
and exits non-zero if the page threw, failed requests, or (with
`--expect-webgl`) produced no WebGL-capable canvas. It is intended to be wired
into `npm run verify` once Document 1 lands the root `package.json`.

Environment overrides: `VERIFY_HOME`, `OPERATOR_CHROME_BIN`.

## What is committed vs. what is not

Committed: everything in this directory **except** `out/` — i.e. the scripts,
the patcher, the shim source and this README (~20 KB of text).

Not committed: the ~8.7 MB of prebuilt NSS `.so` files and the ~200 MB browser.
They are re-derivable in ~40 s from the npm/PyPI registries via `bootstrap.sh`,
and the repository's binary budget must stay reserved for real game assets
(models/textures/audio) generated by `/tools` in later documents. If you want
the libs vendored into git anyway, copy `runtime-libs/` in and extend
`bootstrap.sh`'s cache check — but expect a ~9 MB permanent tax on every clone.
