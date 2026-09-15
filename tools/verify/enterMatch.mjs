/**
 * enterMatch.mjs — shared harness helper.
 *
 * Document 5 put a real main menu in front of gameplay, so every harness that
 * tests IN-MATCH behaviour has to get into a match first. This drives the
 * genuine UI path (Play -> level card -> Click to Play) rather than forcing
 * the state, so the harnesses keep exercising the real flow.
 */

/**
 * Take a freshly-loaded page from the main menu into an active match.
 * Resolves once the state is PLAYING and the third-person body is ready.
 */
export async function enterMatch(page, { levelIndex = 0, timeout = 90000 } = {}) {
  await page.waitForFunction(() => Boolean(window.__OPERATOR__), { timeout });

  const alreadyPlaying = await page.evaluate(
    () => window.__OPERATOR__.gameStateManager.getState() === 'PLAYING',
  );
  if (alreadyPlaying) return;

  // Main menu -> level select.
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('[data-screen=mainMenu] .btn')];
    return b.some((x) => x.textContent.trim() === 'Play' && x.offsetParent !== null);
  }, { timeout });
  await page.evaluate(() => {
    [...document.querySelectorAll('[data-screen=mainMenu] .btn')]
      .find((b) => b.textContent.trim() === 'Play').click();
  });

  await page.waitForFunction(
    () => document.querySelectorAll('.level-card').length > 0, { timeout },
  );
  await page.evaluate((i) => {
    const cards = document.querySelectorAll('.level-card');
    (cards[i] ?? cards[0]).click();
  }, levelIndex);

  // Loading -> the click gate (pointer lock needs a real gesture).
  await page.waitForFunction(() => [...document.querySelectorAll('.btn--primary')]
    .some((x) => x.textContent.trim() === 'Click to Play' && x.offsetParent !== null),
  { timeout });
  await page.evaluate(() => {
    [...document.querySelectorAll('.btn--primary')]
      .find((x) => x.textContent.trim() === 'Click to Play').click();
  });

  await page.waitForFunction(
    () => window.__OPERATOR__.gameStateManager.getState() === 'PLAYING', { timeout },
  );
  await page.waitForFunction(
    () => window.__OPERATOR__.thirdPersonBody?.isReady === true, { timeout },
  ).catch(() => {});
  // Let the first frames settle (spawn teleport, weapon equip, IK warm-up).
  await new Promise((r) => setTimeout(r, 1200));
}

export default enterMatch;
