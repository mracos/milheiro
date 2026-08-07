import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { parseBRL, analyze, extractOffers, parseLatamOffers, type AnalyzeInput } from '../src/calc.ts';

const milesPayload = JSON.parse(
  readFileSync(new URL('./fixtures/latam-miles-offers.json', import.meta.url), 'utf8'),
);

test('parseBRL handles pt-BR formatting', () => {
  assert.strictEqual(parseBRL('2.484,00'), 2484);
  assert.strictEqual(parseBRL('70.655'), 70655);
  assert.strictEqual(parseBRL('90,20'), 90.2);
  assert.strictEqual(parseBRL('BRL 1.001,63'), 1001.63);
  assert.strictEqual(parseBRL(35328), 35328);
  assert.ok(Number.isNaN(parseBRL('')));
  assert.ok(Number.isNaN(parseBRL(null)));
});

// The worked example from the conversation.
const EXAMPLE: AnalyzeInput = {
  cashPrice: '2.484,00',
  baseline: 25,
  options: [
    { miles: '70.655', cash: '90,20' },
    { miles: '63.590', cash: '457,58' },
    { miles: '49.459', cash: '1.001,63' },
    { miles: '35.328', cash: '1.467,95' },
  ],
};

test('analyze ranks the max-miles option as best', () => {
  const r = analyze(EXAMPLE);

  assert.strictEqual(r.best?.index, 0);
  assert.ok(Math.abs((r.best?.milheiro ?? 0) - 33.88) < 0.05, `got ${r.best?.milheiro}`);
  assert.strictEqual(r.verdict, 'miles');
});

test('analyze respects a high baseline (hoarder pays cash)', () => {
  const r = analyze({ ...EXAMPLE, baseline: 45 });
  assert.strictEqual(r.verdict, 'cash');
});

test('analyze computes marginal VPM between steps', () => {
  const r = analyze(EXAMPLE);
  const last = r.marginals[r.marginals.length - 1]; // the 63.590 -> 70.655 jump

  assert.strictEqual(last.extraMiles, 7065);
  assert.ok(Math.abs(last.extraSaved - 367.38) < 0.01, `got ${last.extraSaved}`);
  assert.ok(Math.abs(last.milheiro - 52.0) < 0.1, `got ${last.milheiro}`);
});

test('analyze treats missing option cash as zero', () => {
  const r = analyze({ cashPrice: 1000, options: [{ miles: 50000 }], baseline: 10 });
  assert.strictEqual(r.rows[0].cash, 0);
  assert.strictEqual(r.rows[0].saved, 1000);
});

test('extractOffers digs miles+cash out of nested JSON', () => {
  const payload = {
    itinerary: {
      brands: [
        { milesAmount: 70655, money: { amount: 90.2, currency: 'BRL' } },
        { milesAmount: 63590, money: { amount: 457.58, currency: 'BRL' } },
      ],
    },
    junk: { label: 'no miles here', totalAmount: 12 },
  };
  const { options } = extractOffers(payload);

  assert.strictEqual(options.length, 2);
  assert.deepStrictEqual(options[0], { miles: 70655, cash: 90.2 });
});

test('extractOffers ignores out-of-range mile counts', () => {
  const { options } = extractOffers({ points: 5, other: { milesAmount: 9999999999 } });
  assert.strictEqual(options.length, 0);
});

test('parseLatamOffers pulls miles + cash from a real miles payload', () => {
  const brands = parseLatamOffers(milesPayload);

  assert.strictEqual(brands.length, 4);
  const light = brands[0];
  assert.strictEqual(light.flightCode, 'LA3898');
  assert.strictEqual(light.brandText, 'LIGHT');
  assert.strictEqual(light.cabin, 'Economy');
  assert.strictEqual(light.miles, 71976);
  assert.strictEqual(light.cashWithoutTax, 2072.9);
  assert.strictEqual(light.taxes, 51.92);
  assert.ok(Math.abs(light.milheiro - 28.8) < 0.05, `got ${light.milheiro}`);
});

test('parseLatamOffers skips cash-only brands and junk', () => {
  const cashPayload = {
    content: [
      { summary: { flightCode: 'LA1', brands: [{ price: { currency: 'BRL', amount: 501 } }] } },
    ],
  };
  assert.strictEqual(parseLatamOffers(cashPayload).length, 0);
  assert.strictEqual(parseLatamOffers(null).length, 0);
  assert.strictEqual(parseLatamOffers({}).length, 0);
});
