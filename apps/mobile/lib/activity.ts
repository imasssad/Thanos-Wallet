/**
 * Last user touch, for the foreground auto-lock (App.tsx). The app root's
 * onTouchStart and every Modal (components/ActivityModal.tsx — a Modal is its
 * own native root, so the app root never sees touches inside one) call
 * markUserActivity(); the lock check compares idleMs() with the timeout.
 */
let last = Date.now();

export function markUserActivity(): void {
  last = Date.now();
}

export function idleMs(now: number = Date.now()): number {
  return now - last;
}
