// Core decision logic. Pure, no browser/DOM dependencies, unit-tested.

export interface MilesOption {
  miles: number | string;
  cash?: number | string;
  label?: string;
}

export interface AnalyzedRow {
  index: number;
  label: string;
  miles: number;
  cash: number;
  saved: number;
  perMile: number; // R$/milha
  milheiro: number; // R$/milheiro (per 1000 miles)
  cpm: number; // centavos/milha
}

export interface Marginal {
  from: string;
  to: string;
  extraMiles: number;
  extraSaved: number;
  milheiro: number;
}

export type Verdict = 'miles' | 'cash' | 'unknown';

export interface AnalyzeInput {
  cashPrice: number | string;
  options: MilesOption[];
  baseline: number | string;
}

export interface AnalyzeResult {
  cash: number;
  baseline: number;
  rows: AnalyzedRow[];
  best: AnalyzedRow | null;
  marginals: Marginal[];
  verdict: Verdict;
}

export interface ExtractedOffers {
  options: Array<{ miles: number; cash: number }>;
}

// Parse a Brazilian-formatted number.
//   "2.484,00" -> 2484      "70.655" -> 70655      "90,20" -> 90.2
//   "BRL 1.001,63" -> 1001.63
// Assumes pt-BR convention: "." is a thousands separator, "," is the decimal.
export function parseBRL(input: unknown): number {
  if (typeof input === 'number') return input;
  if (input == null) return NaN;
  const token = String(input).replace(/[^\d.,-]/g, '');
  if (!token) return NaN;
  const norm = token.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : NaN;
}

// Core decision.
//   cashPrice: pure-money fare for the same flight (R$)
//   options:   each miles+cash combo LATAM offers
//   baseline:  your value of a mile, in R$/milheiro (per 1000 miles)
//
// Returns each option's VPM (value per mile) and a verdict: burn miles when the
// best option beats your baseline, otherwise pay cash.
export function analyze(input: Partial<AnalyzeInput> = {}): AnalyzeResult {
  const cash = parseBRL(input.cashPrice);
  const bl = parseBRL(input.baseline);

  const rows: AnalyzedRow[] = (input.options ?? [])
    .map((o, i): AnalyzedRow => {
      const miles = parseBRL(o.miles);
      const oc = parseBRL(o.cash);
      const cashOut = Number.isFinite(oc) ? oc : 0;
      const saved = cash - cashOut; // R$ you avoid paying
      const perMile = miles > 0 ? saved / miles : NaN;
      return {
        index: i,
        label: o.label ?? `opção ${i + 1}`,
        miles,
        cash: cashOut,
        saved,
        perMile,
        milheiro: perMile * 1000,
        cpm: perMile * 100,
      };
    })
    .filter((r) => Number.isFinite(r.miles) && r.miles > 0);

  const valid = rows.filter((r) => Number.isFinite(r.milheiro));
  const best = valid.length ? valid.reduce((a, b) => (b.milheiro > a.milheiro ? b : a)) : null;

  // Marginal analysis: slide toward more miles, what does each extra block buy?
  const sorted = [...valid].sort((a, b) => a.miles - b.miles);
  const marginals: Marginal[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const lo = sorted[i - 1];
    const hi = sorted[i];
    const extraMiles = hi.miles - lo.miles;
    const extraSaved = lo.cash - hi.cash; // more miles -> less cash out
    marginals.push({
      from: lo.label,
      to: hi.label,
      extraMiles,
      extraSaved,
      milheiro: extraMiles > 0 ? (extraSaved / extraMiles) * 1000 : NaN,
    });
  }

  let verdict: Verdict = 'unknown';
  if (best && Number.isFinite(bl)) {
    verdict = best.milheiro >= bl ? 'miles' : 'cash';
  }

  return { cash, baseline: bl, rows, best, marginals, verdict };
}

// Best-effort heuristic: dig miles+cash offers out of an unknown LATAM JSON
// payload. LATAM's schema is not documented here, so this walks the tree and
// grabs any object that carries a miles-like number (and an optional cash-like
// sibling). Tune the regexes / sanity bounds against a real capture (content.ts
// console-logs every payload under "[milheiro]").
export function extractOffers(rootNode: unknown): ExtractedOffers {
  const MILES_RE = /(mile|milla|ponto|point|redempt)/i;
  const CASH_RE = /(money|cash|amount|price|tax|brl|total|fare)/i;
  const MIN_MILES = 1000;
  const MAX_MILES = 3_000_000;

  const num = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && typeof (v as { amount?: unknown }).amount === 'number') {
      return (v as { amount: number }).amount;
    }
    return NaN;
  };
  const findField = (obj: Record<string, unknown>, re: RegExp, skip: string): number => {
    for (const k of Object.keys(obj)) {
      if (k === skip) continue;
      if (re.test(k)) {
        const n = num(obj[k]);
        if (Number.isFinite(n)) return n;
      }
    }
    return NaN;
  };

  const options: Array<{ miles: number; cash: number }> = [];
  const seen = new Set<string>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    const milesKey = Object.keys(obj).find((k) => MILES_RE.test(k) && Number.isFinite(num(obj[k])));
    if (milesKey) {
      const miles = num(obj[milesKey]);
      if (miles >= MIN_MILES && miles <= MAX_MILES) {
        let cash = findField(obj, CASH_RE, milesKey);
        if (!Number.isFinite(cash)) cash = 0;
        const key = `${miles}/${cash}`;
        if (!seen.has(key)) {
          seen.add(key);
          options.push({ miles, cash });
        }
      }
    }
    for (const k of Object.keys(obj)) walk(obj[k]);
  };
  walk(rootNode);

  return { options };
}

// LATAM's /bff/air-offers/v2/offers/search (redemption=true) payload already
// carries the cash value next to the miles, so no second request is needed:
//   price:           { currency: "LOYALTY_POINTS", amount } -> miles
//   priceWithOutTax: { currency: "BRL", amount }            -> cash fare (R$)
//   taxes:           { currency: "BRL", amount }            -> paid either way
// milheiro = cash you avoid by paying miles, per 1000 miles.
export interface LatamBrand {
  flightIndex: number; // position in content[], matches DOM data-testid index
  flightCode: string;
  brandText: string;
  cabin: string;
  offerId: string;
  miles: number;
  cashWithoutTax: number;
  taxes: number;
  milheiro: number;
}

// The slice of the payload we read. Everything optional: it's untrusted runtime
// JSON, so we assert no more than we actually guard with `?.` + typeof below.
interface LatamPayload {
  content?: Array<{
    summary?: {
      flightCode?: string;
      brands?: Array<{
        brandText?: string;
        offerId?: string;
        cabin?: { label?: string };
        price?: { currency?: string; amount?: number };
        priceWithOutTax?: { amount?: number };
        taxes?: { amount?: number };
      }>;
    };
  }>;
}

export function readLatamOffers(payload: unknown): LatamBrand[] {
  const data = payload as LatamPayload;
  const out: LatamBrand[] = [];
  if (!Array.isArray(data?.content)) return out;

  data.content.forEach((offer, flightIndex) => {
    const brands = offer?.summary?.brands;
    if (!Array.isArray(brands)) return;

    for (const b of brands) {
      if (b?.price?.currency !== 'LOYALTY_POINTS') continue;
      const miles = b.price.amount;
      const cashWithoutTax = b.priceWithOutTax?.amount;
      if (typeof miles !== 'number' || miles <= 0 || typeof cashWithoutTax !== 'number') continue;

      out.push({
        flightIndex,
        flightCode: offer?.summary?.flightCode ?? '',
        brandText: b.brandText ?? '',
        cabin: b.cabin?.label ?? '',
        offerId: b.offerId ?? '',
        miles,
        cashWithoutTax,
        taxes: typeof b.taxes?.amount === 'number' ? b.taxes.amount : 0,
        milheiro: (cashWithoutTax / miles) * 1000,
      });
    }
  });
  return out;
}

export interface LatamFlight {
  flightCode: string;
  best: LatamBrand; // cheapest (entry) brand for the flight
}

export interface LatamSummary {
  best: LatamBrand | null; // highest R$/milheiro across all brands
  verdict: Verdict;
  perFlight: LatamFlight[]; // one row per flight, sorted by miles asc
}

// Collapse the flat brand list into a decision: the best value on offer, a
// verdict against the baseline, and the entry price per flight for display.
export function summarizeLatam(brands: LatamBrand[], baseline: number | string): LatamSummary {
  const bl = parseBRL(baseline);

  const cheapestByFlight = new Map<string, LatamBrand>();
  for (const b of brands) {
    const cur = cheapestByFlight.get(b.flightCode);
    if (!cur || b.miles < cur.miles) cheapestByFlight.set(b.flightCode, b);
  }
  const perFlight: LatamFlight[] = [...cheapestByFlight.values()]
    .sort((a, b) => a.miles - b.miles)
    .map((best) => ({ flightCode: best.flightCode, best }));

  const best = brands.length ? brands.reduce((a, b) => (b.milheiro > a.milheiro ? b : a)) : null;

  let verdict: Verdict = 'unknown';
  if (best && Number.isFinite(bl)) verdict = best.milheiro >= bl ? 'miles' : 'cash';

  return { best, verdict, perFlight };
}

// pt-BR number formatting, deterministic (no toLocaleString) so it's stable to
// assert in tests and identical across environments.
function grpInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function brl2(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

export interface Chip {
  text: string; // primary, varies per fare: "≈ R$ 2.052"
  sub: string; // the constant-ish rate: "28,8/mi"
  ok: boolean; // beats the baseline?
  title: string; // full breakdown for the tooltip
}

// What a single inline chip shows. In miles mode LATAM hides the cash price, so
// the primary number is the cash fare the miles are worth (varies per flight);
// the rate and verdict are secondary/detail.
export function chipFor(brand: LatamBrand, baseline: number | string): Chip {
  const bl = parseBRL(baseline);
  const ok = Number.isFinite(bl) ? brand.milheiro >= bl : true;
  const sub = `${brand.milheiro.toFixed(1).replace('.', ',')}/mi`;
  const verdict = !Number.isFinite(bl)
    ? ''
    : ok
      ? ` · acima do baseline R$ ${brl2(bl)}`
      : ` · abaixo do baseline R$ ${brl2(bl)}`;
  return {
    text: `≈ R$ ${grpInt(brand.cashWithoutTax)}`,
    sub,
    ok,
    title: `${grpInt(brand.miles)} milhas = R$ ${brl2(brand.cashWithoutTax)} de tarifa · R$ ${sub}lheiro${verdict}`,
  };
}
