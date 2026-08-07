import { defineContentScript, injectScript, browser } from '#imports';
import { readLatamOffers, chipFor, type LatamBrand } from '@/utils/calc';
import '@/assets/badge.css';

const DEFAULT_BASELINE = 25;

// Annotates each LATAM flight card and fare brand with an R$/milheiro chip.
// DOM join (stable data-testids, same order as the JSON content[]):
//   flight card -> [data-testid="flight-info-${i}-amount"]
//   fare brand  -> [data-testid="flight-${i}-price-${BRANDTEXT}"]
export default defineContentScript({
  matches: ['*://*.latamairlines.com/*'],
  runAt: 'document_start',
  cssInjectionMode: 'manifest',

  async main() {
    await injectScript('/inject.js', { keepInDom: true });

    let offers: LatamBrand[] = [];
    let baseline: number | string = DEFAULT_BASELINE;
    let observer: MutationObserver | null = null;

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
        const store = await browser.storage.local.get('baseline');
        baseline = store.baseline != null ? (store.baseline as string | number) : DEFAULT_BASELINE;
      } catch {
        /* storage unavailable */
      }
      inject();
      // LATAM is an SPA: cards render lazily and brands appear on expand.
      if (!observer) {
        observer = new MutationObserver(debounce(inject, 150));
        observer.observe(document.body, { childList: true, subtree: true });
      }
    }

    function inject(): void {
      for (const b of offers) {
        place(`flight-${b.flightIndex}-price-${b.brandText}`, b);
      }
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

      const { text, sub, ok, title } = chipFor(brand, baseline);
      const chip = document.createElement('span');
      chip.className = `mlh-chip ${ok ? 'mlh-ok' : 'mlh-bad'}`;
      chip.title = title;
      chip.append(text, ' ');
      const subEl = document.createElement('span');
      subEl.className = 'mlh-sub';
      subEl.textContent = sub;
      chip.appendChild(subEl);
      host.appendChild(chip);
    }
  },
});

function debounce<T extends () => void>(fn: T, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
