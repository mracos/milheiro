# milheiro

Milhas ou reais? Extensão de browser que, na LATAM, anota cada voo e cada tarifa
com o **R$/milheiro** e o veredito contra o **seu baseline** — direto na interface
deles, no modo milhas (onde a LATAM esconde o preço em dinheiro).

## A ideia

Pagar em milhas é trocar milhas pela tarifa em dinheiro. O valor de cada milha:

```
R$/milheiro = tarifa em reais / milhas × 1000
```

- **Maior R$/milheiro = melhor uso das milhas.** Verde se acima do seu baseline,
  vermelho abaixo.
- O **baseline** é o único número de julgamento (quanto uma milha vale pra você):
  casual ~R$20, acumulador mirando executiva ~R$45.
- **Doméstico LATAM é fixo (~R$28,8/milheiro)**: eles definem as milhas como
  `tarifa / 0,0288`, então a razão não varia. O chip lidera com o **valor em R$**
  (que varia por voo) e deixa a taxa como subscrito. A variação de verdade (e a
  cor mudando) aparece em internacional/executiva/promo.

## Como funciona

- **Chips inline (automático):** na latamairlines.com, um interceptor captura o
  JSON de tarifas (`/bff/air-offers/v2/offers/search`). O payload de milhas já
  traz a tarifa em reais (`priceWithOutTax`) ao lado das milhas, então não precisa
  de segunda request. O content script casa cada oferta com o card/tarifa da LATAM
  por `data-testid` (`flight-info-i-amount`, `flight-i-price-BRAND`) e injeta o chip.
- **Popup (manual):** clica no ícone, cola preço + opções de milhas (ex: o slider
  milhas+dinheiro), recebe o veredito com análise marginal. Config do baseline aqui.

## Stack

TypeScript + [WXT](https://wxt.dev). `entrypoints/` são os scripts; `utils/calc.ts`
é o núcleo puro (testado). O Safari é gerado por config-as-code via
`wxt-module-safari-xcode` (time/bundle id em `wxt.config.ts`).

```sh
npm install          # roda `wxt prepare` (gera tipos) no postinstall
npm run dev          # dev server (Chrome) com HMR
npm run build        # bundla pra .output/chrome-mv3
npm run typecheck    # wxt prepare && tsc --noEmit
npm run lint         # eslint
npm test             # node --test (núcleo, roda .ts direto)
npm run test:integration  # Playwright: drift da API/DOM da LATAM (nightly no CI)
```

## Instalar

### Chrome / Edge / Brave

`npm run build` → `chrome://extensions` → Developer mode → **Load unpacked** →
`.output/chrome-mv3`. (Ou `npm run dev`, que abre o browser sozinho.)

### Firefox

`npm run build:firefox` → `about:debugging` → **Load Temporary Add-on** →
`.output/firefox-mv2/manifest.json`.

### Safari (macOS)

```sh
npm run build:safari
```

O módulo roda o `safari-web-extension-converter` e configura o projeto Xcode
(time `693Z55YX47`, bundle `com.mracos.Milheiro`) em `.output/Milheiro/`. Abre no
Xcode, roda (⌘R), e ativa em Safari → Ajustes → Extensões.

## Testes

Núcleo (`parseBRL`, `analyze`, `readLatamOffers`, `summarizeLatam`, `chipFor`) em
`test/calc.test.ts`, contra um fixture real (`test/fixtures/`). O
`test/integration/latam.test.ts` (Playwright, nightly no GitHub Actions) detecta
quando a LATAM muda o schema da API ou os `data-testid` que o content script usa.
