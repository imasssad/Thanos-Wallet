import * as Clipboard from 'expo-clipboard';

/**
 * Copying a recovery phrase or private key (audit M-10): the clipboard is
 * wiped again after 60 s, so the secret doesn't linger for other apps and
 * clipboard-sync services. Reading the clipboard to check it still holds the
 * secret would pop the OS "pasted from" notice (iOS 14+, Android 12+), so
 * the wipe is skipped only when the app has copied a newer secret since.
 * A timer that falls due while the app is suspended fires when it resumes.
 */
export const SECRET_CLIPBOARD_CLEAR_MS = 60_000;

let generation = 0;

export async function copySecret(text: string, clearAfterMs = SECRET_CLIPBOARD_CLEAR_MS): Promise<void> {
  const mine = ++generation;
  await Clipboard.setStringAsync(text);
  setTimeout(() => {
    if (mine === generation) Clipboard.setStringAsync('').catch(() => { /* nothing to clear */ });
  }, clearAfterMs);
}
