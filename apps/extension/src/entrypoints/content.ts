import { inspectWebsite } from '@thanos/sdk-core';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    const report = inspectWebsite(window.location.hostname);
    if (report.verdict === 'block') {
      const banner = document.createElement('div');
      banner.textContent = 'Thanos Wallet warning: high-risk site detected.';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:12px;background:#991b1b;color:white;font-weight:700;text-align:center';
      document.documentElement.appendChild(banner);
    }
  }
});
