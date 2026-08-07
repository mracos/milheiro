// Content script (isolated world). Injects the page-context interceptor,
// listens for captured fare payloads, and paints a small verdict badge.
// Falls back gracefully: if it can't find the cash anchor, it asks for it.
import { analyze, extractOffers, parseBRL, type AnalyzeResult } from './calc.ts';

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

// 2. Listen for payloads forwarded by the interceptor.
window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== 'milheiro' || d.kind !== 'payload') return;

  let parsed;
  try {
    parsed = extractOffers(d.data);
  } catch (e) {
    return;
  }
  if (!parsed || parsed.options.length < 2) return;

  // Always log so we can refine extractOffers against real schemas.
  console.log('[milheiro] captured offers from', d.url, parsed.options, d.data);

  try {
    api.storage.local.set({ lastOffers: parsed.options, lastOffersUrl: d.url });
  } catch (_) {}
  void renderBadge(parsed.options);
});

type Offer = { miles: number; cash: number };

// 3. Render / update the floating badge.
async function renderBadge(options: Offer[]): Promise<void> {
  let store: Record<string, unknown> = {};
  try {
    store = await api.storage.local.get(['baseline', 'lastCash']);
  } catch (_) {}
  const baseline = store.baseline != null ? store.baseline : DEFAULT_BASELINE;
  const cashPrice = store.lastCash;

  const el = ensureBadge();
  const body = el.querySelector('.mlh-body') as HTMLElement;

  if (!Number.isFinite(parseBRL(cashPrice))) {
    // We have miles options but no cash anchor yet.
    body.innerHTML =
      `<p class="mlh-hint">Achei <b>${options.length}</b> opções de milhas. ` +
      `Informe o preço em reais (do Google Flights) pra eu comparar:</p>` +
      `<div class="mlh-cashrow"><span>R$</span>` +
      `<input class="mlh-cash" type="text" inputmode="decimal" placeholder="2.484,00"></div>` +
      `<button class="mlh-go">Calcular</button>`;
    const input = el.querySelector('.mlh-cash') as HTMLInputElement;
    const go = () => {
      const v = input.value;
      api.storage.local.set({ lastCash: v });
      paint(el, analyzeSafe(v, options, baseline), baseline);
    };
    (el.querySelector('.mlh-go') as HTMLButtonElement).addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    input.focus();
    return;
  }

  paint(el, analyzeSafe(cashPrice, options, baseline), baseline);
}

function analyzeSafe(
  cashPrice: unknown,
  options: Offer[],
  baseline: unknown,
): AnalyzeResult | null {
  try {
    return analyze({ cashPrice: cashPrice as string, options, baseline: baseline as string });
  } catch (e) {
    return null;
  }
}

function paint(el: HTMLElement, r: AnalyzeResult | null, baseline: unknown): void {
  const body = el.querySelector('.mlh-body') as HTMLElement;
  if (!r || !r.best) {
    body.innerHTML = '<p class="mlh-hint">Não consegui calcular. Use o popup.</p>';
    return;
  }
  const best = r.best;
  const verdictMiles = r.verdict === 'miles';
  const rows = r.rows
    .map((row, i) => {
      const isBest = row.index === best.index;
      return (
        `<tr class="${isBest ? 'mlh-best' : ''}">` +
        `<td>${i + 1}</td>` +
        `<td>${fmtInt(row.miles)}</td>` +
        `<td>R$ ${fmtMoney(row.cash)}</td>` +
        `<td><b>${fmtMoney(row.milheiro)}</b></td></tr>`
      );
    })
    .join('');

  body.innerHTML =
    `<div class="mlh-verdict ${verdictMiles ? 'mlh-miles' : 'mlh-cash'}">` +
    (verdictMiles ? `Usa milhas — opção ${best.index + 1}` : `Paga em reais`) +
    `</div>` +
    `<div class="mlh-sub">melhor: <b>R$ ${fmtMoney(best.milheiro)}/milheiro</b> ` +
    `vs baseline R$ ${fmtMoney(parseBRL(baseline))}</div>` +
    `<table class="mlh-table"><thead><tr>` +
    `<th>#</th><th>milhas</th><th>+R$</th><th>R$/milheiro</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`;
}

let badgeEl: HTMLElement | null = null;
function ensureBadge(): HTMLElement {
  if (badgeEl && document.body.contains(badgeEl)) return badgeEl;
  badgeEl = document.createElement('div');
  badgeEl.className = 'mlh-badge';
  badgeEl.innerHTML =
    `<div class="mlh-head"><span class="mlh-logo">milheiro</span>` +
    `<button class="mlh-x" title="fechar">×</button></div>` +
    `<div class="mlh-body"></div>`;
  document.body.appendChild(badgeEl);
  (badgeEl.querySelector('.mlh-x') as HTMLButtonElement).addEventListener('click', () =>
    badgeEl?.remove(),
  );
  return badgeEl;
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('pt-BR') : '—';
}
function fmtMoney(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}
