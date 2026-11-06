/**
 * Persisted dApp connection grants for the in-app browser (mobile).
 *
 * Without this, InAppBrowser's `connected`/`connectedOrigin` state is plain
 * component state — reset every time the browser tab is closed and
 * reopened, so a previously-approved dApp had to be re-approved from
 * scratch on every single visit. This persists the grant per ORIGIN
 * (scheme + host + port — THN-R1 THN-07: keying on host alone let
 * https://good.example and a same-host http:// page, or a different port,
 * share one grant) so a dApp the user already connected to auto-reconnects
 * silently next time, matching MetaMask/Trust Wallet's actual behaviour
 * (approval is asked once per site, not once per session).
 *
 * SAFETY: a grant is only honoured if its stored address still matches the
 * wallet's CURRENTLY active account — if the user switched accounts since
 * granting, the dApp must re-prompt rather than silently connect the new
 * account without consent.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'thanos.dapp_connections.v1';

export interface DappConnection {
  origin:      string;
  address:     string;
  chainId:     number;
  connectedAt: number;
}

let cache: Record<string, DappConnection> = {};
let loaded = false;

/** Prime the cache from storage. Call once at app startup. */
export async function loadDappConnections(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Record<string, DappConnection>) : {};
  } catch {
    cache = {};
  }
  loaded = true;
}

export const dappConnectionsLoaded = (): boolean => loaded;

/** The grant for this origin, if any, and only if it still matches `address`. */
export function getGrant(origin: string, address: string): DappConnection | null {
  const g = cache[origin];
  return g && address && g.address.toLowerCase() === address.toLowerCase() ? g : null;
}

export const listConnections = (): readonly DappConnection[] =>
  Object.values(cache).sort((a, b) => b.connectedAt - a.connectedAt);

function persist(): void {
  void AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export function grantConnection(origin: string, address: string, chainId: number): void {
  if (!origin || !address) return;
  cache[origin] = { origin, address, chainId, connectedAt: Date.now() };
  persist();
}

export function revokeConnection(origin: string): void {
  delete cache[origin];
  persist();
}

export function revokeAllConnections(): void {
  cache = {};
  persist();
}
