/**
 * Who may drive the wallet over runtime messaging.
 *
 * runtime.sendMessage from a content script is delivered to EVERY extension
 * context's onMessage — background, popup, side panel and the offscreen
 * signer/WalletConnect host alike. A content script runs inside the web
 * page's renderer process, so Chrome's extension model treats it as less
 * trusted than extension pages: a compromised renderer can send any message
 * a content script could. So anything that approves, signs, switches chains
 * or drives WalletConnect must come from an extension page (popup / side
 * panel / expanded tab / offscreen document / the service worker). The only
 * page-originated message is `thanos-rpc`, and its origin is taken from the
 * browser-reported sender, never from the message body.
 */
export interface MessageSenderLike {
  id?:  string;
  url?: string;
  tab?: { id?: number };
}

/** True iff the message came from one of this extension's own pages. */
export function isExtensionSender(sender: MessageSenderLike | null | undefined): boolean {
  if (!sender || sender.id !== browser.runtime.id) return false;
  // Extension pages carry their own chrome-extension:// (moz-extension://,
  // safari-web-extension://) URL — an expanded popup in a tab too. A sender
  // without a URL is trusted only when no tab is attached (the service
  // worker); content scripts always have both a tab and the page's URL.
  if (sender.url) return sender.url.startsWith(browser.runtime.getURL('/'));
  return !sender.tab;
}

/** The web origin of a content-script sender, or null for anything else. */
export function contentScriptOrigin(sender: MessageSenderLike | null | undefined): string | null {
  if (!sender?.tab || !sender.url || sender.id !== browser.runtime.id) return null;
  try {
    const u = new URL(sender.url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}
