/**
 * verify.mjs — smoke-test a running dev server in headless Chromium.
 *
 * Collects console errors / page errors / failed requests, probes WebGL,
 * samples rAF FPS, screenshots, prints a JSON report. Exits non-zero when the
 * page is broken so it can gate `npm run verify` in CI-ish usage.
 *
 * usage:
 *   node tools/verify/verify.mjs --url http://localhost:5173 [--out out/boot.png]
 *                                [--wait 5000] [--selector canvas] [--no-expect-webgl]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { launchBrowser, collectDiagnostics, probeWebGL, sampleFps } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { url: null, out: null, wait: 4000, selector: 'canvas', expectWebgl: true };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--wait') args.wait = Number(argv[++i]);
    else if (a === '--selector') args.selector = argv[++i];
    else if (a === '--no-expect-webgl') args.expectWebgl = false;
    else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  if (!args.url) { console.error('usage: verify.mjs --url <http://host:port>'); process.exit(2); }
  return args;
}

const args = parseArgs(process.argv);
const outPath = path.resolve(here, args.out || path.join('out', `verify-${Date.now()}.png`));
mkdirSync(path.dirname(outPath), { recursive: true });

const browser = await launchBrowser();
const page = await browser.newPage();
const diag = collectDiagnostics(page);

const report = { url: args.url, title: null, canvases: 0, webgl: null, fps: null, errors: [], warnings: [], failedRequests: [], screenshot: outPath };
try {
  await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (args.selector) {
    try { await page.waitForSelector(args.selector, { timeout: args.wait }); } catch { /* reported below */ }
  } else {
    await new Promise((r) => setTimeout(r, args.wait));
  }
  await new Promise((r) => setTimeout(r, 1000));
  report.title = await page.title();
  report.canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  report.webgl = await probeWebGL(page);
  report.fps = await sampleFps(page, 1500);
  await page.screenshot({ path: outPath });
} catch (err) {
  report.errors.push(`[harness] ${err.message}`);
}
report.errors.push(...diag.errors);
report.warnings.push(...diag.warnings);
report.failedRequests.push(...diag.failedRequests);
await browser.close();

console.log(JSON.stringify(report, null, 2));
const webglOk = !args.expectWebgl || (report.webgl && report.webgl.ok);
const ok = report.errors.length === 0 && report.failedRequests.length === 0 && webglOk && report.canvases > 0;
console.log(ok ? 'VERIFY: OK' : 'VERIFY: FAILED');
process.exit(ok ? 0 : 1);
