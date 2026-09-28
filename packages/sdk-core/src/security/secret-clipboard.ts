/**
 * Copying a recovery phrase or private key (audit M-10): the clipboard is
 * wiped again after 60 s, so the secret doesn't sit there for every other
 * app — and clipboard-history / sync services — to read.
 *
 * A browser page can't read the clipboard without a permission prompt, so
 * the wipe can't check that the clipboard still holds the secret. It is
 * skipped when this helper has copied something newer since; and because
 * browsers only let a focused page write, a wipe that fails while the user
 * is in another window is retried when the page is focused again.
 * (The desktop app wipes from its main process instead, where it can compare.)
 */
export const SECRET_CLIPBOARD_CLEAR_MS = 60_000;

let generation = 0;

/** Write text to the clipboard: the Clipboard API, or on a plain-http page
 *  the legacy copy command (a copy event we fill ourselves, which also
 *  works for the empty string). */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText
      && (typeof window === 'undefined' || window.isSecureContext !== false)) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  }
  if (typeof document === 'undefined') return false;
  const onCopy = (e: ClipboardEvent) => { e.clipboardData?.setData('text/plain', text); e.preventDefault(); };
  document.addEventListener('copy', onCopy);
  try { return document.execCommand('copy'); } catch { return false; } finally { document.removeEventListener('copy', onCopy); }
}

/** Copy a secret and schedule the wipe. Resolves false if it couldn't copy. */
export async function copySecretToClipboard(
  text: string,
  opts: { write?: (text: string) => Promise<boolean>; clearAfterMs?: number } = {},
): Promise<boolean> {
  const write = opts.write ?? writeClipboardText;
  const mine = ++generation;
  if (!(await write(text))) return false;
  const wipe = async (): Promise<boolean> => mine !== generation || write('');
  setTimeout(() => {
    void wipe().then((done) => {
      if (done || typeof window === 'undefined') return;
      const retry = () => { window.removeEventListener('focus', retry); void wipe(); };
      window.addEventListener('focus', retry);
    });
  }, opts.clearAfterMs ?? SECRET_CLIPBOARD_CLEAR_MS);
  return true;
}
