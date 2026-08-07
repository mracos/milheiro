// Runs in the PAGE context (not the isolated content-script world) so it can
// see LATAM's own fetch/XHR responses. It monkeypatches both, and forwards any
// JSON payload that looks fare-related to the content script via postMessage.
// It never blocks or mutates the responses.
(function () {
  'use strict';

  const URL_RE = /(offer|fare|search|availab|redempt|pricing|shopping|itiner|flight)/i;

  function forward(url: string, text: string): void {
    if (!text) return;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return; // not JSON, ignore
    }
    window.postMessage({ source: 'milheiro', kind: 'payload', url: String(url || ''), data }, '*');
  }

  // fetch
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>): Promise<Response> {
      return origFetch.apply(this as never, args).then((res) => {
        try {
          const first = args[0] as unknown;
          const url =
            res?.url ||
            (typeof first === 'string' ? first : (first as { url?: string })?.url) ||
            '';
          if (URL_RE.test(url)) {
            res
              .clone()
              .text()
              .then((t) => forward(url, t))
              .catch(() => {});
          }
        } catch (_) {}
        return res;
      });
    };
  }

  // XMLHttpRequest
  type TaggedXHR = XMLHttpRequest & { __milheiroUrl?: string };
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    this: TaggedXHR,
    ...args: Parameters<XMLHttpRequest['open']>
  ) {
    this.__milheiroUrl = String(args[1]);
    return origOpen.apply(this, args);
  } as XMLHttpRequest['open'];
  XMLHttpRequest.prototype.send = function (
    this: TaggedXHR,
    ...args: Parameters<XMLHttpRequest['send']>
  ) {
    this.addEventListener('load', () => {
      try {
        const url = this.__milheiroUrl || '';
        if (URL_RE.test(url)) forward(url, this.responseText);
      } catch (_) {}
    });
    return origSend.apply(this, args);
  };
})();
