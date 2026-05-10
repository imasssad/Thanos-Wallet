// Content script — site-injection point for future dApp connections (EIP-1193 provider).
// For v1 it does nothing; phishing detection moves server-side via the API.

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  main() {
    // Future: inject window.thanos provider, listen for dApp connect requests
  }
});
