/**
 * browser.mjs — single place that knows how to launch the sandbox Chromium.
 *
 * Resolves puppeteer-core / @sparticuz/chromium from the project's own
 * node_modules first (once the root package.json carries them as devDeps),
 * falling back to the sandbox cache ($VERIFY_HOME) so the harness also works
 * standalone before Document 1 lands.
 *
 * See ./README.md for why the launch needs LD_LIBRARY_PATH (NSS libs from the
 * PyPI `kaleido` wheel) and LD_PRELOAD (nss_compat_shim.so).
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const VERIFY_HOME = process.env.VERIFY_HOME || '/home/user/.verify';
export const CHROMIUM_BIN = process.env.OPERATOR_CHROME_BIN || '/tmp/chromium-patched';
export const RUNTIME_LIBS = path.join(VERIFY_HOME, 'runtime-libs');
export const SHIM = path.join(VERIFY_HOME, 'patch', 'nss_compat_shim.so');

/** @returns {{puppeteer: any, chromium: any}} */
export function loadDeps() {
  const bases = [import.meta.url, `file://${path.join(VERIFY_HOME, 'noop.js')}`];
  let lastErr;
  for (const base of bases) {
    try {
      const req = createRequire(base);
      return { puppeteer: req('puppeteer-core'), chromium: req('@sparticuz/chromium') };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `puppeteer-core / @sparticuz/chromium not found (looked in project and ${VERIFY_HOME}).\n` +
      `Run: tools/verify/bootstrap.sh\n${lastErr && lastErr.message}`,
  );
}

export function assertReady() {
  const missing = [];
  if (!existsSync(CHROMIUM_BIN)) missing.push(`chromium binary: ${CHROMIUM_BIN}`);
  if (!existsSync(path.join(RUNTIME_LIBS, 'libnss3.so'))) missing.push(`NSS libs: ${RUNTIME_LIBS}`);
  if (!existsSync(SHIM)) missing.push(`NSS shim: ${SHIM}`);
  if (missing.length) {
    throw new Error(`Verification environment incomplete:\n - ${missing.join('\n - ')}\nRun: tools/verify/bootstrap.sh`);
  }
}

/**
 * Launch headless Chromium with software WebGL (ANGLE/SwiftShader).
 * @param {object} [opts]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
export async function launchBrowser(opts = {}) {
  assertReady();
  const { puppeteer } = loadDeps();
  return puppeteer.launch({
    executablePath: CHROMIUM_BIN,
    headless: true,
    defaultViewport: { width: opts.width ?? 1280, height: opts.height ?? 720 },
    env: { ...process.env, LD_LIBRARY_PATH: RUNTIME_LIBS, LD_PRELOAD: SHIM },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
    ],
  });
}

/**
 * Attach diagnostic collectors to a page.
 * @param {import('puppeteer-core').Page} page
 * @returns {{errors: string[], warnings: string[], failedRequests: string[]}}
 */
export function collectDiagnostics(page) {
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    if (msg.type() === 'error') errors.push(line);
    else if (msg.type() === 'warning') warnings.push(line);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`));
  return { errors, warnings, failedRequests };
}

/**
 * Probe the page's WebGL capability (offscreen canvas, does not disturb the app).
 * @param {import('puppeteer-core').Page} page
 */
export async function probeWebGL(page) {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { ok: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      ok: true,
      version: gl.getParameter(gl.VERSION),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
  });
}

/** Sample requestAnimationFrame for `ms` and return measured FPS. */
export async function sampleFps(page, ms = 1500) {
  return page.evaluate((dur) => new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      frames += 1;
      if (performance.now() - t0 < dur) requestAnimationFrame(tick);
      else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
    };
    requestAnimationFrame(tick);
  }), ms);
}
