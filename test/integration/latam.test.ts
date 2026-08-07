// Nightly drift detector. Hits a real LATAM cash search (no login needed) and
// asserts the two things the extension couples to:
//   1. the offers/search JSON shape our parser reads
//   2. the data-testid anchors our content script injects chips into
//
// It runs a real browser, so it is NOT part of `npm test`. Run with:
//   npx playwright install chromium && npm run test:integration
//
// Gap: the miles-only fields (price.currency=LOYALTY_POINTS, priceWithOutTax)
// only appear when logged in, so they can't be checked here. The committed
// fixture in test/fixtures guards our own regressions against that shape.
import test from 'node:test';
import assert from 'node:assert';
import { chromium, type Browser } from 'playwright';

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
    browser = await chromium.launch();
  } catch {
    t.skip('chromium not installed (run: npx playwright install chromium)');
    return;
  }

  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    });

    let offers: unknown = null;
    page.on('response', async (res) => {
      if (/offers\/search/.test(res.url()) && res.status() === 200) {
        offers = await res.json().catch(() => null);
      }
    });

    await page.goto(SEARCH, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-testid="wrapper-card-flight-0"]', { timeout: 45_000 });

    // 1. API shape our parser depends on.
    const brand = (
      offers as { content?: { summary?: { brands?: { price?: { amount?: unknown } }[] } }[] }
    )?.content?.[0]?.summary?.brands?.[0];
    assert.ok(offers, 'captured an offers/search response');
    assert.ok(
      brand && brand.price && typeof brand.price.amount === 'number',
      'content[].summary.brands[].price.amount still present',
    );

    // 2. DOM anchors our content script injects into.
    assert.ok(
      await page.$('[data-testid="flight-info-0-amount"]'),
      'flight card amount anchor present',
    );
    await page.click('[data-testid="wrapper-card-header-0"]');
    await page.waitForSelector('[data-testid="flight-0-price-LIGHT"]', { timeout: 20_000 });
  } finally {
    await browser.close();
  }
});
