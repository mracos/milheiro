import { defineBackground, browser } from '#imports';

// Reflects per-tab state on the toolbar icon: grayscale (dormant, the manifest
// default) when there's nothing to do, color + a badge count when the content
// script annotated flights on that tab. Safari builds MV2 (browserAction), the
// rest MV3 (action), so pick whichever exists.
export default defineBackground(() => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const action = ((browser as any).action ?? (browser as any).browserAction) as {
    setIcon: (d: { tabId?: number; path: Record<number, string> }) => void;
    setBadgeText: (d: { tabId?: number; text: string }) => void;
    setBadgeBackgroundColor: (d: { tabId?: number; color: string }) => void;
  };

  const ACTIVE = {
    16: 'icon-active/16.png',
    32: 'icon-active/32.png',
    48: 'icon-active/48.png',
    128: 'icon-active/128.png',
  };
  const GRAY = { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' };

  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    const tabId = sender.tab?.id;
    const m = msg as { type?: string; count?: number };
    if (tabId == null || m?.type !== 'milheiro:active') return;

    const n = Number(m.count) || 0;
    if (n > 0) {
      action.setIcon({ tabId, path: ACTIVE });
      action.setBadgeText({ tabId, text: String(n) });
      action.setBadgeBackgroundColor({ tabId, color: '#12693a' });
    } else {
      action.setIcon({ tabId, path: GRAY });
      action.setBadgeText({ tabId, text: '' });
    }
  });
});
