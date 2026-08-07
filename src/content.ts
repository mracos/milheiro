// Content script (isolated world). Injects the page-context interceptor,
// reads LATAM's miles offers straight off the captured payload (cash is already
// in there), and paints a verdict badge. No second request, no cash anchor.
import { readLatamOffers, summarizeLatam, type LatamSummary } from './calc.ts';

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

  let brands;
  try {
    brands = readLatamOffers(d.data);
  } catch {
    return;
  }
  if (!brands.length) return;

  console.log('[milheiro] read', brands.length, 'miles brands from', d.url);
  void renderBadge(brands);
});

async function renderBadge(brands: ReturnType<typeof readLatamOffers>): Promise<void> {
  let store: Record<string, unknown> = {};
  try {
    store = await api.storage.local.get(['baseline']);
  } catch {
    /* storage unavailable */
  }
  const baseline = store.baseline != null ? (store.baseline as string | number) : DEFAULT_BASELINE;
  paint(ensureBadge(), summarizeLatam(brands, baseline), baseline);
}

function paint(el: HTMLElement, s: LatamSummary, baseline: string | number): void {
  const body = el.querySelector('.mlh-body') as HTMLElement;
  if (!s.best) {
    body.innerHTML = '<p class="mlh-hint">Sem ofertas em milhas nesta busca.</p>';
    return;
  }
  const useMiles = s.verdict === 'miles';
  const rows = s.perFlight
    .slice(0, 6)
    .map(
      ({ best }) =>
        `<tr><td>${best.flightCode}</td>` +
        `<td>${fmtInt(best.miles)}</td>` +
        `<td>R$ ${fmtMoney(best.cashWithoutTax)}</td>` +
        `<td><b>${fmtMoney(best.milheiro)}</b></td></tr>`,
    )
    .join('');
  const more = s.perFlight.length > 6 ? `<div class="mlh-sub">+${s.perFlight.length - 6} voos</div>` : '';

  body.innerHTML =
    `<div class="mlh-verdict ${useMiles ? 'mlh-miles' : 'mlh-cash'}">` +
    (useMiles ? 'Usa milhas' : 'Paga em reais') +
    `</div>` +
    `<div class="mlh-sub">melhor <b>R$ ${fmtMoney(s.best.milheiro)}/milheiro</b> ` +
    `vs baseline R$ ${fmtMoney(baseline)}</div>` +
    `<table class="mlh-table"><thead><tr>` +
    `<th>voo</th><th>milhas</th><th>R$</th><th>/milheiro</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    more;
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
function fmtMoney(n: number | string): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n));
  return Number.isFinite(v)
    ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}
