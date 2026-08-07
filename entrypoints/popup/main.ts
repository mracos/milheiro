import { browser } from '#imports';
import { analyze, parseBRL, type AnalyzeResult, type MilesOption } from '@/utils/calc';

const DEFAULT_BASELINE = 25;

interface Stored {
  baseline?: string;
  lastCash?: string;
  lastOptionsText?: string;
  lastOffers?: Array<{ miles: number; cash: number }>;
}
function getStored(keys: (keyof Stored)[]): Promise<Stored> {
  return browser.storage.local.get(keys) as Promise<Stored>;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const baselineEl = $('baseline') as HTMLInputElement;
const cashEl = $('cash') as HTMLInputElement;
const optionsEl = $('options') as HTMLTextAreaElement;
const resultEl = $('result');

getStored(['baseline', 'lastCash', 'lastOptionsText']).then((v) => {
  baselineEl.value = v.baseline != null ? v.baseline : String(DEFAULT_BASELINE);
  if (v.lastCash) cashEl.value = v.lastCash;
  if (v.lastOptionsText) optionsEl.value = v.lastOptionsText;
  if (cashEl.value && optionsEl.value) calculate();
});

baselineEl.addEventListener('change', () => {
  void browser.storage.local.set({ baseline: baselineEl.value });
});

($('calc') as HTMLButtonElement).addEventListener('click', calculate);

($('pull') as HTMLButtonElement).addEventListener('click', async () => {
  const { lastOffers } = await getStored(['lastOffers']);
  if (!lastOffers || !lastOffers.length) {
    resultEl.innerHTML =
      '<p class="hint">Nada capturado ainda. Abra uma busca em milhas na LATAM.</p>';
    return;
  }
  optionsEl.value = lastOffers
    .map((o) => `${o.miles} + ${String(o.cash).replace('.', ',')}`)
    .join('\n');
  calculate();
});

function parseOptions(text: string): MilesOption[] {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): MilesOption => {
      const parts = line.split('+');
      return { miles: parts[0], cash: parts[1] != null ? parts[1] : 0 };
    });
}

function calculate(): void {
  const baseline = baselineEl.value || String(DEFAULT_BASELINE);
  const cashPrice = cashEl.value;
  const options = parseOptions(optionsEl.value);

  void browser.storage.local.set({
    baseline,
    lastCash: cashPrice,
    lastOptionsText: optionsEl.value,
  });

  if (!parseBRL(cashPrice) || !options.length) {
    resultEl.innerHTML = '<p class="hint">Preencha o preço em reais e ao menos uma opção.</p>';
    return;
  }

  render(analyze({ cashPrice, options, baseline }));
}

function render(r: AnalyzeResult): void {
  if (!r.best) {
    resultEl.innerHTML = '<p class="hint">Não consegui calcular. Confira os números.</p>';
    return;
  }
  const best = r.best;
  const useMiles = r.verdict === 'miles';
  const rows = r.rows
    .map((row, i) => {
      const isBest = row.index === best.index;
      return (
        `<tr class="${isBest ? 'best' : ''}">` +
        `<td>${i + 1}</td>` +
        `<td>${fmtInt(row.miles)}</td>` +
        `<td>R$ ${money(row.cash)}</td>` +
        `<td>R$ ${money(row.milheiro)}</td></tr>`
      );
    })
    .join('');

  const lastMarg = r.marginals[r.marginals.length - 1];
  const marg = lastMarg
    ? `<div class="marg">Marginal do último salto: ` +
      `<b>R$ ${money(lastMarg.milheiro)}/milheiro</b> ` +
      `(o bloco de milhas mais bem pago).</div>`
    : '';

  resultEl.innerHTML =
    `<div class="verdict ${useMiles ? 'miles' : 'cash'}">` +
    (useMiles ? `Usa milhas — opção ${best.index + 1}` : 'Paga em reais') +
    `</div>` +
    `<div class="vsub">melhor: <b>R$ ${money(best.milheiro)}/milheiro</b> ` +
    `vs baseline R$ ${money(r.baseline)}</div>` +
    `<table><thead><tr><th>#</th><th>milhas</th><th>+R$</th><th>R$/milheiro</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    marg;
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('pt-BR') : '—';
}
function money(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}
