// Phishing detection will be wired through the unified backend later.
// For v1, just log install/update events.

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.log('Thanos Wallet extension installed');
  });
});
