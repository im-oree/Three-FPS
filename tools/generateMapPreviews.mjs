/**
 * generateMapPreviews.mjs — an aerial beauty shot for every map.
 *
 * WHY THIS EXISTS
 * ---------------
 * The menu shows a card per map, and a card without art is a card that looks
 * broken. Hand-supplying screenshots would violate the project's asset policy
 * (every asset is produced by a real tool script) and would rot the moment a
 * map changes. So previews are RENDERED from the live game: this script boots
 * the real dev server, loads each level through the real LevelLoader, flies a
 * camera to a three-quarter aerial angle, and captures the frame.
 *
 * COMPULSORY BY CONSTRUCTION
 * --------------------------
 * `verifyPreviews()` fails if any level in LevelDefinition.ts lacks a preview
 * file, and `npm run verify:previews` runs it. A new map therefore cannot
 * ship without art -- not by convention, but because the check goes red.
 *
 * ANGLE CHOICE
 * ------------
 * Straight down reads as a blueprint, not a map. The camera sits at a 38°
 * pitch on the map diagonal, which shows building faces and silhouettes --
 * the things that make a map recognisable -- while still revealing the
 * layout. Framing is derived from each level's own worldExtents, so a big
 * map is not cropped and a small one does not swim in empty ground.
 */
import { launchBrowser } from './verify/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/previews');
const URL = process.env.PREVIEW_URL ?? 'http://localhost:5174';

/** Read the level ids straight from the definition file — one source of truth. */
export function levelIds() {
  const source = fs.readFileSync(
    path.join(ROOT, 'src/environment/LevelDefinition.ts'), 'utf8',
  );
  const ids = [];
  // Only match ids at the top level of a level object, which are the ones
  // followed by a displayName.
  const pattern = /id:\s*'([a-z_]+)',\s*\n\s*displayName:/g;
  let match;
  while ((match = pattern.exec(source))) ids.push(match[1]);
  return ids;
}

/** Fail loudly when a map has no preview. Used by verify:previews. */
export function verifyPreviews() {
  const missing = levelIds().filter(
    (id) => !fs.existsSync(path.join(OUT_DIR, `${id}.jpg`)),
  );
  return { ids: levelIds(), missing };
}

async function main() {
  if (process.argv.includes('--verify')) {
    const { ids, missing } = verifyPreviews();
    if (missing.length) {
      console.error(`[previews] MISSING for: ${missing.join(', ')}`);
      console.error('[previews] run: npm run generate:previews');
      process.exit(1);
    }
    console.log(`[previews] all ${ids.length} maps have previews`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (error) => console.log('  [page]', String(error).slice(0, 160)));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__OPERATOR__?.gameStateManager?.getState() === 'MAIN_MENU',
    { timeout: 120000 },
  );

  const ids = levelIds();
  console.log(`[previews] rendering ${ids.length} maps`);

  // The menu is an opaque DOM layer painted over the canvas, so capturing
  // with it visible photographs the menu, not the map. Hide the whole UI
  // root for the duration of the shoot.
  await page.evaluate(() => {
    const root = document.getElementById('ui-root');
    if (root) root.style.display = 'none';
  });

  for (const id of ids) {
    process.stdout.write(`  ${id.padEnd(16)}`);
    // Load the level through the real loader.
    await page.evaluate(async (levelId) => {
      const op = window.__OPERATOR__;
      await op.levelLoader.load(levelId);
    }, id);

    // Let props settle and textures upload.
    await new Promise((r) => setTimeout(r, 1200));

    const framed = await page.evaluate((levelId) => {
      const op = window.__OPERATOR__;
      const level = op.levelLoader.currentDefinition ?? {};
      const extents = level.worldExtents ?? {
        centerX: 0, centerZ: 0,
        halfWidth: level.groundHalfSize ?? 40,
        halfHeight: level.groundHalfSize ?? 40,
      };
      const reach = Math.max(extents.halfWidth, extents.halfHeight);

      // Three-quarter aerial on the diagonal: shows building faces AND the
      // layout. Straight down reads as a blueprint, not a map.
      const pitch = (38 * Math.PI) / 180;
      const yaw = (35 * Math.PI) / 180;
      const distance = reach * 2.25;
      return {
        reach,
        distance: Math.round(distance),
        far: reach * 14,
        pos: [
          extents.centerX + Math.sin(yaw) * Math.cos(pitch) * distance,
          Math.sin(pitch) * distance + reach * 0.12,
          extents.centerZ + Math.cos(yaw) * Math.cos(pitch) * distance,
        ],
        look: [extents.centerX, 0, extents.centerZ],
        skyColor: level.skyColor ?? 0x2a3240,
      };
    }, id);

    // Render the preview OURSELVES into an offscreen target and read the
    // pixels back, instead of screenshotting the page.
    //
    // Screenshotting cannot work here: after the world pass the frame gets
    // the viewmodel pass, the live minimap capture and the tablet map
    // composited into the same backbuffer, so whatever the page shows is not
    // the clean world render. Owning the render is also faster and gives an
    // exact, deterministic framing.
    const dataUrl = await page.evaluate(async (framing) => {
      const op = window.__OPERATOR__;
      const THREE = op.THREE;
      const renderer = op.engine.renderer.getRenderer();
      const scene = op.engine.sceneManager.getScene();

      const width = 1280;
      const height = 720;
      const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, framing.far);
      camera.position.fromArray(framing.pos);
      camera.lookAt(framing.look[0], framing.look[1], framing.look[2]);
      // World layer only: the viewmodel's own lights live in this scene and
      // would blow the map out to white.
      camera.layers.set(0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      // 8-bit target. HalfFloat reads back as all zeros under this sandbox's
      // SwiftShader, and rendering to a target skips three's tone mapping
      // anyway, so the exposure is compensated below instead.
      const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });

      // Swap the HDRI sky for a flat colour, and drop the environment map,
      // for the duration of the shoot.
      //
      // Rendering to a target bypasses three's tone mapping, so the HDRI's
      // high dynamic range arrives unmapped and clips every pixel to pure
      // white. Measured: with the env map bound the whole frame reads 255;
      // without it, 0-73. Everything is restored afterwards.
      const savedBackground = scene.background;
      const savedEnvironment = scene.environment;
      const savedFog = scene.fog;
      const savedEnvIntensity = scene.environmentIntensity;

      scene.background = new THREE.Color(framing.skyColor);
      // Removing the env map also removes the ambient IBL the maps are lit
      // by, so replace it with a temporary hemisphere fill. Without this the
      // geometry is correct but almost black.
      scene.environment = null;
      const fill = new THREE.HemisphereLight(0xdceaff, 0x4a4035, 2.1);
      const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
      sun.position.set(-0.4, 1, 0.55).multiplyScalar(framing.reach * 2);
      scene.add(fill, sun);
      // A gentle linear fog keeps aerial depth without the exponential
      // haze that turns a 100 m shot into a white sheet.
      scene.fog = new THREE.Fog(framing.skyColor, framing.far * 0.35, framing.far * 1.1);

      const previousTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);

      const pixels = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);

      scene.remove(fill, sun);
      fill.dispose();
      sun.dispose();
      scene.background = savedBackground;
      scene.environment = savedEnvironment;
      scene.fog = savedFog;
      scene.environmentIntensity = savedEnvIntensity;
      target.dispose();

      // WebGL reads bottom-up; flip into a canvas to get a normal image.
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const image = context.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        const source = (height - 1 - y) * width * 4;
        image.data.set(pixels.subarray(source, source + width * 4), y * width * 4);
      }
      context.putImageData(image, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.9);
    }, framed);

    fs.writeFileSync(
      path.join(OUT_DIR, `${id}.jpg`),
      Buffer.from(dataUrl.split(',')[1], 'base64'),
    );
    console.log(`reach=${framed.reach} dist=${framed.distance} -> ${id}.jpg`);
  }

  await browser.close();
  const { missing } = verifyPreviews();
  console.log(missing.length
    ? `[previews] STILL MISSING: ${missing.join(', ')}`
    : `[previews] complete: ${ids.length} previews in assets/previews/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
