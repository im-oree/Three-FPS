/**
 * enterMatch.mjs — shared harness helper.
 *
 * Document 5 put a real main menu in front of gameplay, so every harness that
 * tests IN-MATCH behaviour has to get into a match first. This drives the
 * genuine UI path (MAPS -> map card -> automatic deploy) rather than forcing
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

  // Main menu -> map browser -> deploy.
  //
  // The lobby was rebuilt to match Call of Duty: there is no "Play" button
  // and no "Click to Play" gate any more. Choosing a map IS the deploy, and
  // the match starts as soon as the level is ready. This helper drives that
  // real path rather than forcing state, so harnesses keep testing the flow
  // players actually use.
  await page.waitForFunction(
    () => [...document.querySelectorAll('.cod__mode')]
      .some((node) => node.textContent.includes('MAPS') && node.offsetParent !== null),
    { timeout },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('.cod__mode')]
      .find((node) => node.textContent.includes('MAPS')).click();
  });

  await page.waitForFunction(
    () => document.querySelectorAll('.mapcard[data-level-id]').length > 0, { timeout },
  );
  await page.evaluate((i) => {
    const cards = document.querySelectorAll('.mapcard[data-level-id]');
    (cards[i] ?? cards[0]).click();
  }, levelIndex);

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
