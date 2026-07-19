'use client';
/**
 * Subscribe a component to display-currency changes.
 *
 * Why this exists rather than a single tick in AppShell: AppShell receives the
 * page as `{children}` — an element created by the Next layout. When AppShell's
 * own state changes, React re-renders AppShell but sees the SAME children
 * element reference, so it skips that entire subtree. A currency change would
 * update the stored preference while every on-screen price stayed stale.
 *
 * Components that render fiat call this so they re-render themselves. Values
 * are held in USD and converted at format time, so a re-render is all that's
 * needed for prices to pick up the new rate.
 */
import { useSyncExternalStore } from 'react';
import { subscribeFx, getDisplayCurrency, type DisplayCurrency } from '@thanos/sdk-core';

const serverSnapshot = (): DisplayCurrency => 'USD';

export function useDisplayCurrency(): DisplayCurrency {
  return useSyncExternalStore(subscribeFx, getDisplayCurrency, serverSnapshot);
}
