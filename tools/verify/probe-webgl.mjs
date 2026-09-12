/**
 * probe-webgl.mjs — harness self-test. Renders a full-screen WebGL2 triangle,
 * reads back the centre pixel to prove shaders + framebuffers really execute,
 * and saves a screenshot. Exits non-zero on any failure.
 *
 * usage: node tools/verify/probe-webgl.mjs [out.png]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, collectDiagnostics } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, 'out', 'probe-webgl.png');

const browser = await launchBrowser({ width: 960, height: 540 });
const page = await browser.newPage();
const diag = collectDiagnostics(page);

await page.setContent(`<!doctype html><html><body style="margin:0;background:#111">
<canvas id="c" width="960" height="540"></canvas>
<script>
const c = document.getElementById('c');
const gl = c.getContext('webgl2') || c.getContext('webgl');
const out = { ok: !!gl };
if (gl) {
  out.version = gl.getParameter(gl.VERSION);
  const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); return sh; };
  const vs = mk(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}');
  const fs = mk(gl.FRAGMENT_SHADER, 'precision mediump float;void main(){gl_FragColor=vec4(0.2,0.9,0.4,1.);}');
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs);
  gl.linkProgram(pr); gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(4);
  gl.readPixels(480, 270, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  out.centerPixel = [...px];
}
window.__probe = out;
</script></body></html>`);
await new Promise((r) => setTimeout(r, 1200));

const probe = await page.evaluate(() => window.__probe);
await page.screenshot({ path: out });
console.log('browser :', await browser.version());
console.log('webgl   :', JSON.stringify(probe));
console.log('shot    :', out);
await browser.close();

const expected = [51, 230, 102, 255]; // vec4(0.2, 0.9, 0.4, 1.0) * 255
const pixelOk = Array.isArray(probe.centerPixel) && probe.centerPixel.every((v, i) => Math.abs(v - expected[i]) <= 2);
if (!probe.ok || !pixelOk || diag.errors.length) {
  console.error('PROBE FAILED', { probe, errors: diag.errors });
  process.exit(1);
}
console.log('probe   : OK (WebGL2 renders + readback matches shader color)');
