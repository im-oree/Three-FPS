import { launchBrowser } from '/home/user/Three-FPS/tools/verify/browser.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchBrowser({ width: 640, height: 360 });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction('window.__OPERATOR__ && window.__OPERATOR__.handsRig', { timeout: 60000 });
await sleep(3000);
const st = await page.evaluate(() => ({
  active: window.__OPERATOR__.weaponManager.activeWeapon?.def?.id ?? null,
  hands: !!window.__OPERATOR__.handsRig.root,
}));
console.log(JSON.stringify({ st, errs: errs.slice(0, 6) }));
await browser.close();
