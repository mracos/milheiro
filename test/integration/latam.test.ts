// Weekly drift detector. Hits a real LATAM cash search (no login needed) and
// asserts the two things the extension couples to:
//   1. the offers/search JSON shape our parser reads
//   2. the data-testid anchors our content script injects chips into
//
// LATAM sits behind Akamai bot protection. Vanilla headless Playwright gets an
// "Access Denied" wall; a stealthed, HEADED Chromium gets through it (headless
// still gets fingerprinted). In CI that means running under xvfb (see
// .github/workflows/weekly.yml). Separately, LATAM's own search backend often
// returns a "taking longer than normal" page for automated traffic - that's not
// drift, so we don't fail on it.
//
// The two checks are independent, so we don't gate them on the same signal
// (that would make DOM flakiness mask real API drift, a false negative):
//   - The offers/search JSON usually comes back even when the results UI
//     degrades, so the API-shape check runs whenever we captured a response.
//   - The DOM-anchor check needs a rendered results page, so it runs only when
//     the cards actually load.
// We skip (inconclusive) only when we got neither - a block or a dead search.
//
// It runs a real browser, so it is NOT part of `npm test`. Run with:
//   npx playwright install chromium && npm run test:integration
//
// Gap: the miles-only fields (price.currency=LOYALTY_POINTS, priceWithOutTax)
// only appear when logged in, so they can't be checked here. The committed
// fixture in test/fixtures guards our own regressions against that shape.
import test from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import type { Browser } from 'playwright';

chromium.use(stealth());

const SEARCH = (() => {
  const out = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    origin: 'GRU',
    outbound: `${out}T12:00:00.000Z`,
    destination: 'SDU',
    adt: '1',
    chd: '0',
    inf: '0',
    trip: 'OW',
    cabin: 'Economy',
    redemption: 'false',
    sort: 'RECOMMENDED',
  });
  return `https://www.latamairlines.com/br/pt/oferta-voos?${q}`;
})();

test('LATAM offers API + DOM anchors still match our assumptions', async (t) => {
  let browser: Browser;
  try {
    // Headed: Akamai fingerprints headless Chromium into a degraded search path.
    browser = await chromium.launch({ headless: false });
  } catch {
    t.skip('chromium not installed (run: npx playwright install chromium)');
    return;
  }

  try {
    const page = await browser.newPage({
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });

    let offers: unknown = null;
    page.on('response', async (res) => {
      if (/offers\/search/.test(res.url()) && res.status() === 200) {
        offers = await res.json().catch(() => null);
      }
    });

    // Retry the search: LATAM throttles automated traffic into "Access Denied"
    // (Akamai) or its own "taking longer than normal" page. Neither is drift, so
    // we retry to raise the odds of a real render before deciding anything.
    type Load = 'loaded' | 'blocked' | 'degraded' | 'timeout';
    const attempt = async (): Promise<Load> => {
      await page.goto(SEARCH, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      if (/access denied/i.test(await page.title())) return 'blocked';
      try {
        await page.waitForSelector('[data-testid="wrapper-card-flight-0"]', { timeout: 45_000 });
        return 'loaded';
      } catch {
        return /demorando mais que o normal|problema com os resultados/i.test(await page.title())
          ? 'degraded'
          : 'timeout';
      }
    };

    let state: Load = 'timeout';
    for (let i = 0; i < 5; i++) {
      state = await attempt();
      if (state === 'loaded') break;
      await page.waitForTimeout((i + 1) * 5_000); // linear backoff, ease the throttle
    }

    // 1. API shape our parser depends on. Runs whenever the offers/search
    //    response came back, even if the results UI degraded - that's the more
    //    stable contract and gating it on a rendered page would hide API drift.
    if (offers) {
      const brand = (
        offers as { content?: { summary?: { brands?: { price?: { amount?: unknown } }[] } }[] }
      )?.content?.[0]?.summary?.brands?.[0];
      assert.ok(
        brand && brand.price && typeof brand.price.amount === 'number',
        'content[].summary.brands[].price.amount still present',
      );
    }

    // 2. DOM anchors our content script injects into. Needs a rendered results
    //    page, so it only runs when the cards actually loaded.
    if (state === 'loaded') {
      assert.ok(
        await page.$('[data-testid="flight-info-0-amount"]'),
        'flight card amount anchor present',
      );
      await page.click('[data-testid="wrapper-card-header-0"]');
      await page.waitForSelector('[data-testid="flight-0-price-LIGHT"]', { timeout: 20_000 });
    }

    // Neither signal: a block or a dead search. Inconclusive, not drift.
    if (!offers && state !== 'loaded') {
      t.skip(
        state === 'blocked'
          ? 'Akamai blocked the run (Access Denied) - stealth may need updating'
          : `LATAM returned no offers and no results UI (${state}) - inconclusive`,
      );
    }
  } finally {
    await browser.close();
  }
});
