// Content script (isolated world). Injects the page-context interceptor, reads
// LATAM's miles offers off the captured payload, and annotates each flight card
// and fare brand in LATAM's own UI with an R$/milheiro chip.
//
// DOM join (stable data-testids, same order as the JSON content[]):
//   flight card    -> [data-testid="flight-info-${i}-amount"]
//   fare brand     -> [data-testid="flight-${i}-price-${BRANDTEXT}"]
import { readLatamOffers, chipFor, type LatamBrand } from './calc.ts';

declare const browser: typeof chrome | undefined;
const api = typeof browser !== 'undefined' ? browser : chrome;
const DEFAULT_BASELINE = 25;

// 1. Inject the interceptor into the page context.
try {
  const s = document.createElement('script');
  s.src = api.runtime.getURL('inject.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
} catch (e) {
  console.warn('[milheiro] could not inject interceptor', e);
}

let offers: LatamBrand[] = [];
let baseline: number | string = DEFAULT_BASELINE;
let observer: MutationObserver | null = null;

// 2. Capture miles payloads.
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== 'milheiro' || d.kind !== 'payload') return;

  let brands: LatamBrand[];
  try {
    brands = readLatamOffers(d.data);
  } catch {
    return;
  }
  if (!brands.length) return;

  offers = brands;
  console.log('[milheiro] read', brands.length, 'miles brands from', d.url);
  void start();
});

async function start(): Promise<void> {
  try {
    const store = await api.storage.local.get(['baseline']);
    baseline = store.baseline != null ? (store.baseline as string | number) : DEFAULT_BASELINE;
  } catch {
    /* storage unavailable */
  }
  inject();
  // LATAM is an SPA: cards render lazily and brands appear on expand. Re-inject
  // whenever the DOM changes (debounced; place() is idempotent).
  if (!observer) {
    observer = new MutationObserver(debounce(inject, 150));
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function inject(): void {
  // per-brand chips (visible when a flight is expanded)
  for (const b of offers) {
    place(`flight-${b.flightIndex}-price-${b.brandText}`, b);
  }
  // per-flight chip on the collapsed card: the cheapest (entry) brand
  const cheapest = new Map<number, LatamBrand>();
  for (const b of offers) {
    const cur = cheapest.get(b.flightIndex);
    if (!cur || b.miles < cur.miles) cheapest.set(b.flightIndex, b);
  }
  for (const [idx, b] of cheapest) {
    place(`flight-info-${idx}-amount`, b);
  }
}

function place(testid: string, brand: LatamBrand): void {
  const host = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!host || host.querySelector('.mlh-chip')) return;

  const { text, ok } = chipFor(brand, baseline);
  const chip = document.createElement('span');
  chip.className = `mlh-chip ${ok ? 'mlh-ok' : 'mlh-bad'}`;
  chip.textContent = text;
  chip.title =
    `${brand.miles.toLocaleString('pt-BR')} milhas · fare R$ ${money(brand.cashWithoutTax)} · ` +
    `${ok ? 'acima' : 'abaixo'} do baseline R$ ${money(baseline)}`;
  host.appendChild(chip);
}

function debounce<T extends () => void>(fn: T, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function money(n: number | string): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(v)
    ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}
