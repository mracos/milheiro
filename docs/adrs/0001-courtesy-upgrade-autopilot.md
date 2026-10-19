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

### Logged out (2026-10-11, home connection)

Pages: `/br/pt`, `/br/pt/minhas-viagens`, `/br/pt/check-in`.

| Browser | Result |
|---|---|
| Playwright, bundled headless shell | 403 `Access Denied` on all three |
| Playwright, `channel: 'chrome'` | 403 `Access Denied` on all three |
| playwright-extra + stealth, headless shell or `channel: 'chrome'` | 200, login UI rendered, `/bff/*` JSON calls fire |
| playwright-extra + stealth, `launchPersistentContext` | 403 `Access Denied` |
| lightpanda | 200, page text rendered |
| browser-use's own headless Chromium | no title, 0 interactive elements: treated as blocked |

### Logged in (2026-10-12 headless, 2026-10-19 headed)

Login itself is fully automatable with stealth, headless or headed:

```
/u/login/identifier   #form-input--alias--text-field, #primary-button
/u/login/password     #form-input--password--password-input
/u/mfa-login-options  click "Email" (the other option is WhatsApp)
/u/mfa-email-challenge  #form-input--code-0..5--text-field, code read from Mail.app
```

Session is cookie-based (no `Authorization` header; the app sends
`x-latam-*` headers). After login, the trips call is blocked at the edge:

| Browser | `GET /bff/mytrips/v1/compound-search/user` |
|---|---|
| stealth, headless | 403, `server=AkamaiGHost`, empty HTML body |
| stealth, headless + synthetic mouse/scroll/keys | 403 |
| stealth, headed real Chrome | 403 |

What this says:

- Akamai scores authenticated `/bff/` calls harder than public pages. Passing
  the page wall is not passing the API.
- Headed vs headless makes no difference. The tell is the automation itself
  (CDP-driven browser, sensor data), not window visibility.
- The CI drift check (03c3aee) needed headed stealth from a datacenter IP; from
  a residential IP headless passes the public pages. IP reputation matters for
  the page wall, not for the API block.
- Agentic tools (browser-use, workflow-use, Skyvern OSS) drive a CDP Chromium
  too, so they land on the same 403. The agent layer decides clicks; it does
  not get access.

---

## Decision

Run the autopilot inside my real browser, as part of this extension. Requests
then come from a browser no automation framework is attached to, with LATAM's
own scripts generating the sensor data, which is the one setup that never got
a 403.

```
notes trips (launchd, hourly)
  leg enters [T-48h, T-2h], not done, allowed by policy
    -> open -g -a Safari "https://www.latamairlines.com/br/pt/minhas-viagens#milheiro-upgrade=<PNR>"
         (-g: opens in the background, no focus steal)

milheiro content script on that URL
  -> logged in? else notify "log into LATAM" and stop
  -> check in (if not), request upgrade with segments
  -> report result to background -> notification
  -> close the tab
on any unexpected screen
  -> screenshot-free failure note (step name + URL + visible text), notify with deep link
```

- **Scheduling lives outside the extension.** `notes trips` already parses
  legs (flight number, PNR, departure with timezone) from Mail. It owns the
  window math and the "done" ledger; the extension only acts when opened with
  the hash. No reliance on Safari keeping an extension background page alive.
- **Steps drive the UI, not the API.** The page's app builds the `x-latam-*`
  headers and the Akamai sensor; clicking through it inherits both. LATAM's
  markup carries stable `data-testid` and `id` attributes (seen on every page
  in Phase 0), so selectors stay deterministic.
- **Login is mine, not the tool's.** The real browser keeps its LATAM session.
  When it expires the run stops and notifies; no credentials in the extension.
- **Segment policy**: only 2 out-of-region segments a year, so international
  legs are opt-in per flight number. Default allow list: `LA8113` (the MEX ->
  GRU red-eye). All South America legs are allowed. Policy lives in
  `notes trips` config, next to the leg data.
- **Agentic repair, not agentic runtime**: when a step fails, the failure note
  is enough for `claude -p` to propose a selector patch offline. Nothing
  improvises against the live account.

## Phases

| Phase | What | Needs me |
|---|---|---|
| 0 | Anti-bot spike, logged out and logged in | done |
| 1 | Map the check-in and upgrade screens: run them by hand with the extension in "record" mode (logs each step's URL, `data-testid`s, and `/bff/` calls) | next flight inside the 48h window |
| 2 | `#milheiro-upgrade=<PNR>` flow in the content script, `--dry-run` style flag that stops before the final submit | first live run on a real leg |
| 3 | `notes trips` side: window check, policy, `open -g`, ledger | none |
| 4 | Offline repair loop | none |

## Consequences

- Throwaway by design: delete in April 2027 once LATAM's automatic postulation
  is confirmed working on my account.
- Needs the Mac awake and Safari runnable at T-48h. A leg that falls in a
  sleep window gets caught on the next hourly tick, while the window is still
  open (it spans 46 hours).
- International check-in may ask for passport/APIS data. If it does, the run
  stops and notifies; it never invents document data.
- Akamai can change scoring at any time. Since the requests come from my own
  browser session, a block here would also block me using the site by hand.
