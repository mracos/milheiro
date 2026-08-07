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
