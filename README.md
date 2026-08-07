# milheiro

Milhas ou reais? Extensão de browser que diz se vale mais comprar a passagem em
milhas ou em dinheiro, comparando o **R$/milheiro** (valor por 1.000 milhas) de
cada opção contra o **seu baseline**.

## A ideia

Quando você paga milhas + dinheiro em vez de tudo em reais, você está gastando
milhas pra economizar reais. O que cada milha economiza é o valor dela:

```
R$/milheiro = (preço em reais − dinheiro da opção) / milhas × 1000
```

- **Maior R$/milheiro = melhor uso das milhas.**
- Compara contra o seu **baseline** (quanto uma milha vale pra você):
  - Casual, não mira executiva internacional → baseline ~R$20. Quase tudo vira "usa milhas".
  - Acumulador mirando executiva (onde a milha rende R$50–90/milheiro) → baseline ~R$45. Só resgates muito bons passam.
- **Marginal:** o último bloco de milhas que você adiciona costuma ser o mais
  bem pago. A extensão mostra o marginal do último salto.

Exemplo (passagem R$ 2.484,00):

| Opção | Milhas | +R$      | R$/milheiro        |
| ----- | ------ | -------- | ------------------ |
| 1     | 70.655 | 90,20    | **33,88** ← melhor |
| 2     | 63.590 | 457,58   | 31,87              |
| 3     | 49.459 | 1.001,63 | 29,97              |
| 4     | 35.328 | 1.467,95 | 28,76              |

## Como funciona

Fluxo típico: você vê o preço em reais no Google Flights, depois abre a LATAM em
milhas. A extensão tem dois caminhos (híbrido):

1. **Auto** — na latamairlines.com, um interceptor captura o JSON de tarifas e
   tenta extrair as opções de milhas sozinho, mostrando um badge flutuante. Se
   faltar o preço em reais, ele pede. Best-effort: o parser (`extractOffers` em
   `src/calc.js`) precisa ser afinado contra o payload real da LATAM (veja abaixo).
2. **Manual (popup)** — clica no ícone, cola o preço em reais e as opções de
   milhas, recebe o veredito. Sempre funciona, nunca quebra.

## Stack

TypeScript. `src/*.ts` é bundlado por esbuild pra `dist/*.js` (plain JS que o
browser carrega). `calc.ts` é a lib compartilhada, inlinada em content/popup.

```sh
npm install
npm run build      # bundla src/ -> dist/
npm run dev        # build em watch
npm run typecheck  # tsc --noEmit
npm test           # node --test (roda .ts direto via type stripping)
```

**A extensão carrega da pasta `dist/`, não da raiz.** Rode `npm run build` antes.

## Instalar

### Chrome / Edge / Brave

1. `npm run build`
2. `chrome://extensions` → ativa **Developer mode**
3. **Load unpacked** → seleciona a pasta **`dist/`**

### Firefox

1. `npm run build`
2. `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on** → seleciona **`dist/manifest.json`**

### Safari (macOS)

Um comando converte a WebExtension num app Safari (aponta pra `dist/`):

```sh
npm run build
xcrun safari-web-extension-converter dist/
```

Abre o projeto Xcode gerado, roda (⌘R), e ativa em Safari → Ajustes → Extensões.

## Configurar o baseline

No popup, campo **baseline (R$/milheiro)**. Salvo automaticamente. Esse é o único
número de julgamento: o mesmo cálculo dá vereditos opostos dependendo do seu perfil.

## Testes

```sh
npm test
```

O núcleo (`parseBRL`, `analyze`, `extractOffers`) é testado em `test/calc.test.ts`.

## Afinar a auto-detecção

`extractOffers` é heurístico porque o schema da API da LATAM não está documentado
aqui. Pra melhorar:

1. Abra uma busca em milhas na LATAM com o DevTools console aberto.
2. Procure logs `[milheiro] captured offers` — cada um traz o payload cru.
3. Ajuste as regexes / campos em `extractOffers` (`src/calc.ts`) pro shape real.
4. Rode `npm test` e adicione um fixture do payload real no teste.
