/**
 * Recents + Favorites for the in-app browser's Discover home (mobile).
 *
 * Recents auto-tracks the dApps the user actually opens from Discover (the
 * search bar's "Open link" and any ecosystem app tap) — NOT every openBrowser
 * call in the app (explorer tx links, Settings' privacy/terms, the LAX/Play
 * Store hand-offs), since those aren't "dApps" and would just be noise here.
 * Favorites is a plain user-toggled star, independent of visit history.
 *
 * AsyncStorage-backed, same load()-primes-a-sync-cache pattern as
 * custom-assets.ts / dapp-connections.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const RECENTS_KEY   = 'thanos.browser_recents.v1';
const FAVORITES_KEY = 'thanos.browser_favorites.v1';
const MAX_RECENTS = 12;

export interface VisitedApp {
  /** Matches an EcosystemApp.id when the visit came from the directory —
   *  used to look up its bundled icon. A typed/unknown URL gets its
   *  hostname as id, which just falls through to the initial-letter
   *  fallback in DappIcon. */
  id:    string;
  name:  string;
  url:   string;
  color: string;
  at:    number;
}

let recents:   VisitedApp[] = [];
let favorites: VisitedApp[] = [];
let loaded = false;

export async function loadBrowserHistory(): Promise<void> {
  try {
    const [r, f] = await Promise.all([
      AsyncStorage.getItem(RECENTS_KEY),
      AsyncStorage.getItem(FAVORITES_KEY),
    ]);
    recents   = r ? (JSON.parse(r) as VisitedApp[]) : [];
    favorites = f ? (JSON.parse(f) as VisitedApp[]) : [];
  } catch {
    recents = []; favorites = [];
  }
  loaded = true;
}

export const browserHistoryLoaded = (): boolean => loaded;
export const getRecents   = (): readonly VisitedApp[] => recents;
export const getFavorites = (): readonly VisitedApp[] => favorites;
export const isFavorited  = (url: string): boolean => favorites.some((f) => f.url === url);

function persistRecents(): void {
  void AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(recents)).catch(() => {});
}
function persistFavorites(): void {
  void AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)).catch(() => {});
}

/** Record (or bump-to-front) a visit. Call right before opening the URL. */
export function recordVisit(entry: Omit<VisitedApp, 'at'>): void {
  recents = [{ ...entry, at: Date.now() }, ...recents.filter((r) => r.url !== entry.url)].slice(0, MAX_RECENTS);
  persistRecents();
}

/** Toggle a favorite on/off. Returns the new state (true = now favorited). */
export function toggleFavorite(entry: Omit<VisitedApp, 'at'>): boolean {
  if (isFavorited(entry.url)) {
    favorites = favorites.filter((f) => f.url !== entry.url);
    persistFavorites();
    return false;
  }
  favorites = [{ ...entry, at: Date.now() }, ...favorites];
  persistFavorites();
  return true;
}
