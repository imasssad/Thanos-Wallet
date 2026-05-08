import { inspectWebsite } from '@thanos/sdk-core';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.log('Thanos Wallet extension installed');
  });

  browser.tabs.onUpdated.addListener(async (_tabId, _changeInfo, tab) => {
    if (!tab.url) return;
    try {
      const hostname = new URL(tab.url).hostname;
      const report = inspectWebsite(hostname);
      if (report.verdict === 'block') {
        console.warn('Potential phishing site detected', report);
      }
    } catch {
      // ignore parsing failures
    }
  });
});
