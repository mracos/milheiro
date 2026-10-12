# [ADR milheiro - 0001]: Courtesy upgrade autopilot

> Date: 2026/10/11
>
> Authors: `Marcos Ferreira`
>
> Status: Proposed. Phase 0 (anti-bot spike) done, results below. Sunsets in
> April 2027, when LATAM ships automatic postulation itself.

## Context

As a Platinum LATAM Pass member I hold courtesy segments (8 inside South
America, 2 outside) that buy a cabin upgrade, and I almost never use them
because the request has to be made by hand on every flight:

- Window opens 48h before departure, closes 2h before.
- Check-in must be done first, so the 48h mark is two steps: check in, then
  request.
- Priority today is tier, then co-branded card, then request time. Among
  Platinums without the card, whoever asks first wins.

The LATAM Pass email of 2026-10-02 ("Novo Processo de Upgrade com Trechos de
Cortesia") announces that from April 2027 postulation becomes automatic and
request time stops counting. This tool covers the gap until then, roughly
10-20 legs at my current 2-4 legs a month.

`bill-fetch` tried the "log into a portal on a schedule" shape and stalled on
captchas (gov.br hCaptcha). LATAM sits behind Akamai, so the first question was
whether any automated browser gets through at all.

---

## Phase 0: what gets past LATAM's Akamai (done)

Headless only, logged out, from my home connection, 2026-10-11. Pages:
`/br/pt`, `/br/pt/minhas-viagens`, `/br/pt/check-in`.

| Browser | Result |
|---|---|
| Playwright, bundled headless shell | 403 `Access Denied` on all three |
| Playwright, `channel: 'chrome'` | 403 `Access Denied` on all three |
| playwright-extra + stealth, headless shell | 200, login UI rendered, `/bff/*` JSON calls fire |
| playwright-extra + stealth, `channel: 'chrome'` | 200, same |
| lightpanda | 200, page text rendered |
| browser-use's own headless Chromium | no title, 0 interactive elements: treated as blocked |

Two things this changes against what we knew:

- The CI drift check (03c3aee) needed **headed** stealth under xvfb. From a
  residential IP, headless stealth is enough. The difference is probably IP
  reputation (GitHub runners are datacenter IPs), not headless detection.
- The site's data comes from `/bff/...` JSON endpoints, the same family the
  offers hook in `entrypoints/inject.ts` already reads. Replaying those calls is
  a viable deterministic base once we know them.

Agentic tools (browser-use, workflow-use, Skyvern OSS) drive a stock Chromium
over CDP, so they inherit the 403 unless we hand them a stealthed browser. The
agent layer does not solve access. It only helps decide clicks.

> [!NOTE]
> Logged out is the easy half. The real unknowns are the login (LATAM emails a
> verification code on new logins, see the "Código de verificação" mails) and
> whether Akamai scores authenticated `/bff/` calls harder.

---

## Decision

A scheduled, headless, deterministic runner in this repo, with the agent only
as an offline repair step.

```
launchd (hourly)
  -> upgrade run
       legs in [T-48h, T-2h] not yet done
         -> session ok? else login (1Password creds + email code from Mail)
         -> check in (if not)
         -> request upgrade (if policy allows the leg)
         -> record state, notify result
       on failure -> save trace + DOM snapshot, notify with deep link
```

- **Runtime**: playwright-extra + stealth, headless, persistent context
  (`storageState`) so login is rare. Already a devDependency here.
- **Why here and not an extension background job**: Phase 0 shows headless
  works, so nothing needs Safari open and awake at T-48h, and no tab ever
  appears. The extension stays what it is.
- **Why here and not bill-fetch**: the LATAM knowledge (Akamai workaround,
  `/bff/` shapes, drift check) already lives in this repo. Borrow bill-fetch's
  patterns (`op` creds, `launcher`, notify), not its code.
- **Login 2FA**: the verification code arrives by email. `notes`' mail libs read
  Mail.app's local store, so the code can be fetched without IMAP or a browser.
- **Legs**: from LATAM's own trip list after login (one source of truth), with
  `notes trips` parked legs as a cross-check.
- **Segment policy**: only 2 out-of-region segments a year, so international
  legs are opt-in per flight number. Default allow list: `LA8113` (the MEX ->
  GRU red-eye). All South America legs are allowed.
- **Agentic repair, not agentic runtime**: when a step fails, a manual
  `upgrade repair <trace>` hands the trace and DOM to `claude -p` with the
  headless playwright MCP to propose a patch to the deterministic step. Nothing
  improvises against the live account unattended.

## Phases

| Phase | What | Needs me |
|---|---|---|
| 0 | Anti-bot spike | done |
| 1 | Authenticated capture: log in headless, record the `/bff/` calls for trip list, check-in, upgrade | approve a login on my account (triggers a "Novo login" mail), and either a live flight in window or a manual check-in + upgrade with capture on |
| 2 | Deterministic `upgrade run` + state + notify, behind `--dry-run` first | first live run on a real leg |
| 3 | `launcher` schedule | none |
| 4 | `upgrade repair` | none |

## Consequences

- Throwaway by design: delete in April 2027 once LATAM's automatic postulation
  is confirmed working on my account.
- International check-in may ask for passport/APIS data. If it does, the run
  fails loudly and notifies; it never invents document data.
- Akamai can change scoring at any time. The weekly drift check already watches
  the logged-out side; the runner's own failure notifications cover the rest.
