import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import 'react-native-get-random-values'; // polyfills global crypto.getRandomValues — required by vault.ts
import {
  Alert, Animated, AppState, Easing, Image, Linking, Modal, Platform, Pressable, RefreshControl, SafeAreaView,
  ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';

/** Cross-platform monospace family. 'Menlo' exists only on iOS (Android
 *  silently falls back to proportional Roboto) and the generic
 *  'monospace' alias exists only on Android (iOS falls back to San
 *  Francisco) — so every address/seed rendered with either literal was
 *  non-monospace on the other platform. Use this constant everywhere. */
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

/** Address with highlighted head + tail — the visual-confirmation pattern
 *  every major wallet uses (client request 2026-06-12). Address-poisoning
 *  scams rely on matching the start/end of an address, so those are the
 *  exact characters to draw the eye to. `head`/`tail` count ADDRESS-
 *  SPECIFIC chars; the constant prefix (0x/litho1/cosmos1/bc1) is always
 *  shown but never eats the budget. Inherits font size from `style`.
 *  NOTE: the middle uses color (not opacity) — nested-<Text> opacity is
 *  ignored on Android's old arch, color always applies. */
function hiPrefixLen(v: string): number {
  if (v.startsWith('0x') || v.startsWith('0X')) return 2;
  if (v.startsWith('litho1'))  return 6;
  if (v.startsWith('cosmos1')) return 7;
  if (v.startsWith('bc1'))     return 3;
  return 0;
}
function HiAddr({ value, head = 6, tail = 6, full = false, style }: {
  value: string; head?: number; tail?: number; full?: boolean;
  style?: import('react-native').StyleProp<import('react-native').TextStyle>;
}) {
  const v = (value || '').trim();
  if (!v) return null;
  const headEnd = hiPrefixLen(v) + head;
  if (v.length <= headEnd + tail) return <Text style={[{ fontFamily: MONO }, style]}>{v}</Text>;
  const h = v.slice(0, headEnd), t = v.slice(-tail);
  const mid = full ? v.slice(headEnd, v.length - tail) : '…';
  return (
    <Text style={[{ fontFamily: MONO }, style]}>
      <Text style={{ color: '#10b981', fontWeight: '600' }}>{h}</Text>
      <Text style={{ color: '#6b7280' }}>{mid}</Text>
      <Text style={{ color: '#10b981', fontWeight: '600' }}>{t}</Text>
    </Text>
  );
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Wallet, HDNodeWallet, Mnemonic, formatUnits, randomBytes } from 'ethers';
import {
  createVault, openVault, openVaultWithKey,
  loadVault, clearVault as clearVaultStore, hasVault as vaultExists,
  cacheSessionKey, getSessionKey, clearSessionKey,
  hasLegacyPlaintext, migrateLegacyPlaintext,
  isSeedBackedUp, setSeedBackedUp,
} from './lib/vault';
import {
  getBiometricCapability, biometricLabel,
  isBiometricUnlockEnabled, enableBiometricUnlock, disableBiometricUnlock,
  readProtectedKey,
  type BiometricKind,
} from './lib/biometric';
import { makeAddressQrSvg, parseScannedAddress } from './lib/qr';
import { useScreenProtect } from './lib/screen-protect';
import { initSentry } from './lib/sentry';
import {
  loadAccountsFromStorage,
  getActiveAccountIndex, setActiveAccountIndex,
  getAccountCount,       setAccountCount,
  MAX_ACCOUNTS,
} from './lib/accounts';
import {
  loadContactsFromStorage, loadContacts, addContact, deleteContact,
  syncContactsFromServer, onContactsChanged,
  type Contact as AbContact,
} from './lib/address-book';
import { setContactEncryptionKey } from './lib/contact-crypto';
import {
  fetchMakaluAllowances, revokeAllowance, MAKALU_KNOWN_TOKENS,
  type AllowanceRow,
} from './lib/allowances';
import {
  getActiveSessions, disconnectSession as wcDisconnect,
} from './lib/walletconnect';

// Initialise Sentry as the very first work the bundle does — no-op
// when EXPO_PUBLIC_SENTRY_DSN is not set (local dev + EAS preview).
initSentry();
import { QrScannerModal } from './components/QrScannerModal';
import { WalletConnectModal, WalletConnectRequestHost } from './components/WalletConnect';
import { tokenIconSource } from './lib/token-icons';
import { getPortfolio, getActivity, type IndexerActivityItem } from './lib/indexer';
import { fetchEcosystemPrices, fetchMarketQuotes, type MarketQuote } from './lib/pricing';
import { resolveRecipient, evmToLitho } from './lib/address';
import { checkDnnsAvailability, registerDnnsName, reverseLookupDnns, type Availability } from './lib/dnns';
import { apiClient, type AuthUser } from './lib/auth-client';
import { sendAsset, executeWcRequest, summariseRequest, WcSignerError, rpcProxy, setRpcOverride } from './lib/wc-signer';
import { INJECTED_PROVIDER_JS, resolveJs, rejectJs, APPROVAL_METHODS } from './lib/dapp-provider';
import { SvgXml } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowUpRight, ArrowDownLeft, Repeat, Plus,
  Home, Clock, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  Fingerprint, Zap, Globe, Server, Key, AlertTriangle, Moon, Sun, Shield,
  Copy, Share2, Eye, EyeOff, ScanFace, ScanLine, Search, Compass,
  Users, Trash2, TrendingUp, Image as ImageIcon, BadgeCheck,
} from 'lucide-react-native';
import { ECOSYSTEM_APPS, ECOSYSTEM_HUB, type EcosystemApp, groupBySection, looksLikeUrl, normalizeUrl } from './lib/ecosystem';
import { discoverAppIcon } from './lib/token-icons';
import {
  fetchPortfolioHistory, type Holding, type PortfolioHistory, type Range,
  fetchTokenHistory, fetchTokenMarketDetails,
  type TokenHistory, type TokenMarketDetails, type TokenRange,
} from './lib/price-history';
import { isNotificationsEnabled, setNotificationsEnabled, registerPush, unregisterPush, notifyLocal } from './lib/notifications';

/* ─────────────────────────── Theme ─────────────────────────── */

// Canonical Thanos palette — same hex values as web/desktop/extension
const DARK = {
  bgBase:        '#080809',
  bgSurface:     '#0e0e12',
  bgElevated:    '#1c1c22',
  bgCard:        '#141418',
  bgHover:       '#232329',
  borderSubtle:  '#1c1c24',
  borderDefault: '#282834',
  // Brand accent (purple, secondary)
  purple200:     '#d4cdfb',
  purple300:     '#b9aef9',
  purple400:     '#a395f8',
  purple500:     '#8b7df7',
  purpleGlow:    'rgba(139,125,247,0.14)',
  // Brand primary (blue, matches Thanos logo)
  blue:          '#3b7af7',
  blueDim:       'rgba(59,122,247,0.12)',
  // Semantic
  green:         '#10b981',
  greenDim:      'rgba(16,185,129,0.10)',
  red:           '#f87171',
  redDim:        'rgba(248,113,113,0.10)',
  yellow:        '#eab308',
  orange:        '#f97316',
  // Coin colors (universal)
  btc:           '#f7931a',
  eth:           '#627eea',
  sol:           '#14f195',
  textPrimary:   '#f0f0f4',
  textSecondary: '#9696aa',
  textMuted:     '#52525b',
  statusBar:     'light-content' as 'light-content' | 'dark-content',
};

const LIGHT = {
  bgBase:        '#ffffff',
  bgSurface:     '#ffffff',
  bgElevated:    '#f4f4f7',
  bgCard:        '#ffffff',
  bgHover:       '#ebebf0',
  borderSubtle:  '#ececef',
  borderDefault: '#d4d4d8',
  purple200:     '#d4cdfb',
  purple300:     '#b9aef9',
  purple400:     '#a395f8',
  purple500:     '#8b7df7',
  purpleGlow:    'rgba(139,125,247,0.14)',
  blue:          '#3b7af7',
  blueDim:       'rgba(59,122,247,0.10)',
  green:         '#16a34a',
  greenDim:      'rgba(22,163,74,0.10)',
  red:           '#dc2626',
  redDim:        'rgba(220,38,38,0.10)',
  yellow:        '#ca8a04',
  orange:        '#ea580c',
  btc:           '#f7931a',
  eth:           '#627eea',
  sol:           '#14f195',
  textPrimary:   '#0a0a0f',
  textSecondary: '#52525b',
  textMuted:     '#71717a',
  statusBar:     'dark-content' as 'light-content' | 'dark-content',
};

type Colors = typeof DARK;

const ThemeCtx   = createContext<Colors>(DARK);
const ToggleCtx  = createContext<() => void>(() => {});
const StylesCtx  = createContext(makeStyles(DARK));

function useColors()  { return useContext(ThemeCtx); }
function useToggle()  { return useContext(ToggleCtx); }
function useStyles()  { return useContext(StylesCtx); }

/* ─── Page-transition wrapper ─────────────────────────────────────
   Plays a fade + small slide-up animation whenever `keyName` changes.
   Used for the main tab body and onboarding step transitions.
   Excluded from the splash/preloader by design. */
function AnimatedSwitch({ keyName, children, style }: {
  keyName: string;
  children: React.ReactNode;
  style?: any;
}) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(10);
    // useNativeDriver:false — a native-driven transform on a parent that
    // wraps Pressables (the whole onboarding card + the main tab body) can
    // desync the Android touch target from the visual mid-animation, making
    // buttons untappable. JS-driven is touch-safe; the 260ms fade is cheap.
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(translateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [keyName]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

/* ─────────────────────────── Wallet context ─────────────────────────── */
/* Real derived address (EVM 0x form) — provided by App after the vault is
   unlocked. Screens read it via useWalletAddr() instead of the mock
   ACCOUNT_ADDR constant we used during prototyping. */
const WalletAddrCtx = createContext<string>('');
function useWalletAddr(): string { return useContext(WalletAddrCtx); }

/* Unlocked BIP-39 seed words — provided by App, consumed by SendScreen
   for transaction signing. Empty array while the wallet is locked. */
const WalletSeedCtx = createContext<string[]>([]);
function useWalletSeed(): string[] { return useContext(WalletSeedCtx); }

/* In-app browser — Discover opens dApps inside a WebView overlay rather
   than the OS browser (SafePal-style). App provides openBrowser; any
   screen can call it. */
const BrowserCtx = createContext<(url: string) => void>(() => {});
function useBrowser(): (url: string) => void { return useContext(BrowserCtx); }

/* ─────────────────────────── Live portfolio ─────────────────────────── */

/* Real wallet data for Home / Send / Activity — fetches balances from
   the indexer (services/indexer) and prices them via CoinGecko. The
   indexer + pricing modules are local detached copies (EAS Cloud can't
   resolve workspace packages). Replaced the ASSETS / TXS mocks. */

/** Brand colour per token symbol, for the Avatar circle. Kept in sync with
 *  the canonical source-of-truth in apps/web/lib/tokens.ts (LITHO blue, JOT
 *  red, COLLE teal, FGPT/MUSA purple, etc.) so an avatar's fallback colour
 *  matches across clients. */
const ASSET_COLORS: Record<string, string> = {
  LITHO: '#3b7af7', WLITHO: '#3b7af7', BTC: '#f7931a', LITBTC: '#f7931a',
  ETH: '#627eea', SOL: '#14f195', USDC: '#2775ca', USDT: '#26a17b',
  BNB: '#f3ba2f', JOT: '#ef4444', IMAGE: '#22d3ee', LAX: '#2f6bff',
  FGPT: '#a855f7', MUSA: '#a855f7', COLLE: '#29b6d8', AGII: '#8b7df7',
  BLDR: '#f97316',
};
function assetColor(sym: string): string {
  return ASSET_COLORS[(sym || '').toUpperCase()] ?? '#8b7df7';
}

/** Compact number format — commas, trims trailing zeros. */
function formatAmount(n: number): string {
  if (!isFinite(n) || n === 0) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 4 : 8 });
}

/** USD format — $1,234.56 */
function formatUsd(n: number): string {
  return '$' + (isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

interface DisplayAsset {
  sym: string; name: string; chainId: number;
  balance: number; balanceText: string; decimals: number;
  priceUsd: number; usdValue: number; color: string;
  /** LEP100 contract address; absent for the native LITHO asset. */
  tokenAddress?: string;
  native: boolean;
}
interface PortfolioState {
  assets: DisplayAsset[]; totalUsd: number; loading: boolean; offline: boolean;
  reload: () => void;
}

/** Fetch + price the wallet's portfolio from the indexer.
 *  When `seed` is provided, also derives BTC/SOL/ATOM addresses and
 *  fetches their native balances, merging them as additional assets so
 *  the dashboard shows a true cross-chain portfolio total. */
function usePortfolio(address: string, seed?: string[]): PortfolioState {
  const [nonce, setNonce]   = useState(0);
  const [assets, setAssets] = useState<DisplayAsset[]>([]);
  const [totalUsd, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  // Memoise the seed string so the effect doesn't re-fire on every render.
  const seedKey = seed?.join(' ') ?? '';

  useEffect(() => {
    if (!address) { setAssets([]); setTotal(0); setLoading(false); setOffline(false); return; }
    let cancelled = false;
    setLoading(true); setOffline(false);
    (async () => {
      try {
        const [portfolio, prices] = await Promise.all([
          getPortfolio(address).catch(() => ({ assets: [], activity: [], walletAddress: address, updatedAt: '' })),
          fetchEcosystemPrices(),
        ]);
        if (cancelled) return;

        const evmRows: DisplayAsset[] = portfolio.assets.map((a) => {
          let bal = 0;
          try { bal = Number(formatUnits(a.balance || '0', a.decimals ?? 18)); } catch { bal = 0; }
          const priceUsd = prices[a.symbol] ?? 0;
          return {
            sym: a.symbol, name: a.name, chainId: a.chainId,
            balance: bal, balanceText: formatAmount(bal), decimals: a.decimals ?? 18,
            priceUsd, usdValue: bal * priceUsd,
            color: assetColor(a.symbol),
            tokenAddress: a.tokenAddress, native: !!a.native,
          };
        });

        // Cross-chain natives — only attempted when the seed is unlocked.
        // Each chain's call is best-effort; a single RPC outage doesn't
        // poison the whole portfolio.
        const xchain: DisplayAsset[] = [];
        if (seedKey) {
          const phrase = seedKey;
          const tries = await Promise.allSettled([
            (async () => {
              const m = await import('./lib/bitcoin');
              const addr = m.getBitcoinAddress(phrase);
              const bal = parseFloat(await m.getBitcoinBalance(addr)) || 0;
              return { sym: 'BTC', name: 'Bitcoin',     chainId: 0, balance: bal, decimals: 8 };
            })(),
            (async () => {
              const m = await import('./lib/solana');
              const addr = m.getSolanaAddress(phrase);
              const bal = parseFloat(await m.getSolanaBalance(addr)) || 0;
              return { sym: 'SOL', name: 'Solana',      chainId: 0, balance: bal, decimals: 9 };
            })(),
            (async () => {
              const m = await import('./lib/cosmos');
              const addr = await m.getCosmosAddress(phrase);
              const bal = parseFloat(await m.getCosmosBalance(addr)) || 0;
              return { sym: 'ATOM', name: 'Cosmos Hub', chainId: 0, balance: bal, decimals: 6 };
            })(),
          ]);
          for (const r of tries) {
            if (r.status !== 'fulfilled') continue;
            if (r.value.balance <= 0) continue; // hide zero positions
            const priceUsd = prices[r.value.sym] ?? 0;
            xchain.push({
              sym: r.value.sym, name: r.value.name, chainId: r.value.chainId,
              balance: r.value.balance, balanceText: formatAmount(r.value.balance),
              decimals: r.value.decimals, priceUsd, usdValue: r.value.balance * priceUsd,
              color: assetColor(r.value.sym), native: true,
            });
          }
        }

        const next = [...evmRows, ...xchain];
        if (cancelled) return;
        setAssets(next);
        setTotal(next.reduce((s, a) => s + a.usdValue, 0));
        setLoading(false);
      } catch {
        if (cancelled) return;
        setAssets([]); setTotal(0); setLoading(false); setOffline(true);
      }
    })();
    return () => { cancelled = true; };
  }, [address, nonce, seedKey]);

  return { assets, totalUsd, loading, offline, reload: () => setNonce((n) => n + 1) };
}

/** Relative "x min ago" label from an ISO timestamp. */
function relativeTime(iso?: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Map an indexer activity type to a display label + direction. */
function txDisplay(type: string): { label: string; positive: boolean } {
  switch (type) {
    case 'receive': case 'mint': return { label: 'Received', positive: true  };
    case 'send':    case 'burn': return { label: 'Sent',     positive: false };
    case 'swap':                 return { label: 'Swap',     positive: false };
    case 'approval':             return { label: 'Approval', positive: false };
    default: return { label: type ? type[0].toUpperCase() + type.slice(1) : 'Activity', positive: false };
  }
}

/** Accept an EVM 0x address, a litho1 bech32 address, or a .litho name. */
function isValidRecipient(v: string): boolean {
  const s = (v || '').trim();
  if (!s) return false;
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return true;   // EVM
  if (/^litho1[0-9a-z]{6,}$/.test(s)) return true;  // bech32
  if (/^[a-z0-9-]+\.litho$/i.test(s)) return true;  // DNNS name
  return false;
}

interface ActivityState {
  items: IndexerActivityItem[]; loading: boolean; offline: boolean; reload: () => void;
}

/** Fetch the wallet's recent on-chain activity from the indexer. */
function useActivity(address: string): ActivityState {
  const [nonce, setNonce]   = useState(0);
  const [items, setItems]   = useState<IndexerActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!address) { setItems([]); setLoading(false); setOffline(false); return; }
    let cancelled = false;
    setLoading(true); setOffline(false);
    getActivity(address)
      .then((list) => { if (!cancelled) { setItems(list); setLoading(false); } })
      .catch(()    => { if (!cancelled) { setItems([]); setLoading(false); setOffline(true); } });
    return () => { cancelled = true; };
  }, [address, nonce]);

  return { items, loading, offline, reload: () => setNonce((n) => n + 1) };
}

/* ─────────────────────────── Reusable bits ─────────────────────────── */

/* Token avatar — renders the branded coin icon composited over the
   brand-colour circle (same model as the web TokenIcon). Falls back to
   the colour + initial when no icon is available, and again if the
   <Image> errors at runtime (e.g. a remote CDN logo 404s). */
function Avatar({ symbol, color, size = 36 }: { symbol: string; color: string; size?: number }) {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);
  const source = failed ? null : tokenIconSource(symbol);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{symbol.slice(0, 1)}</Text>
      {source && (
        <Image
          source={source}
          onError={() => setFailed(true)}
          resizeMode="cover"
          style={{
            position: 'absolute', width: size, height: size,
            borderRadius: size / 2,
          }}
        />
      )}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const styles = useStyles();
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/* LITHO currency symbol 𝕃 (U+1D543). Rendered in the bundled single-glyph
   "LithoSym" font (embedded via the expo-font config plugin) since Hermes'
   default font lacks the math double-struck block. Used as a currency-symbol
   prefix on LITHO amounts. */
const LITHO_SYMBOL = '\u{1D543}';
function LithoSym({ size, color }: { size?: number; color?: string }) {
  return <Text style={{ fontFamily: 'LithoSym', fontSize: size, color }}>{LITHO_SYMBOL}</Text>;
}

/* ─────────────────────────── Screens ─────────────────────────── */

/* Portfolio sparkline (RN). Builds an SVG string and renders it via
   SvgXml. Real CoinGecko history for tracked coins; flat for the
   placeholder-priced ecosystem tokens. */
function PortfolioChart({ holdings }: { holdings: Holding[] }) {
  const C = useColors();
  const [range, setRange] = useState<Range>('7d');
  const [data, setData] = useState<PortfolioHistory | null>(null);
  const W = 320, H = 72;
  const key = useMemo(() => holdings.map(h => `${h.sym}:${h.qty.toFixed(6)}`).join('|'), [holdings]);
  useEffect(() => {
    let cancel = false;
    fetchPortfolioHistory(holdings, range).then(d => { if (!cancel) setData(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [key, range]);

  const pts = data?.points ?? [];
  const up = (data?.changePct ?? 0) >= 0;
  const stroke = up ? '#10b981' : '#f87171';
  let svg = '';
  if (pts.length >= 2) {
    const min = Math.min(...pts), max = Math.max(...pts), span = (max - min) || 1, dx = W / (pts.length - 1);
    const coords = pts.map((p, i) => [i * dx, H - 4 - ((p - min) / span) * (H - 8)] as const);
    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${W},${H} L0,${H} Z`;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${stroke}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#g)"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
    </svg>`;
  }

  return (
    <View style={{ marginBottom: 16 }}>
      {svg ? <SvgXml xml={svg} width="100%" height={H}/> : <View style={{ height: H }}/>}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 }}>
        {(['7d', '30d'] as Range[]).map(r => (
          <Pressable key={r} onPress={() => setRange(r)} style={{
            paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999,
            borderWidth: 1, borderColor: C.borderSubtle,
            backgroundColor: range === r ? C.bgElevated : 'transparent',
          }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: range === r ? C.textPrimary : C.textMuted }}>{r.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      {data && !data.hasRealData && (
        <Text style={{ textAlign: 'center', fontSize: 10, color: C.textMuted, marginTop: 4 }}>
          No price history for your current holdings yet.
        </Text>
      )}
    </View>
  );
}

function HomeScreen({ navigate, onOpenToken }: { navigate: (s: Screen) => void; onOpenToken: (sym: string) => void }) {
  const C = useColors();
  const styles = useStyles();
  const addr = useWalletAddr();
  const seed = useWalletSeed();
  const { assets, totalUsd, loading, offline, reload } = usePortfolio(addr, seed);
  const networks = new Set(assets.map((a) => a.chainId)).size;
  const [backedUp, setBackedUp] = useState<boolean | null>(null);
  useEffect(() => { isSeedBackedUp().then(setBackedUp).catch(() => {}); }, []);
  const holdings: Holding[] = useMemo(
    () => assets.filter(a => a.balance > 0 && a.usdValue > 0).map(a => ({ sym: a.sym, qty: a.balance, usd: a.usdValue })),
    [assets],
  );

  const QuickAction = ({ Icon, label, onPress }: { Icon: any; label: string; onPress?: () => void }) => (
    <Pressable style={styles.qaBtn} onPress={onPress}>
      <View style={styles.qaIcon}><Icon size={14} color={C.blue} strokeWidth={2.5}/></View>
      <Text style={styles.qaLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.textSecondary} />
      }
    >
      {/* Network pill */}
      <View style={styles.netPillRow}>
        <View style={styles.netPill}>
          <View style={[styles.netDot, offline && { backgroundColor: C.red }]}/>
          <Text style={styles.netText}>{offline ? 'Makalu · offline' : 'Makalu · synced'}</Text>
        </View>
      </View>

      {/* Balance hero CARD with gradient feel */}
      <View style={styles.balanceCard}>
        <View style={styles.balanceCardOverlay}/>
        <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>
        <Text style={styles.balanceAmt}>{loading ? '···' : formatUsd(totalUsd)}</Text>
        <View style={styles.balanceDivider}/>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <Text style={styles.balanceMetricLabel}>Assets</Text>
            <Text style={styles.balanceMetricValue}>{assets.length}</Text>
          </View>
          <View>
            <Text style={styles.balanceMetricLabel}>Networks</Text>
            <Text style={styles.balanceMetricValue}>{Math.max(networks, 1)}</Text>
          </View>
          <View>
            <Text style={styles.balanceMetricLabel}>Status</Text>
            <Text style={[styles.balanceMetricValue, { color: offline ? C.red : C.green }]}>
              {offline ? 'Offline' : 'Live'}
            </Text>
          </View>
        </View>
      </View>

      {/* Portfolio history chart */}
      {holdings.length > 0 && <PortfolioChart holdings={holdings}/>}

      {/* Quick actions row */}
      <View style={styles.qaRow}>
        <QuickAction Icon={ArrowUpRight}  label="Send"    onPress={() => navigate('send')}/>
        <QuickAction Icon={ArrowDownLeft} label="Receive" onPress={() => navigate('receive')}/>
        <QuickAction Icon={Repeat}        label="Swap"    onPress={() => navigate('swap')}/>
        <QuickAction Icon={Plus} label="Buy" onPress={() => Alert.alert(
          'Buy crypto',
          'Card on-ramp is coming soon. Until then, you can receive funds from another wallet or exchange.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Receive', onPress: () => navigate('receive') },
          ],
        )}/>
      </View>

      {/* Security: recovery-phrase backup nudge */}
      {backedUp === false && (
        <Pressable
          onPress={() => navigate('settings')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 4,
            borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
            backgroundColor: 'rgba(245,158,11,0.08)',
          }}
        >
          <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(245,158,11,0.16)', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={18} color="#f59e0b"/>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: C.textPrimary }}>Back up your recovery phrase</Text>
            <Text style={{ fontSize: 12, color: C.textMuted }}>Export and store it safely in Settings.</Text>
          </View>
          <ChevronRight size={18} color={C.textMuted}/>
        </Pressable>
      )}

      {/* Shortcuts: Earn + History (SafePal-style home shortcuts) */}
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 4 }}>
        <Pressable
          onPress={() => navigate('earn')}
          style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSubtle }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <Zap size={18} color={C.green}/>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '700', color: C.textPrimary }}>Earn</Text>
          <Text style={{ fontSize: 11, color: C.textMuted }}>Stake & earn yield</Text>
        </Pressable>
        <Pressable
          onPress={() => navigate('activity')}
          style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSubtle }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <Clock size={18} color={C.blue}/>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '700', color: C.textPrimary }}>History</Text>
          <Text style={{ fontSize: 11, color: C.textMuted }}>Recent transactions</Text>
        </Pressable>
        <Pressable
          onPress={() => navigate('nfts')}
          style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSubtle }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
            <ImageIcon size={18} color={C.blue}/>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '700', color: C.textPrimary }}>NFTs</Text>
          <Text style={{ fontSize: 11, color: C.textMuted }}>Collectibles</Text>
        </Pressable>
      </View>

      {/* Assets */}
      <View>
        <Pressable onPress={() => navigate('assets')} style={styles.assetsHeader}>
          <Text style={styles.sectionTitle}>Assets</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={styles.assetsCount}>{assets.length}</Text>
            <ChevronRight size={16} color={C.textMuted}/>
          </View>
        </Pressable>
        <View style={styles.card}>
          {loading && (
            <Text style={[styles.rowSub, { padding: 16 }]}>Loading balances…</Text>
          )}
          {!loading && offline && (
            <Text style={[styles.rowSub, { padding: 16 }]}>
              Couldn’t reach the indexer — pull down to retry.
            </Text>
          )}
          {!loading && !offline && assets.length === 0 && (
            <Text style={[styles.rowSub, { padding: 16 }]}>No assets yet.</Text>
          )}
          {assets.map((a, i) => (
            <Pressable key={`${a.sym}-${a.chainId}`} style={[styles.row, i < assets.length - 1 && styles.rowBorder]} onPress={() => onOpenToken(a.sym)}>
              <Avatar symbol={a.sym} color={a.color} />
              <View style={styles.rowMid}>
                <Text style={styles.rowSymbol}>{a.name}</Text>
                <Text style={styles.rowSub}>{a.priceUsd > 0 ? formatUsd(a.priceUsd) : '—'}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmt}>{formatUsd(a.usdValue)}</Text>
                <Text style={styles.rowBal}>
                  {a.sym === 'LITHO' ? <><LithoSym/> {a.balanceText}</> : `${a.balanceText} ${a.sym}`}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

type SendChainOption = 'evm' | 'bitcoin' | 'solana' | 'cosmos';

const CHAIN_META: Record<SendChainOption, { label: string; sym: string; decimals: number; placeholder: string }> = {
  evm:     { label: 'Lithosphere',  sym: 'LITHO', decimals: 18, placeholder: '0x… / litho1… / name.litho' },
  bitcoin: { label: 'Bitcoin',      sym: 'BTC',   decimals: 8,  placeholder: 'bc1q… / 1… / 3…' },
  solana:  { label: 'Solana',       sym: 'SOL',   decimals: 9,  placeholder: 'Base58 Solana address' },
  cosmos:  { label: 'Cosmos Hub',   sym: 'ATOM',  decimals: 6,  placeholder: 'cosmos1…' },
};

function SendScreen({ goBack, initialChain, initialSym }: { goBack: () => void; initialChain?: SendChainOption; initialSym?: string }) {
  const C = useColors();
  const styles = useStyles();
  const addr = useWalletAddr();
  const seed = useWalletSeed();
  const { assets, loading } = usePortfolio(addr);
  // Private-key wallets are EVM-only (a bare EVM key can't derive BTC/SOL/
  // Cosmos keys) — pin the chain to 'evm' and hide the chain selector.
  const pkOnly = isPrivateKeyWallet(seed);
  const [chain, setChain] = useState<SendChainOption>(pkOnly ? 'evm' : (initialChain ?? 'evm'));
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [selectedSym, setSelectedSym] = useState<string | null>(initialSym ?? null);
  const [scanOpen, setScanOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [memo, setMemo] = useState('');
  // Pre-send simulation — fires when recipient + amount are both valid,
  // mirrors the web Send modal so mobile users get the same
  // "contract recipient" + "insufficient balance" warnings before signing.
  const [simReport, setSimReport] = useState<import('./lib/tx-simulator').SimulationReport | null>(null);

  const coin = assets.find((a) => a.sym === selectedSym) ?? assets[0] ?? null;
  const amtNum = parseFloat(amt || '0');
  const usd = chain === 'evm' && coin ? amtNum * coin.priceUsd : 0;
  const overBalance = chain === 'evm' && !!coin && amtNum > coin.balance;

  // Chain-specific recipient validation. The EVM path also accepts
  // litho1… and name.litho — handled inside isValidRecipient.
  const recipientOk =
    chain === 'evm'     ? isValidRecipient(to)
    : chain === 'bitcoin' ? /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{6,}$/.test(to.trim())
    : chain === 'solana'  ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to.trim())
    : chain === 'cosmos'  ? /^cosmos1[0-9a-z]{38,}$/.test(to.trim())
    : false;
  const simHasCritical = simReport?.issues.some(i => i.level === 'critical') ?? false;
  const canReview =
    chain === 'evm'
      ? !!coin && amtNum > 0 && !overBalance && !!to && recipientOk && !sending && !simHasCritical
      : amtNum > 0 && !!to && recipientOk && !sending;

  /* Debounced pre-send simulation. Only EVM/Lithic chains for now —
     Bitcoin + Solana have their own checks elsewhere. */
  useEffect(() => {
    if (chain !== 'evm' || !coin || !to || !recipientOk || amtNum <= 0 || overBalance) { setSimReport(null); return; }
    const toAddr = to;
    const fromAddr = addr;
    const amount = amt;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { TransactionSimulator } = await import('./lib/tx-simulator');
        const sim = new TransactionSimulator();
        const r = await sim.simulateSend({
          chainId:     700777,
          from:        fromAddr,
          to:          toAddr,
          amount,
          tokenSymbol: coin.sym,
        });
        if (!cancelled) setSimReport(r);
      } catch { if (!cancelled) setSimReport(null); }
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [coin, to, amt, recipientOk, amtNum, overBalance, addr]);

  const doSend = async () => {
    if (sending) return;
    if (chain === 'evm') {
      if (!coin) return;
      if (!coin.native && !coin.tokenAddress) {
        Alert.alert('Cannot send', `${coin.sym} has no contract address available.`);
        return;
      }
    }
    setSending(true);
    try {
      const meta = CHAIN_META[chain];
      const recipient = chain === 'evm' ? await resolveRecipient(to) : to.trim();
      const hash = await sendAsset({
        seed,
        chain,
        to:           recipient,
        amount:       amt,
        decimals:     chain === 'evm' && coin ? coin.decimals : meta.decimals,
        tokenAddress: chain === 'evm' && coin && !coin.native ? coin.tokenAddress : undefined,
        memo:         chain === 'cosmos' ? memo : undefined,
      });
      setSending(false);
      setAmt(''); setTo(''); setMemo('');
      const sym = chain === 'evm' && coin ? coin.sym : meta.sym;
      const network = chain === 'evm' ? 'Makalu' : meta.label;
      // Fire a local notification (works without a push server) when enabled.
      isNotificationsEnabled().then(on => {
        if (on) notifyLocal('Transaction sent', `${amt} ${sym} broadcast on ${network}.`);
      });
      Alert.alert(
        'Transaction sent ✓',
        `${amt} ${sym} broadcast on ${network}.\n\nTx hash:\n${hash}`,
        [{ text: 'Done', onPress: goBack }],
      );
    } catch (e) {
      setSending(false);
      Alert.alert('Send failed', (e as Error)?.message || 'Could not broadcast the transaction.');
    }
  };

  const onReview = () => {
    const meta = CHAIN_META[chain];
    const sym = chain === 'evm' && coin ? coin.sym : meta.sym;
    const network = chain === 'evm' ? 'Makalu' : meta.label;
    const usdLine = chain === 'evm' ? `\n≈ ${formatUsd(usd)}` : '';
    if (chain === 'evm' && !coin) return;
    Alert.alert(
      'Confirm send',
      `Send ${amt} ${sym}\nTo: ${to}${usdLine}\n\nThis broadcasts a real transaction on ${network} and cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', style: 'destructive', onPress: doSend },
      ],
    );
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.screenHeader}>
        <Pressable onPress={goBack} hitSlop={16} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
        </Pressable>
        <Text style={styles.screenTitle}>Send</Text>
        <View style={{ width: 36 }}/>
      </View>

      {/* Chain selector — switching out of EVM hides the LEP-100 asset
          picker and uses chain-native recipient validation. Hidden for
          private-key wallets, which are Makalu/EVM-only. */}
      {!pkOnly && (
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginBottom: 8 }}>
        {(Object.keys(CHAIN_META) as SendChainOption[]).map(c => {
          const selected = c === chain;
          return (
            <Pressable
              key={c}
              onPress={() => { setChain(c); setTo(''); setAmt(''); setMemo(''); }}
              style={{
                flex: 1, paddingVertical: 8, borderRadius: 999,
                backgroundColor: selected ? C.blue : C.bgElevated,
                borderWidth: 1, borderColor: selected ? C.blue : C.borderDefault,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: selected ? '#fff' : C.textSecondary, fontWeight: '700', fontSize: 11 }}>
                {CHAIN_META[c].sym}
              </Text>
            </Pressable>
          );
        })}
      </View>
      )}

      {/* From asset card — only shown for EVM. Other chains have a fixed
          native token (BTC/SOL/ATOM) so no picker is needed. */}
      {chain === 'evm' ? (
      <View style={styles.assetSelectCard}>
        <Text style={styles.fieldLabel}>FROM</Text>
        <Pressable
          style={styles.assetSelectRow}
          onPress={() => assets.length > 0 && setPickerOpen(true)}
        >
          {coin ? (
            <>
              <Avatar symbol={coin.sym} color={coin.color} size={40}/>
              <View style={{ flex: 1 }}>
                <Text style={styles.assetSelectName}>{coin.name}</Text>
                <Text style={styles.assetSelectBal}>Balance: {coin.balanceText} {coin.sym}</Text>
              </View>
            </>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={styles.assetSelectName}>
                {loading ? 'Loading assets…' : 'No assets available'}
              </Text>
            </View>
          )}
          <ChevronRight size={18} color={C.textMuted}/>
        </Pressable>
      </View>
      ) : (
        <View style={styles.assetSelectCard}>
          <Text style={styles.fieldLabel}>FROM</Text>
          <View style={styles.assetSelectRow}>
            <Avatar symbol={CHAIN_META[chain].sym} color="#f59e0b" size={40}/>
            <View style={{ flex: 1 }}>
              <Text style={styles.assetSelectName}>{CHAIN_META[chain].label}</Text>
              <Text style={styles.assetSelectBal}>Native {CHAIN_META[chain].sym}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Amount card */}
      <View style={styles.assetSelectCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={styles.fieldLabel}>AMOUNT</Text>
          {chain === 'evm' && (
            <Pressable
              onPress={() => coin && setAmt(String(coin.balance))}
              style={styles.maxBtn}
            >
              <Text style={styles.maxBtnText}>MAX</Text>
            </Pressable>
          )}
        </View>
        <TextInput
          style={styles.bigAmountInput}
          placeholder="0.00"
          placeholderTextColor={C.textMuted}
          value={amt}
          onChangeText={setAmt}
          keyboardType="decimal-pad"
        />
        <Text style={[styles.amountUsdSub, overBalance && { color: C.red }]}>
          {chain === 'evm'
            ? (overBalance ? 'Amount exceeds balance' : `≈ ${formatUsd(usd)} USD`)
            : `${CHAIN_META[chain].sym}`}
        </Text>
      </View>

      {/* Recipient */}
      <View style={styles.assetSelectCard}>
        <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>RECIPIENT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TextInput
            style={[styles.input, { flex: 1, backgroundColor: 'transparent', borderWidth: 0, padding: 0, fontSize: 14, fontFamily: MONO }]}
            placeholder={CHAIN_META[chain].placeholder}
            placeholderTextColor={C.textMuted}
            value={to}
            onChangeText={setTo}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setScanOpen(true)}
            hitSlop={12}
            style={styles.scanBtn}
            accessibilityLabel="Scan QR code"
          >
            <ScanLine size={20} color={C.blue} strokeWidth={2.2}/>
          </Pressable>
        </View>
        {!!to && !recipientOk && (
          <Text style={[styles.rowSub, { marginTop: 8, color: C.red }]}>
            Not a valid {CHAIN_META[chain].label} address
          </Text>
        )}
      </View>

      {/* Optional Cosmos memo */}
      {chain === 'cosmos' && (
        <View style={styles.assetSelectCard}>
          <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>MEMO (optional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: 'transparent', borderWidth: 0, padding: 0, fontSize: 14 }]}
            placeholder="Exchange tag, transfer note, etc."
            placeholderTextColor={C.textMuted}
            value={memo}
            onChangeText={setMemo}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}

      {/* Camera QR scanner — decodes a recipient address (or bare 0x /
          litho1 / bc1 / base58) and drops it into the field. */}
      <QrScannerModal
        visible={scanOpen}
        title="Scan recipient address"
        onClose={() => setScanOpen(false)}
        onResult={(data) => {
          setTo(parseScannedAddress(data));
          setScanOpen(false);
        }}
      />

      {/* Asset picker — choose which portfolio asset to send */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          onPress={() => setPickerOpen(false)}
        >
          <Pressable
            style={{ backgroundColor: C.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 32 }}
            onPress={() => {}}
          >
            <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>SELECT ASSET</Text>
            {assets.map((a, i) => (
              <Pressable
                key={`${a.sym}-${a.chainId}`}
                style={[styles.row, i < assets.length - 1 && styles.rowBorder]}
                onPress={() => { setSelectedSym(a.sym); setAmt(''); setPickerOpen(false); }}
              >
                <Avatar symbol={a.sym} color={a.color} size={36}/>
                <View style={styles.rowMid}>
                  <Text style={styles.rowSymbol}>{a.name}</Text>
                  <Text style={styles.rowSub}>{a.balanceText} {a.sym}</Text>
                </View>
                <Text style={styles.rowAmt}>{formatUsd(a.usdValue)}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {amtNum > 0 && !!coin && (
        <View style={[styles.feeRowCard]}>
          <View style={styles.feeRow}>
            <Text style={styles.feeText}>Network</Text>
            <Text style={styles.feeTextValue}>Makalu</Text>
          </View>
          <View style={styles.feeRow}>
            <Text style={styles.feeText}>Network fee</Text>
            <Text style={styles.feeTextValue}>estimated at review</Text>
          </View>
        </View>
      )}

      {/* Pre-send simulation — warning/critical issues above the
          action button. Critical also gates `canReview`, so the button
          itself disables. */}
      {simReport && simReport.issues.filter(i => i.level !== 'info').map((issue, i) => {
        const isCritical = issue.level === 'critical';
        return (
          <View
            key={`${issue.code}-${i}`}
            style={{
              padding: 10,
              marginBottom: 8,
              borderRadius: 8,
              backgroundColor: isCritical ? 'rgba(248,113,113,0.10)' : 'rgba(245,158,11,0.10)',
              borderColor:     isCritical ? '#f87171' : 'transparent',
              borderWidth:     isCritical ? 1 : 0,
            }}
          >
            <Text style={{ color: isCritical ? '#f87171' : '#f59e0b', fontSize: 12, lineHeight: 16 }}>
              {issue.message}
            </Text>
          </View>
        );
      })}

      <Pressable
        style={[styles.btnPrimary, !canReview && { opacity: 0.4 }]}
        disabled={!canReview}
        onPress={onReview}
      >
        <Text style={styles.btnPrimaryText}>
          {sending ? 'Sending…' : simHasCritical ? 'Issue detected — blocked' : 'Review send'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

/* SafePal receive: pick network -> pick asset -> address + QR. The address is
   per-network (same for every asset on a chain); the asset drives the QR
   header (name + logo) and the coin-specific warning. */
type ReceiveChain = 'lithosphere' | 'bitcoin' | 'solana' | 'cosmos';
const RECEIVE_NETWORKS: Array<{ id: ReceiveChain; name: string; sym: string }> = [
  { id: 'lithosphere', name: 'Lithosphere Makalu', sym: 'LITHO' },
  { id: 'bitcoin',     name: 'Bitcoin',            sym: 'BTC'   },
  { id: 'solana',      name: 'Solana',             sym: 'SOL'   },
  { id: 'cosmos',      name: 'Cosmos Hub',         sym: 'ATOM'  },
];
const RECEIVE_ASSETS: Record<ReceiveChain, Array<{ sym: string; name: string }>> = {
  lithosphere: [
    { sym: 'LITHO',  name: 'Lithosphere' },
    { sym: 'LAX',    name: 'Lithosphere Algorithmic' },
    { sym: 'LitBTC', name: 'Bitcoin (wrapped)' },
    { sym: 'JOT',    name: 'Jot Art' },
    { sym: 'COLLE',  name: 'Colle AI' },
    { sym: 'IMAGE',  name: 'Imagen Network' },
    { sym: 'MUSA',   name: 'Mansa AI' },
  ],
  bitcoin: [{ sym: 'BTC',  name: 'Bitcoin' }],
  solana:  [{ sym: 'SOL',  name: 'Solana' }],
  cosmos:  [{ sym: 'ATOM', name: 'Cosmos Hub' }],
};

function ReceiveScreen({ goBack }: { goBack: () => void }) {
  const C = useColors();
  const styles = useStyles();
  const walletAddr = useWalletAddr();
  const seed = useWalletSeed();
  const [copied, setCopied]   = useState(false);
  const [qrSvg, setQrSvg]     = useState<string | null>(null);
  const [showAlt, setShowAlt] = useState(false);   // false = litho1, true = 0x
  /** SafePal step flow: network -> asset -> qr. */
  const [step, setStep] = useState<'network' | 'asset' | 'qr'>('network');
  /** The asset being received (drives the QR header + warning). */
  const [asset, setAsset] = useState<{ sym: string; name: string } | null>(null);
  /** Active chain — switches the displayed address + QR. */
  const [chain, setChain] = useState<ReceiveChain>('lithosphere');

  // Derive the Lithosphere bech32 form from the same 0x keypair — one
  // wallet, two formats. Defaults to showing the chain-native litho1.
  const lithoAddr = useMemo(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddr)) return '';
    try { return evmToLitho(walletAddr); } catch { return ''; }
  }, [walletAddr]);

  /** Derive BTC/SOL/ATOM addresses lazily — only when the user picks
   *  that chain. Hermes can handle the imports but they pull large
   *  deps so we don't load them until needed. */
  const [btcAddr, setBtcAddr] = useState<string>('');
  const [solAddr, setSolAddr] = useState<string>('');
  const [atomAddr, setAtomAddr] = useState<string>('');
  const [chainBalance, setChainBalance] = useState<string>('');

  useEffect(() => {
    if (chain === 'bitcoin' && !btcAddr && seed.length) {
      void import('./lib/bitcoin').then(m => setBtcAddr(m.getBitcoinAddress(seed.join(' '))))
        .catch(() => setBtcAddr(''));
    }
    if (chain === 'solana' && !solAddr && seed.length) {
      void import('./lib/solana').then(m => setSolAddr(m.getSolanaAddress(seed.join(' '))))
        .catch(() => setSolAddr(''));
    }
    if (chain === 'cosmos' && !atomAddr && seed.length) {
      void import('./lib/cosmos').then(m => m.getCosmosAddress(seed.join(' ')))
        .then(setAtomAddr)
        .catch(() => setAtomAddr(''));
    }
  }, [chain, seed, btcAddr, solAddr, atomAddr]);

  // Live balance for the active non-Lithosphere chain.
  useEffect(() => {
    setChainBalance('');
    if (chain === 'lithosphere') return;
    const addr = chain === 'bitcoin' ? btcAddr : chain === 'solana' ? solAddr : atomAddr;
    if (!addr) return;
    let cancelled = false;
    void (async () => {
      try {
        if (chain === 'bitcoin') {
          const m = await import('./lib/bitcoin');
          const b = await m.getBitcoinBalance(addr);
          if (!cancelled) setChainBalance(`${b} BTC`);
        } else if (chain === 'solana') {
          const m = await import('./lib/solana');
          const b = await m.getSolanaBalance(addr);
          if (!cancelled) setChainBalance(`${b} SOL`);
        } else {
          const m = await import('./lib/cosmos');
          const b = await m.getCosmosBalance(addr);
          if (!cancelled) setChainBalance(`${b} ATOM`);
        }
      } catch { if (!cancelled) setChainBalance('—'); }
    })();
    return () => { cancelled = true; };
  }, [chain, btcAddr, solAddr, atomAddr]);

  const displayed =
    chain === 'bitcoin' ? btcAddr
    : chain === 'solana'  ? solAddr
    : chain === 'cosmos'  ? atomAddr
    : (lithoAddr && !showAlt ? lithoAddr : walletAddr);

  /* Generate a real QR for the currently-displayed address. Re-renders
     when the format toggle flips so the QR encodes the right form. */
  useEffect(() => {
    let cancelled = false;
    setQrSvg(null);
    if (!displayed) return;
    makeAddressQrSvg(displayed, { size: 220, darkColor: '#0a0a0f', lightColor: '#ffffff' })
      .then(svg => { if (!cancelled) setQrSvg(svg); });
    return () => { cancelled = true; };
  }, [displayed]);

  const copy = async () => {
    if (!displayed) return;
    try { await Clipboard.setStringAsync(displayed); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ── Step 1: pick network ── */
  if (step === 'network') {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.screenHeader}>
          <Pressable onPress={goBack} hitSlop={16} style={styles.backBtn}>
            <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
          </Pressable>
          <Text style={styles.screenTitle}>Select network</Text>
          <View style={{ width: 36 }}/>
        </View>
        <View style={{ paddingHorizontal: 6 }}>
          {RECEIVE_NETWORKS.map((n, i) => (
            <Pressable key={n.id} onPress={() => { setChain(n.id); setShowAlt(false); setAsset(null); setStep('asset'); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
                       borderBottomWidth: i < RECEIVE_NETWORKS.length - 1 ? 1 : 0, borderBottomColor: C.borderSubtle }}>
              <Avatar symbol={n.sym} color={ASSET_COLORS[n.sym.toUpperCase()] ?? C.blue} size={36}/>
              <Text style={{ flex: 1, color: C.textPrimary, fontWeight: '700', fontSize: 15 }}>{n.name}</Text>
              <ChevronRight size={18} color={C.textMuted}/>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  /* ── Step 2: pick asset on that network ── */
  if (step === 'asset') {
    const assets = RECEIVE_ASSETS[chain];
    const netName = RECEIVE_NETWORKS.find(n => n.id === chain)?.name ?? '';
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.screenHeader}>
          <Pressable onPress={() => setStep('network')} hitSlop={16} style={styles.backBtn}>
            <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
          </Pressable>
          <Text style={styles.screenTitle}>Select asset</Text>
          <View style={{ width: 36 }}/>
        </View>
        <Text style={{ color: C.textMuted, fontSize: 12, paddingHorizontal: 8, paddingBottom: 6 }}>Receiving on {netName}</Text>
        <View style={{ paddingHorizontal: 6 }}>
          {assets.map((a, i) => (
            <Pressable key={a.sym} onPress={() => { setAsset(a); setStep('qr'); }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14,
                       borderBottomWidth: i < assets.length - 1 ? 1 : 0, borderBottomColor: C.borderSubtle }}>
              <Avatar symbol={a.sym} color={ASSET_COLORS[a.sym.toUpperCase()] ?? C.blue} size={34}/>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 14 }}>{a.sym}</Text>
                <Text style={{ color: C.textMuted, fontSize: 11 }}>{a.name}</Text>
              </View>
              <ChevronRight size={18} color={C.textMuted}/>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  /* ── Step 3: address + QR for the chosen asset ── */
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.screenHeader}>
        <Pressable onPress={() => setStep('asset')} hitSlop={16} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
        </Pressable>
        <Text style={styles.screenTitle}>Receive</Text>
        <View style={{ width: 36 }}/>
      </View>

      <View style={styles.receiveCard}>
        {/* Asset header — what you're receiving + the network. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center' }}>
          <Avatar symbol={asset?.sym ?? RECEIVE_NETWORKS.find(n => n.id === chain)!.sym} color={ASSET_COLORS[(asset?.sym ?? '').toUpperCase()] ?? C.blue} size={34}/>
          <View>
            <Text style={{ color: C.textPrimary, fontSize: 16, fontWeight: '800' }}>{asset?.name ?? ''} <Text style={{ color: C.textMuted, fontWeight: '600' }}>({asset?.sym ?? ''})</Text></Text>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600' }}>on {RECEIVE_NETWORKS.find(n => n.id === chain)?.name}</Text>
          </View>
        </View>
        {/* (legacy chain pills hidden — network is chosen in step 1) */}
        <View style={{ display: 'none' }}>
          {([
            { id: 'lithosphere', label: 'Litho' },
            { id: 'bitcoin',     label: 'BTC'   },
            { id: 'solana',      label: 'SOL'   },
            { id: 'cosmos',      label: 'ATOM'  },
          ] as const).map(o => {
            const selected = o.id === chain;
            return (
              <Pressable key={o.id} onPress={() => setChain(o.id)} style={{
                backgroundColor: selected ? C.bgCard : 'transparent',
                borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
              }}>
                <Text style={{ fontSize: 11, fontWeight: '700',
                               color: selected ? C.textPrimary : C.textSecondary }}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Network label */}
        <View style={[styles.networkSelector, { marginTop: 10 }]}>
          <View style={styles.netDot}/>
          <Text style={styles.networkSelectorText}>
            {chain === 'lithosphere' ? 'Lithosphere · Makalu'
             : chain === 'bitcoin'   ? 'Bitcoin · mainnet'
             : chain === 'solana'    ? 'Solana · mainnet-beta'
             : 'Cosmos Hub · cosmoshub-4'}
          </Text>
        </View>

        {/* Live balance for the active non-Lithosphere chain. */}
        {chain !== 'lithosphere' && !!chainBalance && (
          <Text style={{ color: C.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 6, alignSelf: 'center' }}>
            Balance: {chainBalance}
          </Text>
        )}

        {/* Litho1 / EVM toggle — same wallet, two address formats. */}
        {chain === 'lithosphere' && !!lithoAddr && (
          <View style={{
            flexDirection: 'row', alignSelf: 'center',
            backgroundColor: C.bgElevated,
            borderWidth: 1, borderColor: C.borderDefault,
            borderRadius: 999, padding: 3, marginTop: 12,
          }}>
            {[
              { isAlt: false, label: 'Litho1' },
              { isAlt: true,  label: 'EVM'    },
            ].map(o => {
              const selected = o.isAlt === showAlt;
              return (
                <Pressable
                  key={o.label}
                  onPress={() => setShowAlt(o.isAlt)}
                  style={{
                    backgroundColor: selected ? C.bgCard : 'transparent',
                    borderRadius: 999,
                    paddingHorizontal: 16, paddingVertical: 6,
                  }}
                >
                  <Text style={{
                    fontSize: 12, fontWeight: '600',
                    color: selected ? C.textPrimary : C.textSecondary,
                  }}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* QR with brand corners */}
        <View style={styles.qrFrame}>
          <View style={styles.qrCornerTL}/>
          <View style={styles.qrCornerTR}/>
          <View style={styles.qrCornerBL}/>
          <View style={styles.qrCornerBR}/>
          <View style={styles.qrPlaceholder}>
            {qrSvg
              ? <SvgXml xml={qrSvg} width={220} height={220}/>
              : <Image
                  source={require('./assets/images/Thanos_Logo_Transparent.png')}
                  style={{ width: 38, height: 38 }}
                  resizeMode="contain"
                />}
          </View>
        </View>

        <Pressable onPress={copy} style={styles.addrCard}>
          <Text style={styles.fieldLabel}>YOUR ADDRESS · TAP TO COPY</Text>
          <HiAddr value={displayed || '—'} full style={styles.addrTextLarge}/>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={[styles.btnSecondary, { flex: 1 }]} onPress={copy}>
            <Text style={styles.btnSecondaryText}>{copied ? '✓ Copied' : 'Copy address'}</Text>
          </Pressable>
          <Pressable style={[styles.btnSecondary, { flex: 1 }]} onPress={() => { Share.share({ message: displayed }).catch(() => {}); }}>
            <Text style={styles.btnSecondaryText}>Share</Text>
          </Pressable>
        </View>

        <View style={styles.warningCard}>
          <Text style={styles.warningCardText}>
            Only send {asset?.sym ?? 'supported'} on {RECEIVE_NETWORKS.find(n => n.id === chain)?.name} to this address. Sending another asset or chain may result in permanent loss.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function ActivityScreen() {
  const C = useColors();
  const styles = useStyles();
  const addr = useWalletAddr();
  const { items, loading, offline, reload } = useActivity(addr);
  const [filter, setFilter] = useState<'All' | 'Sent' | 'Received' | 'Swap'>('All');
  const shown = filter === 'All' ? items : items.filter(t => txDisplay(t.type).label === filter);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.textSecondary} />
      }
    >
      <Text style={styles.pageTitleLarge}>Activity</Text>
      <Text style={styles.pageSubtitle}>Recent transactions across all your wallets</Text>

      {/* Filter pills — tap to filter the list by direction. */}
      <View style={styles.filterRow}>
        {(['All', 'Sent', 'Received', 'Swap'] as const).map((f) => {
          const active = filter === f;
          return (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterPill, active && styles.filterPillActive]}>
              <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>{f}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.dateHeader}>Recent</Text>
      <View style={styles.card}>
        {loading && (
          <Text style={[styles.rowSub, { padding: 16 }]}>Loading activity…</Text>
        )}
        {!loading && offline && (
          <Text style={[styles.rowSub, { padding: 16 }]}>
            Couldn’t reach the indexer — pull down to retry.
          </Text>
        )}
        {!loading && !offline && shown.length === 0 && (
          <Text style={[styles.rowSub, { padding: 16 }]}>
            {filter === 'All' ? 'No transactions yet.' : `No ${filter.toLowerCase()} transactions.`}
          </Text>
        )}
        {shown.map((t, i) => {
          const d = txDisplay(t.type);
          const TxIcon = d.label === 'Sent' ? ArrowUpRight
                       : d.label === 'Received' ? ArrowDownLeft
                       : Repeat;
          const amount = String(t.amount ?? '').replace(/^[+-]/, '');
          return (
            <Pressable key={t.id || `${i}`} style={[styles.row, i < items.length - 1 && styles.rowBorder]}>
              <View style={[styles.txIcon, { backgroundColor: d.positive ? C.greenDim : C.blueDim }]}>
                <TxIcon size={16} color={d.positive ? C.green : C.blue} strokeWidth={2.4}/>
              </View>
              <View style={styles.rowMid}>
                <Text style={styles.rowSymbol}>{d.label} {t.symbol}</Text>
                <Text style={styles.rowSub}>{relativeTime(t.ts) || (t.status ?? '')}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.rowAmt, { color: d.positive ? C.green : C.textPrimary }]}>
                  {d.positive ? '+' : ''}{amount} {t.symbol}
                </Text>
                {t.txHash ? (
                  <Text style={styles.rowBal}>{t.txHash.slice(0, 10)}…</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

/* App-icon avatar for the Discover screen — uses the client's dApp app
   icon when bundled, else the brand colour + initial. */
function DappIcon({ id, name, color, size = 44 }: { id: string; name: string; color: string; size?: number }) {
  const src = discoverAppIcon(id);
  return (
    <View style={{ width: size, height: size, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {src
        ? <Image source={src} style={{ width: size, height: size }} resizeMode="cover"/>
        : <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>{name.charAt(0)}</Text>}
    </View>
  );
}

/* Swap — quotes MultX + Ignite in parallel, picks the better route,
   executes + polls bridge/DEX status. Same model as web SwapModal. */
function SwapScreen({ goBack, initialFrom }: { goBack: () => void; initialFrom?: string }) {
  const C = useColors();
  const styles = useStyles();
  const [from, setFrom] = useState(initialFrom ?? 'LITHO');
  const [to,   setTo]   = useState(initialFrom === 'LitBTC' ? 'LITHO' : 'LitBTC');
  const [amt,  setAmt]  = useState('100');
  const [slippagePct, setSlippagePct] = useState<number>(0.5);
  const [, setExpTick] = useState(0);
  type QuoteShape = {
    quoteId: string; from: string; to: string;
    fromAmount: string; toAmount: string; rate: number; feeFrom: string;
    expiresAt?: number;
    unsignedTx?: {
      to: string; value?: string; data?: string;
      gas?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
    };
  };
  const [quote,    setQuote]    = useState<QuoteShape | null>(null);
  const [provider, setProvider] = useState<'multx' | 'ignite' | null>(null);
  const [err,      setErr]      = useState<string | null>(null);
  const [pollMsg,  setPollMsg]  = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  useEffect(() => {
    const v = amt.trim();
    if (!v || parseFloat(v) <= 0 || from === to) {
      setQuote(null); setProvider(null); setErr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const [mux, ign] = await Promise.allSettled([
        import('./lib/multx').then(m => m.getQuote(from, to, v)),
        import('./lib/ignite').then(m => m.getQuote(from, to, v)),
      ]);
      if (cancelled) return;
      const cands: Array<{ provider: 'multx' | 'ignite'; q: QuoteShape }> = [];
      if (mux.status === 'fulfilled') cands.push({ provider: 'multx',  q: mux.value });
      if (ign.status === 'fulfilled') cands.push({ provider: 'ignite', q: ign.value });
      if (cands.length === 0) {
        setQuote(null); setProvider(null);
        setErr('Bridge + DEX unavailable — try again shortly');
        return;
      }
      cands.sort((a, b) => Number(b.q.toAmount) - Number(a.q.toAmount));
      setQuote(cands[0].q); setProvider(cands[0].provider); setErr(null);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [from, to, amt]);

  const quoteExpired = !!(quote?.expiresAt && Date.now() > quote.expiresAt);
  const quoteSecsLeft = quote?.expiresAt && quote.expiresAt > Date.now()
    ? Math.max(0, Math.round((quote.expiresAt - Date.now()) / 1000))
    : 0;
  const minReceived = quote ? Number(quote.toAmount) * (1 - slippagePct / 100) : 0;

  useEffect(() => {
    if (!quote?.expiresAt) return;
    const id = setInterval(() => setExpTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt]);

  const onSwap = async () => {
    if (!quote || !provider || busy) return;
    if (quoteExpired) {
      setErr('Quote expired — refresh to get a new rate.');
      setQuote(null); setProvider(null);
      return;
    }
    setBusy(true); setPollMsg('Awaiting execution…');
    try {
      // Metro requires a STATIC string in import() — keep the conditional
      // OUTSIDE the call (a ternary argument fails to bundle: "Invalid call").
      const mod = provider === 'multx'
        ? await import('./lib/multx')
        : await import('./lib/ignite');

      // Dual-mode dispatch — sign+broadcast locally via the module-
      // isolated signer when the quote includes an `unsignedTx`, else
      // post quoteId alone and let the bridge/DEX run server-side.
      let signedTxHash = '';
      if (quote.unsignedTx) {
        const signer = await import('./lib/signer');
        if (signer.hasSeed()) {
          signedTxHash = await signer.signAndBroadcast("m/44'/60'/0'/0/0", {
            to:                   quote.unsignedTx.to,
            value:                quote.unsignedTx.value ? BigInt(quote.unsignedTx.value) : undefined,
            data:                 quote.unsignedTx.data,
            gasLimit:             quote.unsignedTx.gas,
            maxFeePerGas:         quote.unsignedTx.maxFeePerGas,
            maxPriorityFeePerGas: quote.unsignedTx.maxPriorityFeePerGas,
          });
          setPollMsg(`Source tx: ${signedTxHash.slice(0, 10)}…`);
        }
      }

      const exec = await mod.execute(quote.quoteId, signedTxHash);
      const id = exec.executionId;
      if (exec.sourceHash) setPollMsg(`Source tx: ${exec.sourceHash.slice(0, 10)}…`);
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, Math.min(4000 + i * 2000, 30000)));
        try {
          const s = await mod.getStatus(id);
          if (s.state === 'completed') { setPollMsg('Swap complete ✓'); break; }
          if (s.state === 'failed') { setErr(s.error || 'Swap failed'); break; }
          setPollMsg(`Status: ${s.state}`);
        } catch { /* keep polling */ }
      }
    } catch (e) {
      setErr((e as Error).message || 'Swap failed');
    } finally { setBusy(false); }
  };

  const out = quote ? Number(quote.toAmount).toFixed(6) : '—';

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.screenHeader}>
        <Pressable onPress={goBack} hitSlop={16} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
        </Pressable>
        <Text style={styles.screenTitle}>Swap</Text>
        <View style={{ width: 28 }}/>
      </View>

      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Text style={styles.fieldLabel}>FROM</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[styles.input, { flex: 0.4, paddingVertical: 0, justifyContent: 'center' }]}>
            <Text style={{ color: C.textPrimary, fontWeight: '700' }}>{from}</Text>
          </View>
          <TextInput
            style={[styles.input, { flex: 1, color: C.textPrimary }]}
            value={amt} onChangeText={setAmt} keyboardType="decimal-pad" placeholder="0.00"
            placeholderTextColor={C.textMuted}
          />
        </View>

        <Pressable
          onPress={() => { const t = from; setFrom(to); setTo(t); }}
          style={{ alignSelf: 'center', padding: 8 }}
        >
          <Repeat size={20} color={C.textMuted}/>
        </Pressable>

        <Text style={styles.fieldLabel}>TO</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[styles.input, { flex: 0.4, paddingVertical: 0, justifyContent: 'center' }]}>
            <Text style={{ color: C.textPrimary, fontWeight: '700' }}>{to}</Text>
          </View>
          <View style={[styles.input, { flex: 1, justifyContent: 'center' }]}>
            <Text style={{ color: C.textPrimary, fontWeight: '700' }}>{out}</Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 4, marginTop: 4 }}>
          <Text style={{ color: C.textMuted, fontSize: 11 }}>
            {quote ? `1 ${from} ≈ ${quote.rate.toFixed(6)} ${to} · Route: ${provider} · Fee ${quote.feeFrom} ${from}` : 'Quoting…'}
          </Text>

          {/* Slippage tolerance picker. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <Text style={{ color: C.textMuted, fontSize: 11 }}>Slippage</Text>
            {[0.1, 0.5, 1, 2].map(s => {
              const active = slippagePct === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSlippagePct(s)}
                  style={{
                    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
                    borderWidth: 1, borderColor: active ? C.blue : C.borderDefault,
                    backgroundColor: active ? C.blue : 'transparent',
                  }}
                >
                  <Text style={{
                    fontSize: 10, fontWeight: '700',
                    color: active ? '#fff' : C.textSecondary,
                  }}>{s}%</Text>
                </Pressable>
              );
            })}
          </View>

          {quote && (
            <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>
              Min received: <Text style={{ color: C.textPrimary, fontWeight: '700' }}>{minReceived.toFixed(6)} {to}</Text>
            </Text>
          )}
          {quote?.expiresAt && (
            <Text style={{ color: quoteExpired ? C.red : C.textMuted, fontSize: 11, marginTop: 2 }}>
              {quoteExpired ? 'Quote expired — refresh to retry' : `Quote expires in ${quoteSecsLeft}s`}
            </Text>
          )}

          {err && <Text style={{ color: C.red, fontSize: 12, marginTop: 4 }}>{err}</Text>}
          {pollMsg && <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 4 }}>{pollMsg}</Text>}
        </View>

        <Pressable
          style={[styles.btnPrimary, (!quote || busy || quoteExpired) && { opacity: 0.5 }]}
          disabled={!quote || busy || quoteExpired}
          onPress={onSwap}
        >
          <Text style={styles.btnPrimaryText}>{busy ? 'Swapping…' : quoteExpired ? 'Quote expired' : `Swap ${from} → ${to}`}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/* Earn — honest "coming soon" mirroring web StakingView; the Lithosphere
   staking contracts aren't deployed on Makalu yet. */
function EarnScreen({ goBack }: { goBack: () => void }) {
  const C = useColors();
  const styles = useStyles();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Pressable onPress={goBack} hitSlop={8}><ChevronLeft size={24} color={C.textPrimary}/></Pressable>
        <Text style={styles.pageTitleLarge}>Earn</Text>
      </View>
      <View style={{
        padding: 28, borderRadius: 16, marginTop: 12, alignItems: 'center', gap: 12,
        backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderDefault, borderStyle: 'dashed',
      }}>
        <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center' }}>
          <Zap size={26} color={C.green}/>
        </View>
        <Text style={{ fontSize: 16, fontWeight: '700', color: C.textPrimary, textAlign: 'center' }}>Staking opens with the protocol rollout</Text>
        <Text style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 20 }}>
          Lithosphere validator staking, LITHO/LitBTC LP, and the LAX stable-yield vault will appear here as soon as the staking contract is deployed on Makalu. Your active positions will show up automatically.
        </Text>
      </View>
    </ScrollView>
  );
}

function DiscoverScreen() {
  const C = useColors();
  const styles = useStyles();
  const openBrowser = useBrowser();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const isLink = looksLikeUrl(q);

  const filtered: EcosystemApp[] = query && !isLink
    ? ECOSYSTEM_APPS.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.category.toLowerCase().includes(query) ||
        a.description.toLowerCase().includes(query) ||
        a.section.toLowerCase().includes(query))
    : ECOSYSTEM_APPS;
  const groups = groupBySection(filtered);

  const submit = () => {
    const url = normalizeUrl(q);
    if (url) openBrowser(url);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Text style={styles.pageTitleLarge}>Discover</Text>
      <Text style={styles.pageSubtitle}>Lithosphere ecosystem apps — open in the in-app browser</Text>

      {/* Search / address bar */}
      <View style={{ position: 'relative', marginTop: 14, marginBottom: 14, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 12, zIndex: 1 }}>
          <Search size={16} color={C.textMuted}/>
        </View>
        <TextInput
          value={q}
          onChangeText={setQ}
          onSubmitEditing={submit}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="web-search"
          returnKeyType="go"
          placeholder="Search DApp or enter a link"
          placeholderTextColor={C.textMuted}
          style={{
            backgroundColor: C.bgElevated, borderRadius: 12,
            borderWidth: 1, borderColor: C.borderDefault,
            paddingVertical: 12, paddingLeft: 38, paddingRight: 14,
            color: C.textPrimary, fontSize: 15,
          }}
        />
      </View>

      {/* "Open this link" affordance when the query looks like a URL */}
      {isLink && (
        <Pressable
          onPress={submit}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 16,
            borderRadius: 14, borderWidth: 1, borderColor: C.blue, backgroundColor: C.blueDim,
          }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' }}>
            <Globe size={20} color={C.blue}/>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: C.textPrimary }}>Open link</Text>
            <Text style={{ fontSize: 12, color: C.textMuted }} numberOfLines={1}>{normalizeUrl(q)}</Text>
          </View>
          <ChevronRight size={18} color={C.blue}/>
        </Pressable>
      )}

      {/* Featured hub */}
      {!query && (
        <Pressable
          onPress={() => openBrowser(ECOSYSTEM_HUB)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16,
            borderRadius: 16, marginBottom: 20,
            backgroundColor: C.purpleGlow, borderWidth: 1, borderColor: C.borderDefault,
          }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' }}>
            <Globe size={22} color={C.blue}/>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.textPrimary }}>Explore Web4</Text>
            <Text style={{ fontSize: 12, color: C.textMuted }}>Browse the full ecosystem on ecosystem.litho.ai</Text>
          </View>
        </Pressable>
      )}

      {/* Grouped sections (SafePal-style) */}
      {groups.map(({ section, apps }) => (
        <View key={section} style={{ marginBottom: 8 }}>
          <Text style={styles.dateHeader}>{section}</Text>
          <View style={styles.card}>
            {apps.map((a, i) => (
              <Pressable key={a.id} onPress={() => openBrowser(a.url)} style={[styles.row, i < apps.length - 1 && styles.rowBorder]}>
                <DappIcon id={a.id} name={a.name} color={a.color}/>
                <View style={styles.rowMid}>
                  <Text style={styles.rowSymbol}>{a.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{a.description}</Text>
                </View>
                <ChevronRight size={18} color={C.textMuted}/>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      {groups.length === 0 && !isLink && (
        <Text style={[styles.rowSub, { padding: 16 }]}>No apps match “{q}”.</Text>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'flex-start' }}>
        <Shield size={14} color={C.green}/>
        <Text style={{ flex: 1, fontSize: 11, color: C.textMuted, lineHeight: 17 }}>
          Always check the URL before connecting your wallet or signing a transaction.
        </Text>
      </View>
    </ScrollView>
  );
}

function SettingsScreen() {
  const C = useColors();
  const styles = useStyles();
  const toggle = useToggle();
  const walletAddr = useWalletAddr();
  const seed = useWalletSeed();
  const isDark = C.bgBase === DARK.bgBase;

  // Modal flags for the settings actions.
  const [revealOpen, setRevealOpen]     = useState(false);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [autoLockOpen, setAutoLockOpen] = useState(false);
  const [rpcOpen, setRpcOpen]           = useState(false);
  const [addrBookOpen, setAddrBookOpen] = useState(false);
  const [permsOpen, setPermsOpen] = useState(false);
  const [dnnsOpen, setDnnsOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [autoLockMin, setAutoLockMin]   = useState(0);
  const [currency, setCurrency]         = useState('USD');
  const [language, setLanguage]         = useState('English');
  useEffect(() => {
    AsyncStorage.getItem(PREF_AUTOLOCK).then(v => setAutoLockMin(parseInt(v ?? '0', 10) || 0));
    AsyncStorage.getItem(PREF_CURRENCY).then(v => { if (v) setCurrency(v); });
    AsyncStorage.getItem(PREF_LANGUAGE).then(v => { if (v) setLanguage(v); });
  }, []);

  // Display preferences — persisted picker, matches web's General section.
  const pickCurrency = () => Alert.alert('Display currency', 'Prices stream in USD; FX conversion arrives in a later update.', [
    ...CURRENCY_OPTS.map(c => ({ text: `${c === currency ? '✓ ' : ''}${c}`, onPress: () => { setCurrency(c); AsyncStorage.setItem(PREF_CURRENCY, c).catch(() => {}); } })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
  const pickLanguage = () => Alert.alert('Interface language', 'Full translations arrive in a later update.', [
    ...LANGUAGE_OPTS.map(l => ({ text: `${l === language ? '✓ ' : ''}${l}`, onPress: () => { setLanguage(l); AsyncStorage.setItem(PREF_LANGUAGE, l).catch(() => {}); } })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);

  /* Biometric capability + enabled-state. Refreshes after the user
     toggles it so the row reflects reality. */
  const [bioKind, setBioKind]   = useState<BiometricKind>('none');
  const [bioReady, setBioReady] = useState(false);
  const [bioOn, setBioOn]       = useState(false);
  const [copied, setCopied]     = useState(false);
  const [wcOpen, setWcOpen]     = useState(false);
  const [notifOn, setNotifOn]   = useState(false);

  const refreshBio = async () => {
    const cap = await getBiometricCapability();
    setBioKind(cap.kind);
    setBioReady(cap.hasHardware && cap.isEnrolled);
    setBioOn(await isBiometricUnlockEnabled());
  };
  useEffect(() => { void refreshBio(); isNotificationsEnabled().then(setNotifOn); }, []);

  const onToggleNotif = async () => {
    if (notifOn) {
      await setNotificationsEnabled(false);
      await unregisterPush(walletAddr).catch(() => {});
      setNotifOn(false);
      return;
    }
    const ok = await registerPush(walletAddr);
    if (!ok) {
      Alert.alert('Notifications unavailable', 'Enable notifications for Thanos in your device settings, then try again. (Push delivery also requires the app to be a real device build.)');
      return;
    }
    await setNotificationsEnabled(true);
    setNotifOn(true);
  };

  const onToggleBio = async () => {
    if (!bioReady) {
      Alert.alert(
        'Biometrics unavailable',
        'No biometric is enrolled on this device. Set up Face ID or fingerprint in your OS settings first.',
      );
      return;
    }
    if (bioOn) {
      await disableBiometricUnlock();
      await refreshBio();
      return;
    }
    const key = getSessionKey();
    if (!key) {
      Alert.alert(
        'Unlock required',
        'For your security, biometric unlock can only be enabled right after entering your password. Lock and unlock the wallet, then try again.',
      );
      return;
    }
    const ok = await enableBiometricUnlock(key);
    if (!ok) {
      Alert.alert('Could not enable', 'Biometric authentication was cancelled or unavailable.');
    }
    await refreshBio();
  };

  const copyAddr = async () => {
    if (!walletAddr) return;
    try { await Clipboard.setStringAsync(walletAddr); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  type SettingItem = {
    label:   string;
    desc:    string;
    Icon:    React.ElementType;
    danger?: boolean;
    /** Right-side control. Defaults to a chevron if omitted. */
    accessory?: React.ReactNode;
    onPress?: () => void;
  };

  const bioName = biometricLabel(bioKind);
  const SECURITY_OPTS: SettingItem[] = [
    {
      label: `${bioName} unlock`,
      desc:  bioOn
               ? `Enabled — unlock with ${bioName}`
               : bioReady
                 ? `Use ${bioName} instead of your password`
                 : 'Not available on this device',
      Icon:  bioKind === 'face' ? ScanFace : Fingerprint,
      accessory: (
        <View style={[styles.toggleSwitch, bioOn && styles.toggleSwitchOn]}>
          <View style={[styles.toggleThumb, bioOn && styles.toggleThumbOn]}/>
        </View>
      ),
      onPress: onToggleBio,
    },
    { label: 'Auto-lock',         desc: autoLockMin > 0 ? `After ${autoLockMin} min in background` : 'Never',
      Icon: Clock, onPress: () => setAutoLockOpen(true) },
    { label: 'Change password',   desc: 'Update wallet password',          Icon: Key,
      onPress: () => setChangePwdOpen(true) },
    isPrivateKeyWallet(seed)
      ? { label: 'Private key',      desc: 'View this account’s private key', Icon: AlertTriangle, danger: true,
          onPress: () => setRevealOpen(true) }
      : { label: 'Recovery phrase',  desc: 'View your 12 / 24-word seed',     Icon: AlertTriangle, danger: true,
          onPress: () => setRevealOpen(true) },
  ];
  const NETWORK_OPTS: SettingItem[] = [
    {
      label: 'Push notifications',
      desc:  notifOn ? 'Enabled — alerts for activity' : 'Get alerts for incoming funds & activity',
      Icon:  Zap,
      accessory: (
        <View style={[styles.toggleSwitch, notifOn && styles.toggleSwitchOn]}>
          <View style={[styles.toggleThumb, notifOn && styles.toggleThumbOn]}/>
        </View>
      ),
      onPress: onToggleNotif,
    },
    { label: 'Network',           desc: 'Makalu (mainnet)',                Icon: Globe },
    { label: 'Lithosphere names', desc: 'Register a .litho name for your wallet', Icon: BadgeCheck,
      onPress: () => setDnnsOpen(true) },
    { label: 'Custom RPC',        desc: 'Override the Makalu RPC endpoint', Icon: Server,
      onPress: () => setRpcOpen(true) },
    { label: 'Connected dApps',   desc: 'Pair via WalletConnect',          Icon: Zap,
      onPress: () => setWcOpen(true) },
  ];

  // Premium-pattern section header — icon tile + title + sub.
  const SectionHead = ({ Icon, title, sub }: { Icon: React.ElementType; title: string; sub: string }) => (
    <View style={styles.setSectionHead}>
      <View style={styles.setSectionIcon}>
        <Icon size={16} color={C.blue} strokeWidth={2}/>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.setSectionTitle}>{title}</Text>
        <Text style={styles.setSectionSub}>{sub}</Text>
      </View>
    </View>
  );

  const Section = ({ Icon, title, sub, items }: { Icon: React.ElementType; title: string; sub: string; items: SettingItem[] }) => (
    <>
      <SectionHead Icon={Icon} title={title} sub={sub}/>
      <View style={styles.card}>
        {items.map((s, i) => (
          <Pressable
            key={i}
            style={[styles.settingRow, i < items.length - 1 && styles.rowBorder]}
            onPress={s.onPress}
          >
            <View style={styles.settingIcon}>
              <s.Icon size={16} color={s.danger ? C.red : C.textSecondary} strokeWidth={2}/>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, s.danger && { color: C.red }]}>{s.label}</Text>
              <Text style={styles.settingDesc}>{s.desc}</Text>
            </View>
            {s.accessory ?? <ChevronRight size={18} color={C.textMuted}/>}
          </Pressable>
        ))}
      </View>
    </>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {/* Gradient hero header */}
      <View style={styles.setHero}>
        <Text style={styles.setHeroTitle}>Settings</Text>
        <Text style={styles.setHeroSub}>Manage your wallet preferences, security, and account details.</Text>
      </View>

      {/* Account header card */}
      <View style={styles.acctHeaderCard}>
        <Image
          source={require('./assets/images/Thanos_Logo_Transparent.png')}
          style={{ width: 36, height: 36 }}
          resizeMode="contain"
        />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.acctHeaderName}>Account {(seed.length > 0 && !isPrivateKeyWallet(seed) ? getActiveAccountIndex() : 0) + 1}</Text>
          <Text style={styles.acctHeaderAddr} numberOfLines={1} ellipsizeMode="middle">
            {walletAddr || '—'}
          </Text>
        </View>
        <Pressable style={styles.copyChip} onPress={copyAddr}>
          <Text style={styles.copyChipText}>{copied ? '✓' : 'Copy'}</Text>
        </Pressable>
      </View>

      <Section Icon={Globe} title="General" sub="Display, language, and locale" items={[
        { label: 'Currency', desc: `Display prices in ${currency}`, Icon: TrendingUp, onPress: pickCurrency },
        { label: 'Language', desc: `Interface language — ${language}`, Icon: Globe, onPress: pickLanguage },
        { label: 'Theme', desc: isDark ? 'Dark' : 'Light', Icon: isDark ? Moon : Sun, onPress: toggle },
      ]}/>
      <Section Icon={Users} title="Account" sub="Optional cloud account for cross-device sync" items={[
        { label: 'Cloud account', desc: 'Sign in to sync your address book & preferences', Icon: Users,
          onPress: () => setAcctOpen(true) },
      ]}/>
      <Section Icon={Shield} title="Hardware wallet" sub="Sign with a Ledger or Trezor device" items={[
        { label: 'Connect a device', desc: 'Ledger / Trezor — available on Thanos desktop & web', Icon: Key,
          onPress: () => Alert.alert(
            'Hardware wallet',
            'Ledger and Trezor signing is available today in the Thanos desktop and web apps (over USB).\n\nOn mobile it needs a Bluetooth-enabled build — it’s on the roadmap as a dedicated release and isn’t in this version.',
            [{ text: 'OK' }],
          ) },
      ]}/>
      <Section Icon={Shield} title="Security"   sub="Protect access to your wallet" items={SECURITY_OPTS}/>
      <Section Icon={Users}  title="Address book" sub="Saved contacts, cloud-synced when signed in" items={[
        { label: 'Manage contacts', desc: 'Add, view and remove saved addresses', Icon: Users,
          onPress: () => setAddrBookOpen(true) },
      ]}/>
      <Section Icon={Shield} title="Permissions" sub="Token allowances + connected dApps" items={[
        { label: 'Manage permissions', desc: 'Audit & revoke approvals, disconnect dApps', Icon: Shield,
          onPress: () => setPermsOpen(true) },
      ]}/>
      <Section Icon={Globe}  title="Network"    sub="Connection and RPC endpoints"  items={NETWORK_OPTS}/>

      {/* Legal + transparency — required by App Store + Google Play
          submission reviewers, and standard wallet-UX hygiene. Opens
          in the device's default browser via Linking.openURL so users
          stay in-context (browser back returns them to the wallet). */}
      <Section Icon={Shield} title="Legal" sub="Privacy policy and security disclosures" items={[
        { label: 'Privacy policy', desc: 'What data leaves your device, and where it goes', Icon: Shield,
          onPress: () => { Linking.openURL('https://thanos.fi/privacy').catch(() => {}); } },
        { label: 'Security disclosures', desc: 'Report a vulnerability + PGP key', Icon: AlertTriangle,
          onPress: () => { Linking.openURL('https://thanos.fi/.well-known/security.txt').catch(() => {}); } },
      ]}/>

      <SectionHead Icon={isDark ? Moon : Sun} title="Appearance" sub="Theme and display"/>
      <View style={styles.card}>
        <Pressable style={styles.settingRow} onPress={toggle}>
          <View style={styles.settingIcon}>
            {isDark ? <Moon size={16} color={C.textSecondary} strokeWidth={2}/> : <Sun size={16} color={C.textSecondary} strokeWidth={2}/>}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Theme</Text>
            <Text style={styles.settingDesc}>{isDark ? 'Dark mode' : 'Light mode'} — tap to switch</Text>
          </View>
          <View style={[styles.toggleSwitch, isDark && styles.toggleSwitchOn]}>
            <View style={[styles.toggleThumb, isDark && styles.toggleThumbOn]}/>
          </View>
        </Pressable>
      </View>

      <Text style={styles.versionText}>Thanos Wallet · v0.8.1 · Makalu</Text>

      {/* WalletConnect pairing + connected-dApp management. */}
      <WalletConnectModal
        visible={wcOpen}
        onClose={() => setWcOpen(false)}
        evmAddress={walletAddr}
      />

      <RevealPhraseModal visible={revealOpen} onClose={() => setRevealOpen(false)} seed={seed}/>
      <ChangePasswordModal visible={changePwdOpen} onClose={() => setChangePwdOpen(false)} seed={seed}/>
      <AutoLockModal
        visible={autoLockOpen}
        current={autoLockMin}
        onClose={() => setAutoLockOpen(false)}
        onPick={(m) => { setAutoLockMin(m); AsyncStorage.setItem(PREF_AUTOLOCK, String(m)); setAutoLockOpen(false); }}
      />
      <CustomRpcModal visible={rpcOpen} onClose={() => setRpcOpen(false)}/>
      <AddressBookModal visible={addrBookOpen} onClose={() => setAddrBookOpen(false)}/>
      <PermissionsModal visible={permsOpen} onClose={() => setPermsOpen(false)} seed={seed}/>
      <DnnsModal visible={dnnsOpen} onClose={() => setDnnsOpen(false)} ownerAddr={walletAddr}/>
      <AccountModal visible={acctOpen} onClose={() => setAcctOpen(false)}/>
    </ScrollView>
  );
}

/* ─── Permissions modal — token allowances + connected dApps ─────────── */
function PermissionsModal({ visible, onClose, seed }: { visible: boolean; onClose: () => void; seed: string[] }) {
  const C = useColors();
  const [tab, setTab] = useState<'allowances' | 'sessions'>('allowances');

  useEffect(() => { if (visible) setTab('allowances'); }, [visible]);
  if (!visible) return null;

  return (
    <SheetShell title="Permissions" onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 6, padding: 4, backgroundColor: C.bgElevated, borderRadius: 10 }}>
        <Pressable onPress={() => setTab('allowances')} style={{
          flex: 1, padding: 8, borderRadius: 6, alignItems: 'center',
          backgroundColor: tab === 'allowances' ? C.bgCard : 'transparent',
        }}>
          <Text style={{ color: tab === 'allowances' ? C.textPrimary : C.textSecondary, fontWeight: '600', fontSize: 12 }}>Token allowances</Text>
        </Pressable>
        <Pressable onPress={() => setTab('sessions')} style={{
          flex: 1, padding: 8, borderRadius: 6, alignItems: 'center',
          backgroundColor: tab === 'sessions' ? C.bgCard : 'transparent',
        }}>
          <Text style={{ color: tab === 'sessions' ? C.textPrimary : C.textSecondary, fontWeight: '600', fontSize: 12 }}>Connected apps</Text>
        </Pressable>
      </View>
      <View style={{ height: 8 }}/>
      {tab === 'allowances' ? <MobileAllowancesPanel seed={seed}/> : <MobileSessionsPanel/>}
    </SheetShell>
  );
}

function MobileAllowancesPanel({ seed }: { seed: string[] }) {
  const C = useColors();
  const [rows, setRows] = useState<AllowanceRow[] | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const ethers = require('ethers');
      const provider = new ethers.JsonRpcProvider('https://rpc.litho.ai');
      const w = ethers.HDNodeWallet.fromMnemonic(
        ethers.Mnemonic.fromPhrase(seed.join(' ')),
        `m/44'/60'/0'/0/0`,
      );
      setRows(await fetchMakaluAllowances({
        walletAddress: w.address, provider,
        knownTokens: MAKALU_KNOWN_TOKENS,
      }));
    } catch (e) { setErr((e as Error).message); setRows([]); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const revoke = async (r: AllowanceRow) => {
    if (!seed.length) { setErr('Wallet is locked'); return; }
    const k = `${r.tokenAddress}|${r.spender}`;
    setBusy(k); setErr(null);
    try {
      const ethers = require('ethers');
      const provider = new ethers.JsonRpcProvider('https://rpc.litho.ai');
      const w = ethers.HDNodeWallet.fromMnemonic(
        ethers.Mnemonic.fromPhrase(seed.join(' ')),
        `m/44'/60'/0'/0/0`,
      ).connect(provider);
      const tx = await revokeAllowance({ signer: w, tokenAddress: r.tokenAddress, spender: r.spender });
      await tx.wait();
      void load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  if (!rows) return <Text style={{ color: C.textMuted, fontSize: 12 }}>Scanning approvals…</Text>;
  if (err) return <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>;
  if (rows.length === 0) return <Text style={{ color: C.textMuted, fontSize: 12 }}>No active allowances on Makalu.</Text>;

  return (
    <ScrollView style={{ maxHeight: 360 }}>
      {rows.map(r => {
        const k = `${r.tokenAddress}|${r.spender}`;
        return (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: C.bgElevated, borderRadius: 10, marginBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 13 }}>
                {r.symbol}
                {r.unlimited && <Text style={{ color: '#f59e0b', fontSize: 10, fontWeight: '800' }}>  · UNLIMITED</Text>}
              </Text>
              <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: C.textMuted, fontFamily: MONO, fontSize: 10 }}>{r.spender}</Text>
              <Text style={{ color: C.textMuted, fontSize: 11 }}>{r.unlimited ? 'Unlimited' : `${r.amount} ${r.symbol}`}</Text>
            </View>
            <Pressable onPress={() => revoke(r)} disabled={busy === k} style={{
              paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6,
              borderWidth: 1, borderColor: C.red, opacity: busy === k ? 0.6 : 1,
            }}>
              <Text style={{ color: C.red, fontWeight: '700', fontSize: 11 }}>{busy === k ? 'Revoking…' : 'Revoke'}</Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

function MobileSessionsPanel() {
  const C = useColors();
  const [rows, setRows] = useState<Array<{ topic: string; name: string; url: string; chains: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);

  const load = async () => {
    setErr(null);
    try {
      const map = await getActiveSessions();
      setRows(Object.values(map).map(s => ({
        topic: s.topic,
        name: s.peer?.metadata?.name || 'Unknown dApp',
        url:  s.peer?.metadata?.url  || '',
        chains: (s.namespaces?.eip155?.chains ?? []).join(', ') || 'eip155:700777',
      })));
    } catch (e) { setErr((e as Error).message); setRows([]); }
  };
  useEffect(() => { void load(); }, []);

  const disconnect = async (topic: string) => {
    setBusy(topic); setErr(null);
    try {
      await wcDisconnect(topic);
      setRows(prev => prev?.filter(r => r.topic !== topic) ?? prev);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };

  if (!rows) return <Text style={{ color: C.textMuted, fontSize: 12 }}>Loading…</Text>;
  if (rows.length === 0) return <Text style={{ color: C.textMuted, fontSize: 12 }}>No active dApp connections.</Text>;

  return (
    <ScrollView style={{ maxHeight: 360 }}>
      {err && <Text style={{ color: C.red, fontSize: 11 }}>{err}</Text>}
      {rows.map(r => (
        <View key={r.topic} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, backgroundColor: C.bgElevated, borderRadius: 10, marginBottom: 6 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 13 }}>{r.name}</Text>
            <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: C.textMuted, fontSize: 11 }}>{r.url}</Text>
            <Text style={{ color: C.textMuted, fontSize: 10, fontFamily: MONO }}>{r.chains}</Text>
          </View>
          <Pressable onPress={() => disconnect(r.topic)} disabled={busy === r.topic} style={{
            paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6,
            borderWidth: 1, borderColor: C.red, opacity: busy === r.topic ? 0.6 : 1,
          }}>
            <Text style={{ color: C.red, fontWeight: '700', fontSize: 11 }}>{busy === r.topic ? 'Disconnecting…' : 'Disconnect'}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

/* ─── Address book modal ───────────────────────────────────────────────── */
function AddressBookModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const C = useColors();
  const styles = useStyles();
  const [contacts, setContacts] = useState<AbContact[]>([]);
  const [name,     setName]     = useState('');
  const [address,  setAddress]  = useState('');
  const [err,      setErr]      = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  useEffect(() => {
    if (!visible) return;
    setContacts(loadContacts());
    syncContactsFromServer()
      .then(() => setContacts(loadContacts()))
      .catch(() => { /* offline / not authed */ });
    return onContactsChanged(() => setContacts(loadContacts()));
  }, [visible]);

  if (!visible) return null;

  const onAdd = async () => {
    setErr(null); setBusy(true);
    try {
      await addContact({ name, address });
      setName(''); setAddress('');
      setContacts(loadContacts());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add contact');
    } finally { setBusy(false); }
  };
  const onDelete = async (id: string) => {
    try { if (await deleteContact(id)) setContacts(loadContacts()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete'); }
  };

  return (
    <SheetShell title="Address book" onClose={onClose}>
      <View style={{ gap: 10 }}>
        <TextInput
          style={[styles.input, { color: C.textPrimary }]}
          placeholder="Name (e.g. Sora)"
          placeholderTextColor={C.textMuted}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={[styles.input, { color: C.textPrimary, fontFamily: address ? 'Menlo' : undefined, fontSize: address ? 12 : 14 }]}
          placeholder="0x… or litho1…"
          placeholderTextColor={C.textMuted}
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {err && <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>}
        <Pressable
          style={[styles.btnPrimary, (busy || !name.trim() || !address.trim()) && { opacity: 0.5 }]}
          onPress={onAdd}
          disabled={busy || !name.trim() || !address.trim()}
        >
          <Text style={styles.btnPrimaryText}>{busy ? 'Saving…' : 'Save contact'}</Text>
        </Pressable>

        {contacts.length > 0 && (
          <ScrollView style={{ maxHeight: 320, marginTop: 6 }}>
            {contacts.map(c => (
              <View key={c.id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10,
                backgroundColor: C.bgElevated, marginBottom: 6,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.textPrimary, fontWeight: '600', fontSize: 14 }}>
                    {c.name}
                    {c.pendingSync && <Text style={{ color: C.textMuted, fontSize: 11 }}>  · not synced</Text>}
                  </Text>
                  <Text numberOfLines={1} ellipsizeMode="middle" style={{ color: C.textMuted, fontSize: 11, fontFamily: MONO }}>
                    {c.evm}
                  </Text>
                </View>
                <Pressable onPress={() => onDelete(c.id)} style={{ padding: 6 }}>
                  <Trash2 size={16} color={C.red} strokeWidth={2}/>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SheetShell>
  );
}

/* ─── Settings sub-modals ─────────────────────────────────────────────── */

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const C = useColors();
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14, maxHeight: '88%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.textPrimary }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><Text style={{ fontSize: 22, color: C.textMuted }}>×</Text></Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function RevealPhraseModal({ visible, onClose, seed }: { visible: boolean; onClose: () => void; seed: string[] }) {
  const C = useColors();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!visible) { setShown(false); setCopied(false); } }, [visible]);
  if (!visible) return null;
  // Private-key wallets have no recovery phrase — reveal the raw key instead.
  const isPk = seed.length === 1 && /^0x[0-9a-fA-F]{64}$/.test((seed[0] ?? '').trim());
  const noun = isPk ? 'private key' : 'recovery phrase';
  return (
    <SheetShell title={isPk ? 'Private key' : 'Recovery phrase'} onClose={onClose}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} color="#f59e0b"/>
        <Text style={{ flex: 1, fontSize: 12, color: C.textSecondary, lineHeight: 18 }}>
          Anyone with your {noun} controls your funds. Never share it, and make sure no one is watching your screen.
        </Text>
      </View>
      {!shown ? (
        <Pressable onPress={() => setShown(true)} style={{ paddingVertical: 13, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>{isPk ? 'Reveal private key' : 'Reveal phrase'}</Text>
        </Pressable>
      ) : (
        <>
          {isPk ? (
            <View style={{ backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSubtle, borderRadius: 10, padding: 12 }}>
              <Text selectable style={{ color: C.textPrimary, fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{seed[0]}</Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {seed.map((w, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 6, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSubtle, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 }}>
                  <Text style={{ color: C.textMuted, fontSize: 12 }}>{i + 1}</Text>
                  <Text style={{ color: C.textPrimary, fontWeight: '600', fontSize: 13 }}>{w}</Text>
                </View>
              ))}
            </View>
          )}
          <Pressable
            onPress={() => { Clipboard.setStringAsync(seed.join(' ')).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
            style={{ paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.borderDefault, alignItems: 'center' }}
          >
            <Text style={{ color: C.textPrimary, fontWeight: '700' }}>{copied ? '✓ Copied' : (isPk ? 'Copy private key' : 'Copy phrase')}</Text>
          </Pressable>
        </>
      )}
    </SheetShell>
  );
}

function ChangePasswordModal({ visible, onClose, seed }: { visible: boolean; onClose: () => void; seed: string[] }) {
  const C = useColors();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (!visible) { setCur(''); setNext(''); setConfirm(''); setErr(''); } }, [visible]);
  if (!visible) return null;

  const submit = async () => {
    if (busy) return;
    if (next.length < 8) { setErr('New password must be at least 8 characters'); return; }
    if (next !== confirm) { setErr('New passwords don’t match'); return; }
    setBusy(true); setErr('');
    try {
      const vault = await loadVault();
      if (!vault || !(await openVault(vault, cur))) { setErr('Current password is incorrect'); setBusy(false); return; }
      await createVault(seed.join(' '), next); // re-encrypts + saves + caches key
      Alert.alert('Password updated', 'Your wallet password has been changed.');
      onClose();
    } catch (e) {
      setErr((e as Error)?.message || 'Could not change password');
    } finally { setBusy(false); }
  };

  const inputStyle = { backgroundColor: C.bgElevated, borderRadius: 12, borderWidth: 1, borderColor: C.borderDefault, paddingVertical: 12, paddingHorizontal: 14, color: C.textPrimary, fontSize: 15 };
  return (
    <SheetShell title="Change password" onClose={onClose}>
      <TextInput secureTextEntry placeholder="Current password" placeholderTextColor={C.textMuted} value={cur} onChangeText={setCur} style={inputStyle}/>
      <TextInput secureTextEntry placeholder="New password (min 8)" placeholderTextColor={C.textMuted} value={next} onChangeText={setNext} style={inputStyle}/>
      <TextInput secureTextEntry placeholder="Confirm new password" placeholderTextColor={C.textMuted} value={confirm} onChangeText={setConfirm} style={inputStyle}/>
      {!!err && <Text style={{ color: C.red, fontSize: 12 }}>{err}</Text>}
      <Pressable onPress={submit} disabled={busy} style={{ paddingVertical: 13, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? 'Updating…' : 'Update password'}</Text>
      </Pressable>
    </SheetShell>
  );
}

function AutoLockModal({ visible, current, onClose, onPick }: { visible: boolean; current: number; onClose: () => void; onPick: (m: number) => void }) {
  const C = useColors();
  if (!visible) return null;
  return (
    <SheetShell title="Auto-lock" onClose={onClose}>
      <Text style={{ fontSize: 12, color: C.textMuted }}>Lock the wallet after it’s been in the background this long.</Text>
      {AUTOLOCK_OPTIONS.map(o => (
        <Pressable key={o.minutes} onPress={() => onPick(o.minutes)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 15, color: C.textPrimary }}>{o.label}</Text>
          {current === o.minutes && <Text style={{ color: C.blue, fontWeight: '800' }}>✓</Text>}
        </Pressable>
      ))}
    </SheetShell>
  );
}

function CustomRpcModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const C = useColors();
  const [url, setUrl] = useState('');
  useEffect(() => { if (visible) AsyncStorage.getItem(PREF_CUSTOM_RPC).then(v => setUrl(v || '')); }, [visible]);
  if (!visible) return null;

  const save = async () => {
    const v = url.trim();
    if (v && !/^https?:\/\//i.test(v)) { Alert.alert('Invalid URL', 'RPC URL must start with http:// or https://'); return; }
    if (v) await AsyncStorage.setItem(PREF_CUSTOM_RPC, v); else await AsyncStorage.removeItem(PREF_CUSTOM_RPC);
    setRpcOverride(v || null);
    Alert.alert('Saved', v ? 'Custom RPC will be used (with the default as fallback).' : 'Reverted to the default Makalu RPC.');
    onClose();
  };
  const inputStyle = { backgroundColor: C.bgElevated, borderRadius: 12, borderWidth: 1, borderColor: C.borderDefault, paddingVertical: 12, paddingHorizontal: 14, color: C.textPrimary, fontSize: 14 };
  return (
    <SheetShell title="Custom RPC" onClose={onClose}>
      <Text style={{ fontSize: 12, color: C.textMuted }}>Default: https://rpc.litho.ai. Leave blank to reset.</Text>
      <TextInput placeholder="https://your-makalu-rpc" placeholderTextColor={C.textMuted} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} style={inputStyle}/>
      <Pressable onPress={save} style={{ paddingVertical: 13, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>
      </Pressable>
    </SheetShell>
  );
}

/* DNNS — register a human-readable .litho name. Mirrors apps/web's
   DnnsSection: debounced availability check, years selector, and an
   on-chain register() submitted via lib/dnns (lithic_callContract). */
function DnnsModal({ visible, onClose, ownerAddr }: { visible: boolean; onClose: () => void; ownerAddr: string }) {
  const C = useColors();
  const [name, setName]       = useState('');
  const [years, setYears]     = useState(1);
  const [avail, setAvail]     = useState<Availability | { status: 'idle' | 'checking' }>({ status: 'idle' });
  const [busy, setBusy]       = useState(false);
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [err, setErr]         = useState<string | null>(null);
  const [reverse, setReverse] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) { setName(''); setYears(1); setAvail({ status: 'idle' }); setBusy(false); setTxHash(null); setErr(null); }
  }, [visible]);

  // "You currently own X.litho" hint.
  useEffect(() => {
    if (!visible || !/^0x[0-9a-fA-F]{40}$/.test(ownerAddr)) { setReverse(null); return; }
    let cancelled = false;
    reverseLookupDnns(ownerAddr).then(n => { if (!cancelled) setReverse(n); });
    return () => { cancelled = true; };
  }, [visible, ownerAddr]);

  // Debounced availability check.
  useEffect(() => {
    const v = name.trim().toLowerCase();
    setErr(null); setTxHash(null);
    if (!/^[a-z0-9-]+\.litho$/.test(v)) { setAvail({ status: 'idle' }); return; }
    setAvail({ status: 'checking' });
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await checkDnnsAvailability(v);
      if (!cancelled) setAvail(r);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name]);

  if (!visible) return null;

  const onRegister = async () => {
    setErr(null); setTxHash(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(ownerAddr)) { setErr('Unlock your wallet first.'); return; }
    if (avail.status !== 'available') { setErr('Pick an available name first.'); return; }
    setBusy(true);
    try {
      const hash = await registerDnnsName({ name: name.trim().toLowerCase(), owner: ownerAddr, years });
      setTxHash(hash);
      setName('');
    } catch (e) {
      setErr((e as Error).message || 'Registration failed.');
    } finally { setBusy(false); }
  };

  const inputStyle = { backgroundColor: C.bgElevated, borderRadius: 12, borderWidth: 1, borderColor: C.borderDefault, paddingVertical: 12, paddingHorizontal: 14, color: C.textPrimary, fontSize: 15 } as const;
  const canRegister = avail.status === 'available' && !busy;

  return (
    <SheetShell title="Lithosphere names (.litho)" onClose={onClose}>
      <Text style={{ fontSize: 12, color: C.textMuted }}>Register a human-readable name for your wallet.</Text>

      {reverse && (
        <View style={{ backgroundColor: C.bgElevated, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontSize: 12, color: C.textSecondary }}>You currently own <Text style={{ color: C.textPrimary, fontWeight: '700' }}>{reverse}</Text></Text>
        </View>
      )}

      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, color: C.textMuted }}>NAME</Text>
      <TextInput
        placeholder="alice.litho"
        placeholderTextColor={C.textMuted}
        value={name}
        onChangeText={t => setName(t.toLowerCase())}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={inputStyle}
      />
      {avail.status === 'checking'  && <Text style={{ fontSize: 11, color: C.textMuted }}>Checking availability…</Text>}
      {avail.status === 'available' && <Text style={{ fontSize: 11, color: C.green }}>✓ Available</Text>}
      {avail.status === 'taken'     && <Text style={{ fontSize: 11, color: C.yellow }} numberOfLines={1}>Taken — owned by {avail.address.slice(0, 10)}…</Text>}
      {avail.status === 'error'     && name.trim().length > 0 && <Text style={{ fontSize: 11, color: C.textMuted }}>Couldn’t check — try again.</Text>}

      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, color: C.textMuted }}>YEARS</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[1, 2, 3, 5].map(y => (
          <Pressable
            key={y}
            onPress={() => setYears(y)}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: years === y ? C.blue : C.borderDefault, backgroundColor: years === y ? C.blueDim : 'transparent' }}
          >
            <Text style={{ color: years === y ? C.blue : C.textSecondary, fontWeight: '700', fontSize: 13 }}>{y}y</Text>
          </Pressable>
        ))}
      </View>

      {err && <Text style={{ fontSize: 12, color: C.red }}>{err}</Text>}
      {txHash && <Text style={{ fontSize: 12, color: C.green }} numberOfLines={1}>Registration submitted · {txHash.slice(0, 16)}…</Text>}

      <Pressable
        onPress={onRegister}
        disabled={!canRegister}
        style={{ paddingVertical: 13, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', opacity: canRegister ? 1 : 0.45 }}
      >
        <Text style={{ color: '#fff', fontWeight: '700' }}>
          {busy ? 'Submitting…' : avail.status === 'taken' ? 'Not available' : 'Register name'}
        </Text>
      </Pressable>
    </SheetShell>
  );
}

/* Cloud account — optional sign-in for cross-device sync (address book,
   preferences). Mirrors apps/web's AccountView: login / create toggle over
   the same apiClient (login/register/me/logout). The wallet itself stays
   self-custodial and device-local — this only links an optional sync account. */
function AccountModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const C = useColors();
  const [me, setMe]           = useState<AuthUser | null>(null);
  const [mode, setMode]       = useState<'login' | 'register'>('login');
  const [email, setEmail]     = useState('');
  const [password, setPwd]    = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  useEffect(() => {
    if (!visible) { setEmail(''); setPwd(''); setErr(null); return; }
    (async () => {
      try {
        if (await apiClient.isAuthenticated()) setMe(await apiClient.me());
      } catch { /* stale token — treat as logged out */ }
    })();
  }, [visible]);

  if (!visible) return null;

  const submit = async () => {
    if (busy) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr('Enter a valid email.'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = mode === 'login'
        ? await apiClient.login({ email: email.trim(), password })
        : await apiClient.register({ email: email.trim(), password });
      setMe(res.user);
      setEmail(''); setPwd('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true);
    try { await apiClient.logout(); } finally { setMe(null); setBusy(false); }
  };

  const inputStyle = { backgroundColor: C.bgElevated, borderRadius: 12, borderWidth: 1, borderColor: C.borderDefault, paddingVertical: 12, paddingHorizontal: 14, color: C.textPrimary, fontSize: 15 } as const;

  if (me) {
    return (
      <SheetShell title="Cloud account" onClose={onClose}>
        <View style={{ backgroundColor: C.bgElevated, borderRadius: 12, padding: 14, gap: 4 }}>
          <Text style={{ fontSize: 12, color: C.textMuted }}>Signed in as</Text>
          <Text style={{ fontSize: 15, color: C.textPrimary, fontWeight: '700' }}>{me.email}</Text>
        </View>
        <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 18 }}>
          Your address book and preferences sync across devices. The wallet keys never leave this device.
        </Text>
        <Pressable onPress={logout} disabled={busy} style={{ paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.borderDefault, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
          <Text style={{ color: C.textPrimary, fontWeight: '700' }}>{busy ? '…' : 'Sign out'}</Text>
        </Pressable>
      </SheetShell>
    );
  }

  return (
    <SheetShell title="Cloud account" onClose={onClose}>
      <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 18 }}>
        Optional — link a cloud account to sync your address book and preferences across devices. Your wallet stays self-custodial.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['login', 'register'] as const).map(m => (
          <Pressable
            key={m}
            onPress={() => { setMode(m); setErr(null); }}
            style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: mode === m ? C.blue : C.borderDefault, backgroundColor: mode === m ? C.blueDim : 'transparent' }}
          >
            <Text style={{ color: mode === m ? C.blue : C.textSecondary, fontWeight: '700', fontSize: 13 }}>{m === 'login' ? 'Sign in' : 'Create'}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput placeholder="email@example.com" placeholderTextColor={C.textMuted} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={inputStyle}/>
      <TextInput placeholder="Password (min 8 characters)" placeholderTextColor={C.textMuted} value={password} onChangeText={setPwd} secureTextEntry style={inputStyle}/>
      {err && <Text style={{ fontSize: 12, color: C.red }}>{err}</Text>}
      <Pressable onPress={submit} disabled={busy} style={{ paddingVertical: 13, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center', opacity: busy ? 0.5 : 1 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? 'Please wait…' : (mode === 'login' ? 'Sign in' : 'Create account')}</Text>
      </Pressable>
    </SheetShell>
  );
}

/* ─────────────────────────── Token detail ─────────────────────────── */

const TD_PROXY_FEEDS: Record<string, string> = { LitBTC: 'Bitcoin (BTC) — LitBTC is its wrapped form on Makalu' };
const TD_RANGES: Array<{ key: TokenRange; label: string }> = [
  { key: '1d', label: '1D' }, { key: '1w', label: '1W' }, { key: '1m', label: '1M' },
  { key: '3m', label: '3M' }, { key: '1y', label: '1Y' },
];
function tdCompact(n: number | null): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
function tdCompactQty(n: number | null): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
/** Build a standalone SVG document string for SvgXml from price pairs. */
function tdChartSvg(prices: Array<[number, number]>, w: number, h: number, stroke: string): string | null {
  if (prices.length < 2) return null;
  const vals = prices.map(p => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
  const dx = w / (prices.length - 1);
  const pts = vals.map((v, i) => `${(i * dx).toFixed(1)},${(span === 0 ? h / 2 : h - 6 - ((v - min) / span) * (h - 12)).toFixed(1)}`);
  const line = `M${pts.join(' L')}`;
  const area = `${line} L${w},${h} L0,${h} Z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`
    + `<path d="${area}" fill="${stroke}" fill-opacity="0.15"/>`
    + `<path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function TokenDetailScreen({ sym, goBack, onSend, onReceive, onSwap }: {
  sym: string; goBack: () => void; onSend: () => void; onReceive: () => void; onSwap: () => void;
}) {
  const C = useColors();
  const addr = useWalletAddr();
  const seed = useWalletSeed();
  const { assets } = usePortfolio(addr, seed);
  const { items, loading: actLoading, offline: actOffline } = useActivity(addr);
  const coin = assets.find(a => a.sym.toLowerCase() === sym.toLowerCase());
  const price = coin?.priceUsd ?? 0;
  const isMakalu = !!coin && !coin.native && !!coin.tokenAddress;
  const network = coin?.sym === 'BTC' ? 'Bitcoin' : coin?.sym === 'SOL' ? 'Solana' : coin?.sym === 'ATOM' ? 'Cosmos Hub' : 'Lithosphere Makalu';
  const [range, setRange] = useState<TokenRange>('1d');
  const [hist, setHist] = useState<TokenHistory | null>(null);
  const [histLoading, setHistLoading] = useState(true);
  useEffect(() => {
    let cancel = false; setHistLoading(true);
    fetchTokenHistory(sym, range).then(h => { if (!cancel) { setHist(h); setHistLoading(false); } }).catch(() => { if (!cancel) { setHist(null); setHistLoading(false); } });
    return () => { cancel = true; };
  }, [sym, range]);
  const [market, setMarket] = useState<TokenMarketDetails | null>(null);
  useEffect(() => {
    let cancel = false;
    fetchTokenMarketDetails(sym).then(d => { if (!cancel) setMarket(d); }).catch(() => {});
    return () => { cancel = true; };
  }, [sym]);
  const rows = items.filter(t => t.symbol.toLowerCase() === sym.toLowerCase()).slice(0, 8);
  const W = 340, H = 150;
  const up = (hist?.changePct ?? 0) >= 0;
  const svg = hist?.hasRealData ? tdChartSvg(hist.prices, W, H, up ? C.green : C.red) : null;
  const [copied, setCopied] = useState(false);
  const proxy = TD_PROXY_FEEDS[sym];

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderSubtle }}>
      <Text style={{ color: C.textMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: C.textPrimary, fontWeight: '600', fontSize: 13 }}>{children}</Text>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bgCard }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: C.borderSubtle }}>
        <Pressable onPress={goBack} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.textPrimary, fontSize: 22 }}>‹</Text>
        </Pressable>
        <Avatar symbol={sym} color={coin?.color ?? '#52525b'} size={26}/>
        <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 15, marginLeft: 8 }}>{coin?.name ?? sym} ({sym})</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text style={{ color: C.textPrimary, fontSize: 30, fontWeight: '800', fontFamily: MONO }}>{price > 0 ? formatUsd(price) : '—'}</Text>
        {proxy && <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>Price &amp; market data track {proxy}.</Text>}

        <View style={{ marginVertical: 14, minHeight: H }}>
          {histLoading && <View style={{ height: H, borderRadius: 12, backgroundColor: C.bgElevated }}/>}
          {!histLoading && svg && <SvgXml xml={svg} width="100%" height={H}/>}
          {!histLoading && !svg && (
            <View style={{ height: H, borderRadius: 12, backgroundColor: C.bgElevated, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
              <Text style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                {hist?.failed ? 'Chart temporarily unavailable. Try again shortly.' : `No price history for ${sym} yet.`}
              </Text>
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 16 }}>
          {TD_RANGES.map(r => (
            <Pressable key={r.key} onPress={() => setRange(r.key)} style={{ flex: 1, paddingVertical: 7, borderRadius: 8, backgroundColor: range === r.key ? C.bgElevated : 'transparent', alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: range === r.key ? C.textPrimary : C.textMuted }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
          <Pressable onPress={() => Alert.alert('Buy', 'Card on-ramp (Transak) is coming soon. For now, receive into this wallet or get testnet LITHO from the faucet.')} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.borderSubtle, alignItems: 'center' }}>
            <Text style={{ color: C.textPrimary, fontWeight: '700' }}>Buy</Text>
          </Pressable>
          <Pressable onPress={onSend} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.borderSubtle, alignItems: 'center' }}>
            <Text style={{ color: C.textPrimary, fontWeight: '700' }}>Send</Text>
          </Pressable>
          <Pressable onPress={onReceive} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.borderSubtle, alignItems: 'center' }}>
            <Text style={{ color: C.textPrimary, fontWeight: '700' }}>Receive</Text>
          </Pressable>
          {isMakalu && (
            <Pressable onPress={onSwap} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: C.borderSubtle, alignItems: 'center' }}>
              <Text style={{ color: C.textPrimary, fontWeight: '700' }}>Swap</Text>
            </Pressable>
          )}
        </View>

        <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: 4 }}>Your balance</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginBottom: 8 }}>
          <Avatar symbol={sym} color={coin?.color ?? '#52525b'} size={34}/>
          <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 14, marginLeft: 10, flex: 1 }}>{coin?.name ?? sym}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 14 }}>{coin ? formatUsd(coin.usdValue) : '—'}</Text>
            <Text style={{ color: C.textMuted, fontSize: 11, fontFamily: MONO }}>{coin?.balanceText ?? '0'} {sym}</Text>
          </View>
        </View>

        <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 10, marginBottom: 2 }}>Token details</Text>
        <Row label="Network">{network}</Row>
        {coin?.tokenAddress ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderSubtle }}>
            <Text style={{ color: C.textMuted, fontSize: 13 }}>Contract</Text>
            <Pressable onPress={() => {
              Share.share({ message: coin.tokenAddress! })
                .then(r => { if (r.action === Share.sharedAction) { setCopied(true); setTimeout(() => setCopied(false), 1800); } })
                .catch(() => {});
            }}>
              <HiAddr value={coin.tokenAddress} head={6} tail={6} style={{ fontSize: 12 }}/>
            </Pressable>
          </View>
        ) : <Row label="Contract">{coin?.native ? 'Native coin' : '—'}</Row>}
        <Row label="Decimals">{coin?.decimals ?? 18}</Row>
        {copied && <Text style={{ color: C.textMuted, fontSize: 10, marginTop: 4 }}>Address shared.</Text>}

        <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 16, marginBottom: 2 }}>Market details</Text>
        {proxy && <Text style={{ color: C.textMuted, fontSize: 10, marginVertical: 2 }}>Figures below are for {proxy}.</Text>}
        <Row label="Market cap">{tdCompact(market?.marketCapUsd ?? null)}</Row>
        <Row label="Total volume">{tdCompact(market?.totalVolumeUsd ?? null)}</Row>
        <Row label="Circulating supply">{tdCompactQty(market?.circulatingSupply ?? null)}</Row>
        <Row label="All-time high">{market?.athUsd != null ? formatUsd(market.athUsd) : '—'}</Row>
        <Row label="All-time low">{market?.atlUsd != null ? formatUsd(market.atlUsd) : '—'}</Row>

        <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '800', marginTop: 16, marginBottom: 6 }}>Your activity</Text>
        {actLoading && <Text style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 14 }}>Loading activity…</Text>}
        {!actLoading && actOffline && <Text style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 14 }}>Activity unavailable — indexer offline.</Text>}
        {!actLoading && !actOffline && rows.length === 0 && <Text style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 14 }}>No {sym} activity yet.</Text>}
        {rows.map(t => {
          const d = txDisplay(t.type);
          return (
            <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.borderSubtle }}>
              <View>
                <Text style={{ color: C.textPrimary, fontWeight: '600', fontSize: 13 }}>{d.label}</Text>
                <Text style={{ color: C.textMuted, fontSize: 11 }}>{t.ts ? new Date(t.ts).toLocaleDateString() : '—'}</Text>
              </View>
              <Text style={{ color: d.positive ? C.green : C.textSecondary, fontFamily: MONO, fontSize: 12 }}>
                {(() => { try { const n = parseFloat(formatUnits(t.amount, coin?.decimals ?? 18)); return `${d.positive ? '+' : '-'}${n.toLocaleString('en-US', { maximumFractionDigits: 6 })}`; } catch { return t.amount; } })()} {sym}
              </Text>
            </View>
          );
        })}
        <View style={{ height: 24 }}/>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────── Shell ─────────────────────────── */

type Screen = 'home' | 'send' | 'receive' | 'swap' | 'discover' | 'activity' | 'settings' | 'earn' | 'market' | 'assets' | 'nfts';

const TABS: { key: Screen; label: string; Icon: any }[] = [
  { key: 'home',     label: 'Home',     Icon: Home },
  { key: 'market',   label: 'Market',   Icon: TrendingUp },
  { key: 'swap',     label: 'Swap',     Icon: Repeat },
  { key: 'discover', label: 'Discover', Icon: Compass },
  { key: 'activity', label: 'Activity', Icon: Clock },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/* ─────────────────── Wallet helpers ─────────────────── */

function generateMnemonic(wordCount: 12 | 24 = 12): string[] {
  try {
    // 16 bytes (128-bit) -> 12 words, 32 bytes (256-bit) -> 24 words. Uses
    // the platform CSPRNG via react-native-get-random-values (polyfilled at
    // app boot). Mirrors the web client's generateMnemonic(wordCount).
    const entropy = randomBytes(wordCount === 24 ? 32 : 16);
    return Mnemonic.fromEntropy(entropy).phrase.split(' ');
  } catch (e) {
    console.error('generateMnemonic failed:', e);
    Alert.alert('Crypto unavailable', 'Could not generate a secure random seed on this device. ' + String(e));
    return [];
  }
}

function isValidMnemonic(phrase: string): boolean {
  try { Mnemonic.fromPhrase(phrase.trim().toLowerCase()); return true; }
  catch { return false; }
}

// A wallet imported by raw private key is carried as a single-element seed
// `['0x<64 hex>']`. It's EVM-only (a bare EVM key can't derive BTC/SOL/Cosmos
// addresses) and single-account (no HD derivation), so the UI gates non-EVM
// chains + "add account" on this.
const PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;
function isPrivateKeyWallet(seed: string[]): boolean {
  return seed.length === 1 && PRIVATE_KEY_RE.test(seed[0].trim());
}

function deriveEvmAddress(seed: string[], accountIdx = 0): string {
  try {
    if (isPrivateKeyWallet(seed)) return new Wallet(seed[0].trim()).address; // PK = single account
    return HDNodeWallet.fromPhrase(seed.join(' '), undefined, `m/44'/60'/0'/0/${accountIdx}`).address;
  } catch { return '0x0000000000000000000000000000000000000000'; }
}

// Storage keys live in ./lib/vault.ts now — these legacy AsyncStorage keys
// are only referenced by migrateLegacyPlaintext() and get wiped on first run.

/* User preferences (plaintext, non-sensitive). */
const PREF_AUTOLOCK = 'thanos.autolock_minutes'; // '0' = never
const PREF_CUSTOM_RPC = 'thanos.custom_rpc';
const PREF_CURRENCY = 'thanos.display_currency'; // display currency code
const PREF_LANGUAGE = 'thanos.language';         // interface language
// Display-currency + language options mirror apps/web's Settings (General).
// Like the web, these are display preferences — prices stream in USD and the
// UI is English; the choice is persisted and surfaced, full FX conversion /
// i18n land with a later slice.
const CURRENCY_OPTS  = ['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'LAX'];
const LANGUAGE_OPTS  = ['English', 'Spanish', 'Arabic'];
const AUTOLOCK_OPTIONS = [
  { label: '1 minute',   minutes: 1 },
  { label: '5 minutes',  minutes: 5 },
  { label: '15 minutes', minutes: 15 },
  { label: '1 hour',     minutes: 60 },
  { label: 'Never',      minutes: 0 },
];

/* ─────────────────── Onboarding ─────────────────── */

type OnboardStep = 'welcome' | 'create-length' | 'create-warn' | 'create-show' | 'create-confirm'
                 | 'create-pwd' | 'import-choose' | 'import' | 'import-pk' | 'import-pwd' | 'unlock';

function OnboardingScreen({
  hasVault,
  onComplete,
}: { hasVault: boolean; onComplete: (seed: string[]) => void }) {
  const C = useColors();
  const styles = useStyles();
  const [step, setStep] = useState<OnboardStep>(hasVault ? 'unlock' : 'welcome');
  const [seed, setSeed] = useState<string[]>([]);
  const [phraseLen, setPhraseLen] = useState<12 | 24>(12);
  // Engage Android FLAG_SECURE + iOS screenshot-detection on every step
  // that displays sensitive material (the user's mnemonic). Steps that
  // only ask for the password don't need it. Active flag pivots on
  // step, so the lock+unlock paths in `unlock` stay screenshot-able.
  useScreenProtect(step === 'create-show' || step === 'create-confirm' || step === 'import' || step === 'import-pk');
  const [importInput, setImportInput] = useState('');
  const [pkInput, setPkInput] = useState('');
  // Which import path the password step is finishing (phrase vs raw key).
  const [importKind, setImportKind] = useState<'phrase' | 'privateKey'>('phrase');
  /* Verify-phrase: only N indices missing; user fills them from a pool */
  const VERIFY_MISSING = 4;
  const [missingIdxs, setMissingIdxs] = useState<number[]>([]);
  const [verifyPicks, setVerifyPicks] = useState<Record<number, string>>({});
  const [verifyPool,  setVerifyPool]  = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [unlockPwd, setUnlockPwd] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [copiedSeed, setCopiedSeed] = useState(false);

  /* Biometric unlock availability for the unlock step. Probed once on
     mount; if a protected-key slot exists and the device can prompt,
     the unlock step shows a Face ID / Fingerprint button alongside the
     password input. */
  const [bioAvail, setBioAvail] = useState<{ kind: BiometricKind; on: boolean }>({ kind: 'none', on: false });
  useEffect(() => {
    if (!hasVault) return;
    (async () => {
      const cap = await getBiometricCapability();
      const on  = await isBiometricUnlockEnabled();
      setBioAvail({
        kind: cap.kind,
        on:   on && cap.hasHardware && cap.isEnrolled,
      });
    })();
  }, [hasVault]);

  // Length is chosen on the create-length step (parity with web/desktop);
  // generate the seed for the picked word count, then go to the warning.
  const pickLength = (n: 12 | 24) => { setPhraseLen(n); setSeed(generateMnemonic(n)); setStep('create-warn'); };

  const goToVerify = () => {
    const idxs = Array.from({ length: seed.length }, (_, i) => i)
      .sort(() => Math.random() - 0.5).slice(0, VERIFY_MISSING).sort((a, b) => a - b);
    setMissingIdxs(idxs);
    setVerifyPicks({});
    setVerifyPool(idxs.map(i => seed[i]).sort(() => Math.random() - 0.5));
    setStep('create-confirm');
  };
  const pickWord = (w: string) => {
    const nextEmpty = missingIdxs.find(i => verifyPicks[i] === undefined);
    if (nextEmpty === undefined) return;
    setVerifyPicks(prev => ({ ...prev, [nextEmpty]: w }));
    setVerifyPool(prev => {
      const i = prev.indexOf(w);
      return i === -1 ? prev : [...prev.slice(0, i), ...prev.slice(i + 1)];
    });
  };
  const unpickAt = (slotIdx: number) => {
    const w = verifyPicks[slotIdx];
    if (w === undefined) return;
    setVerifyPicks(prev => { const next = { ...prev }; delete next[slotIdx]; return next; });
    setVerifyPool(prev => [...prev, w]);
  };
  const allConfirmed = missingIdxs.length > 0 && missingIdxs.every(i => verifyPicks[i] === seed[i]);
  const orderMismatch = missingIdxs.length > 0 && missingIdxs.every(i => verifyPicks[i] !== undefined) && !allConfirmed;

  const [busy, setBusy] = useState(false);

  const finishCreate = async () => {
    if (password !== password2 || password.length < 8 || busy) return;
    setBusy(true);
    try {
      await createVault(seed.join(' '), password);
      await setSeedBackedUp(true); // create flow includes seed verification
      // createVault session-caches the key internally.
      onComplete(seed);
    } finally { setBusy(false); }
  };

  const finishImport = async () => {
    if (password !== password2 || password.length < 8 || busy) return;

    // ── Private-key import ── stored as a single-element seed ['0x…']; the
    // vault holds the raw key, and deriveEvmAddress / lib/signer detect the
    // shape. EVM-only, single account.
    if (importKind === 'privateKey') {
      const hex = pkInput.trim().toLowerCase().replace(/^0x/, '');
      if (!/^[0-9a-f]{64}$/.test(hex)) {
        Alert.alert('Invalid private key', 'Enter a 64-character hex private key (with or without the 0x prefix).');
        return;
      }
      const key = `0x${hex}`;
      try { new Wallet(key); } catch { Alert.alert('Invalid private key', 'That private key could not be parsed.'); return; }
      setBusy(true);
      try {
        await createVault(key, password);
        await setSeedBackedUp(true); // no phrase to back up — user holds the key
        onComplete([key]);
      } finally { setBusy(false); }
      return;
    }

    // ── Recovery-phrase import ──
    const words = importInput.trim().toLowerCase().split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) return;
    if (!isValidMnemonic(words.join(' '))) {
      Alert.alert('Invalid phrase', "That recovery phrase isn't valid.");
      return;
    }
    setBusy(true);
    try {
      await createVault(words.join(' '), password);
      await setSeedBackedUp(true); // imported — user already holds the phrase
      onComplete(words);
    } finally { setBusy(false); }
  };

  const tryUnlock = async () => {
    if (busy) return;
    setBusy(true);
    setUnlockErr('');
    try {
      const vault = await loadVault();
      if (!vault) {
        setUnlockErr('No wallet on this device.');
        return;
      }
      const opened = await openVault(vault, unlockPwd);
      if (!opened) {
        setUnlockErr('Incorrect password');
        setUnlockPwd('');
        return;
      }
      cacheSessionKey(opened.key);
      onComplete(opened.mnemonic.split(' '));
    } finally { setBusy(false); }
  };

  /* Biometric path — reads the OS-protected stash of the derived AES
     key, then decrypts the vault with it. No Argon2id round-trip. */
  const tryBiometricUnlock = async () => {
    if (busy) return;
    setBusy(true);
    setUnlockErr('');
    try {
      const vault = await loadVault();
      if (!vault) { setUnlockErr('No wallet on this device.'); return; }
      const key = await readProtectedKey();
      if (!key) {
        setUnlockErr('Biometric unlock cancelled.');
        return;
      }
      const mnemonic = await openVaultWithKey(vault, key);
      if (!mnemonic) {
        setUnlockErr('Stored key is invalid — please enter your password.');
        return;
      }
      cacheSessionKey(key);
      onComplete(mnemonic.split(' '));
    } finally { setBusy(false); }
  };

  const resetWallet = async () => {
    await clearVaultStore();
    // Also wipe the biometric-protected key — it pointed at the now-
    // deleted vault. Future re-onboarding starts a fresh enrolment.
    await disableBiometricUnlock();
    setStep('welcome');
    setUnlockPwd('');
    setUnlockErr('');
  };

  return (
    <ScrollView
      style={[styles.scroll, { backgroundColor: C.bgBase }]}
      contentContainerStyle={styles.onboardWrap}
      // CRITICAL: without this, when the keyboard is open (password / import
      // steps) the FIRST tap on a button is swallowed to just dismiss the
      // keyboard — so Back / Create wallet / Import appeared "not clickable."
      // "handled" lets the button's onPress fire on the first tap.
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.onboardCard}>
        {/* The logo image is a full lockup (mark + "Thanos Wallet" +
            "AI-POWERED WEB3 EXPERIENCE"), same asset the web login uses.
            Render it large like the web (no separate brand text — that would
            duplicate the wordmark in the image). */}
        <View style={styles.onboardLogo}>
          <View style={styles.onboardLogoGlow}/>
          <Image
            source={require('./assets/images/Thanos_Logo_Transparent.png')}
            style={styles.onboardLogoImage}
            resizeMode="contain"
          />
        </View>

        <AnimatedSwitch keyName={step} style={{ width: '100%' }}>

        {step === 'welcome' && <>
          <Text style={styles.onboardTitle}>Welcome to Thanos</Text>
          <Text style={styles.onboardSub}>Multi-chain Web4 wallet. Lithosphere · Bitcoin · EVM.</Text>
          <Pressable style={styles.btnPrimary} onPress={() => setStep('create-length')}>
            <Text style={styles.btnPrimaryText}>Create new wallet</Text>
          </Pressable>
          <Pressable style={styles.btnOutline} onPress={() => setStep('import-choose')}>
            <Text style={styles.btnOutlineText}>Import existing wallet</Text>
          </Pressable>
        </>}

        {step === 'import-choose' && <>
          <Text style={styles.onboardTitle}>Import wallet</Text>
          <Text style={styles.onboardSub}>Restore from a recovery phrase, or import a single account from its private key.</Text>
          <Pressable
            onPress={() => { setImportKind('phrase'); setStep('import'); }}
            style={{ borderRadius: 16, padding: 16, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderDefault, marginTop: 4 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' }}>
                <Key size={18} color={C.blue}/>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>Recovery phrase</Text>
                <Text style={{ color: C.textMuted, fontSize: 12 }}>12–24 words · full multi-chain wallet</Text>
              </View>
              <ChevronRight size={18} color={C.textMuted}/>
            </View>
          </Pressable>
          <Pressable
            onPress={() => { setImportKind('privateKey'); setStep('import-pk'); }}
            style={{ borderRadius: 16, padding: 16, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderDefault }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={18} color={C.blue}/>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700' }}>Private key</Text>
                <Text style={{ color: C.textMuted, fontSize: 12 }}>Single EVM account (Makalu) · no BTC/SOL/Cosmos</Text>
              </View>
              <ChevronRight size={18} color={C.textMuted}/>
            </View>
          </Pressable>
          <Pressable style={styles.btnOutline} onPress={() => setStep('welcome')}>
            <Text style={styles.btnOutlineText}>Back</Text>
          </Pressable>
        </>}

        {step === 'import-pk' && <>
          <Text style={styles.onboardTitle}>Import private key</Text>
          <Text style={styles.onboardSub}>Paste a 64-character hex private key (with or without the 0x prefix). This imports one EVM account on Makalu.</Text>
          <TextInput
            style={[styles.input, { height: 84, textAlignVertical: 'top' }]}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={false}
            placeholder="0x…"
            placeholderTextColor={C.textMuted}
            value={pkInput}
            onChangeText={setPkInput}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Pressable style={[styles.btnOutline, { flex: 1, marginTop: 0 }]} onPress={() => setStep('import-choose')}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1, marginTop: 0, opacity: /^(0x)?[0-9a-fA-F]{64}$/.test(pkInput.trim()) ? 1 : 0.45 }]}
              disabled={!/^(0x)?[0-9a-fA-F]{64}$/.test(pkInput.trim())}
              onPress={() => { setImportKind('privateKey'); setStep('import-pwd'); }}
            >
              <Text style={styles.btnPrimaryText}>Continue</Text>
            </Pressable>
          </View>
        </>}

        {step === 'create-length' && <>
          <Text style={styles.onboardTitle}>Choose phrase length</Text>
          <Text style={styles.onboardSub}>How many words do you want your recovery phrase to be? Both are secure — 24 words just adds extra entropy.</Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 4 }}>
            {([12, 24] as const).map((n) => (
              <Pressable
                key={n}
                onPress={() => pickLength(n)}
                style={{
                  flex: 1, borderRadius: 16, paddingVertical: 20, paddingHorizontal: 12, alignItems: 'center',
                  backgroundColor: phraseLen === n ? C.blueDim : C.bgElevated,
                  borderWidth: 1, borderColor: phraseLen === n ? C.blue : C.borderDefault,
                }}
              >
                <Text style={{ color: C.blue, fontSize: 34, fontWeight: '800' }}>{n}</Text>
                <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '700', marginTop: 2 }}>words</Text>
                <Text style={{ color: C.textMuted, fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 15 }}>
                  {n === 12 ? 'Recommended · 128-bit entropy' : 'Advanced · 256-bit entropy'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.btnOutline} onPress={() => setStep('welcome')}>
            <Text style={styles.btnOutlineText}>Back</Text>
          </Pressable>
        </>}

        {step === 'create-warn' && <>
          <Text style={styles.onboardTitle}>Save your recovery phrase</Text>
          <Text style={styles.onboardSub}>{`These ${phraseLen} words are the only way to restore your wallet. Anyone with them has full access. Never share them online.`}</Text>
          <View style={styles.warnList}>
            <Text style={styles.warnItem}>✓  Write them down on paper</Text>
            <Text style={styles.warnItem}>✓  Keep them somewhere private</Text>
            <Text style={styles.warnItem}>✓  Thanos will never ask for this phrase</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[styles.btnOutline, { flex: 0.8, marginTop: 0 }]} onPress={() => setStep('welcome')}>
              <Text style={styles.btnOutlineText} numberOfLines={1}>Back</Text>
            </Pressable>
            <Pressable style={[styles.btnPrimary, { flex: 1.2, marginTop: 0 }]} onPress={() => setStep('create-show')}>
              <Text style={styles.btnPrimaryText} numberOfLines={1} adjustsFontSizeToFit>I understand</Text>
            </Pressable>
          </View>
        </>}

        {step === 'create-show' && <>
          <Text style={styles.onboardTitle}>Your recovery phrase</Text>
          <Text style={styles.onboardSub}>{`Write these ${phraseLen} words down in order. Long-press any word to select, or tap Copy below.`}</Text>
          <View style={styles.seedGrid}>
            {seed.map((w, i) => (
              <View key={i} style={styles.seedWord}>
                <Text style={styles.seedNum}>{i + 1}.</Text>
                <Text style={styles.seedText} selectable>{w}</Text>
              </View>
            ))}
          </View>

          {/* Hidden selectable text containing the full phrase — long-press to select */}
          <View style={styles.copyableBox}>
            <Text style={styles.copyableText} selectable>
              {seed.join(' ')}
            </Text>
          </View>

          <Pressable
            style={styles.copyPhraseBtn}
            onPress={async () => {
              try {
                const Clipboard = require('expo-clipboard');
                await Clipboard.setStringAsync(seed.join(' '));
                setCopiedSeed(true);
                setTimeout(() => setCopiedSeed(false), 2200);
              } catch {
                Alert.alert('Copy unavailable', 'Long-press any word above to select and copy manually.');
              }
            }}
          >
            <Copy size={14} color={C.blue} strokeWidth={2.4}/>
            <Text style={styles.copyPhraseBtnText}>{copiedSeed ? '✓ Copied to clipboard' : 'Copy phrase'}</Text>
          </Pressable>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Pressable style={[styles.btnOutline, { flex: 1, marginTop: 0 }]} onPress={() => setStep('create-warn')}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </Pressable>
            <Pressable style={[styles.btnPrimary, { flex: 1, marginTop: 0 }]} onPress={goToVerify}>
              <Text style={styles.btnPrimaryText}>I've saved it</Text>
            </Pressable>
          </View>
        </>}

        {step === 'create-confirm' && <>
          <Text style={styles.onboardTitle}>Verify your phrase</Text>
          <Text style={styles.onboardSub}>Fill in the {VERIFY_MISSING} missing words from the pool below. Tap a slot to undo.</Text>
          <View style={styles.seedGrid}>
            {seed.map((word, i) => {
              const isMissing = missingIdxs.includes(i);
              const picked = verifyPicks[i];
              const filled = picked !== undefined;
              const wrong = orderMismatch && filled && seed[i] !== picked;
              if (!isMissing) {
                return (
                  <View key={i} style={[styles.seedWord, { opacity: 0.5 }]}>
                    <Text style={styles.seedNum}>{i + 1}.</Text>
                    <Text style={styles.seedText}>{word}</Text>
                  </View>
                );
              }
              return (
                <Pressable
                  key={i}
                  onPress={() => filled && unpickAt(i)}
                  style={[
                    styles.seedWord,
                    {
                      borderStyle: filled ? 'solid' : 'dashed',
                      borderColor: wrong ? C.red : (filled ? C.blue : C.borderDefault),
                      backgroundColor: wrong
                        ? 'rgba(248,113,113,0.10)'
                        : (filled ? 'rgba(59,122,247,0.10)' : 'transparent'),
                      minHeight: 32,
                    },
                  ]}
                >
                  <Text style={styles.seedNum}>{i + 1}.</Text>
                  <Text style={styles.seedText}>{picked ?? ' '}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 10, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: C.borderSubtle, backgroundColor: 'rgba(0,0,0,0.05)' }}>
            {verifyPool.map((w, i) => (
              <Pressable
                key={`${w}-${i}`}
                onPress={() => pickWord(w)}
                style={{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.bgElevated, borderColor: C.borderDefault, borderWidth: 1, borderRadius: 999 }}
              >
                <Text style={{ color: C.textPrimary, fontFamily: MONO, fontSize: 12, fontWeight: '600' }}>{w}</Text>
              </Pressable>
            ))}
          </View>
          {orderMismatch && <Text style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>Order doesn't match. Tap slots to undo.</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[styles.btnOutline, { flex: 1, marginTop: 0 }]} onPress={() => setStep('create-show')}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1, marginTop: 0, opacity: allConfirmed ? 1 : 0.45 }]}
              disabled={!allConfirmed}
              onPress={() => setStep('create-pwd')}
            >
              <Text style={styles.btnPrimaryText}>Continue</Text>
            </Pressable>
          </View>
        </>}

        {(step === 'create-pwd' || step === 'import-pwd') && <>
          <Text style={styles.onboardTitle}>Set a password</Text>
          <Text style={styles.onboardSub}>Used to unlock your wallet on this device. Min 8 characters.</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={C.textMuted}
            value={password}
            onChangeText={setPassword}
          />
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            secureTextEntry
            placeholder="Confirm password"
            placeholderTextColor={C.textMuted}
            value={password2}
            onChangeText={setPassword2}
          />
          {password.length > 0 && password.length < 8 && (
            <Text style={styles.onboardErr}>Min 8 characters</Text>
          )}
          {password && password2 && password !== password2 && (
            <Text style={styles.onboardErr}>Passwords don't match</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Pressable
              style={[styles.btnOutline, { flex: 0.8, marginTop: 0 }]}
              onPress={() => setStep(step === 'create-pwd' ? 'create-confirm' : (importKind === 'privateKey' ? 'import-pk' : 'import'))}
            >
              <Text style={styles.btnOutlineText} numberOfLines={1}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1.2, marginTop: 0, opacity: (password.length >= 8 && password === password2 && !busy) ? 1 : 0.45 }]}
              disabled={password.length < 8 || password !== password2 || busy}
              onPress={step === 'create-pwd' ? finishCreate : finishImport}
            >
              <Text style={styles.btnPrimaryText} numberOfLines={1} adjustsFontSizeToFit>
                {busy ? 'Encrypting…' : (step === 'create-pwd' ? 'Create wallet' : 'Import wallet')}
              </Text>
            </Pressable>
          </View>
        </>}

        {step === 'import' && <>
          <Text style={styles.onboardTitle}>Import wallet</Text>
          <Text style={styles.onboardSub}>Paste your 12, 15, 18, 21 or 24-word recovery phrase.</Text>
          <TextInput
            style={[styles.input, { height: 110, textAlignVertical: 'top' }]}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="word1 word2 word3 …"
            placeholderTextColor={C.textMuted}
            value={importInput}
            onChangeText={setImportInput}
          />
          <Text style={[styles.onboardSub, { textAlign: 'left', marginTop: 6, marginBottom: 0 }]}>
            {importInput.trim().split(/\s+/).filter(Boolean).length} words
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            <Pressable style={[styles.btnOutline, { flex: 1, marginTop: 0 }]} onPress={() => setStep('import-choose')}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1, marginTop: 0 }]}
              onPress={() => { setImportKind('phrase'); setStep('import-pwd'); }}
            >
              <Text style={styles.btnPrimaryText}>Continue</Text>
            </Pressable>
          </View>
        </>}

        {step === 'unlock' && <>
          <Text style={styles.onboardTagline}>Secure and trusted multi-chain crypto wallet</Text>
          {bioAvail.on && (
            <Pressable
              style={[styles.btnSecondary, { width: '100%', marginBottom: 12, opacity: busy ? 0.6 : 1 }]}
              disabled={busy}
              onPress={tryBiometricUnlock}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {bioAvail.kind === 'face'
                  ? <ScanFace    size={18} color={C.textPrimary}/>
                  : <Fingerprint size={18} color={C.textPrimary}/>}
                <Text style={styles.btnSecondaryText}>
                  Unlock with {biometricLabel(bioAvail.kind)}
                </Text>
              </View>
            </Pressable>
          )}
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="Enter password"
            placeholderTextColor={C.textMuted}
            value={unlockPwd}
            onChangeText={t => { setUnlockPwd(t); setUnlockErr(''); }}
            onSubmitEditing={tryUnlock}
            autoFocus={!bioAvail.on}
          />
          {unlockErr ? <Text style={styles.onboardErr}>{unlockErr}</Text> : null}
          <Pressable
            style={[styles.btnPrimary, { opacity: (unlockPwd && !busy) ? 1 : 0.45 }]}
            disabled={!unlockPwd || busy}
            onPress={tryUnlock}
          >
            <Text style={styles.btnPrimaryText}>{busy ? 'Unlocking…' : 'Unlock'}</Text>
          </Pressable>
          <Pressable onPress={() => Alert.alert(
            'Reset wallet',
            'This deletes your wallet from this device. You can restore with your recovery phrase.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: resetWallet },
            ],
          )}>
            <Text style={styles.btnLink}>Forgot password? Reset wallet</Text>
          </Pressable>
        </>}

        </AnimatedSwitch>
      </View>
    </ScrollView>
  );
}

/* ─────────────────── In-app browser (WebView overlay) ─────────────────── */
interface DappRequest { id: number; method: string; params: unknown[] }

function InAppBrowser({ url, onClose, seed }: { url: string; onClose: () => void; seed: string[] }) {
  const C = useColors();
  const ref = useRef<WebView>(null);
  const [current, setCurrent] = useState(url);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState<DappRequest | null>(null);
  const address = useMemo(() => (seed.length ? deriveEvmAddress(seed) : ''), [seed]);
  let host = current;
  try { host = new URL(current).host; } catch { /* keep raw */ }

  const send = (js: string) => ref.current?.injectJavaScript(js);

  // Run a request against the wallet signer and post the result back.
  const run = async (req: DappRequest) => {
    try {
      const result = await executeWcRequest(seed, { request: { method: req.method, params: req.params } });
      if (req.method === 'eth_requestAccounts') setConnected(true);
      send(resolveJs(req.id, result));
    } catch (e) {
      const code = e instanceof WcSignerError ? e.code : -32603;
      send(rejectJs(req.id, code, (e as Error)?.message || 'Request failed'));
    }
  };

  const onMessage = (raw: string) => {
    let msg: DappRequest & { __thanos?: boolean };
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || !msg.__thanos || typeof msg.id !== 'number') return;
    const req: DappRequest = { id: msg.id, method: msg.method, params: msg.params || [] };

    // Read-only / already-authorised methods resolve immediately.
    if (req.method === 'eth_chainId')  { send(resolveJs(req.id, `0x${(700777).toString(16)}`)); return; }
    if (req.method === 'net_version')  { send(resolveJs(req.id, '700777')); return; }
    if (req.method === 'eth_accounts') {
      send(resolveJs(req.id, connected && address ? [address] : []));
      return;
    }
    // Connecting while already connected? No need to re-prompt.
    if (req.method === 'eth_requestAccounts' && connected && address) {
      send(resolveJs(req.id, [address]));
      return;
    }
    // Chain management — we only support Makalu (Lithosphere).
    if (req.method === 'wallet_switchEthereumChain') {
      const target = (req.params?.[0] as { chainId?: string })?.chainId?.toLowerCase();
      if (target === `0x${(700777).toString(16)}`) send(resolveJs(req.id, null));
      else send(rejectJs(req.id, 4902, 'Only Makalu (Lithosphere) is supported in-app'));
      return;
    }
    if (req.method === 'wallet_addEthereumChain') {
      // Gate on Makalu, same as switch above — blanket-approving any chain
      // let a dApp add e.g. BSC, get success, then 4902 on the follow-up
      // switch (and diverged from the WC handler in lib/wc-signer.ts).
      const target = (req.params?.[0] as { chainId?: string })?.chainId?.toLowerCase();
      if (target === `0x${(700777).toString(16)}`) send(resolveJs(req.id, null));
      else send(rejectJs(req.id, 4001, 'Only Makalu (Lithosphere) can be added in-app'));
      return;
    }
    if (APPROVAL_METHODS.has(req.method)) { setPending(req); return; }
    // Anything else (eth_call, eth_getBalance, eth_estimateGas, …) is a
    // read — proxy straight to the Makalu RPC.
    rpcProxy(req.method, req.params)
      .then(r => send(resolveJs(req.id, r)))
      .catch(e => send(rejectJs(req.id, -32603, (e as Error)?.message || 'RPC error')));
  };

  const approve = () => { if (pending) { void run(pending); setPending(null); } };
  const reject  = () => { if (pending) { send(rejectJs(pending.id, 4001, 'User rejected')); setPending(null); } };

  const isConnect = pending?.method === 'eth_requestAccounts';
  const summary = pending ? (isConnect ? `Connect your wallet to ${host}?` : summariseRequest(pending.method, pending.params)) : '';

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bgBase }}>
        <StatusBar barStyle={C.statusBar} backgroundColor={C.bgBase}/>
        {/* Chrome: close · host (lock) · reload · open external */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingHorizontal: 14, paddingVertical: 10,
          borderBottomWidth: 1, borderBottomColor: C.borderSubtle, backgroundColor: C.bgSurface,
        }}>
          <Pressable onPress={onClose} hitSlop={8}><ChevronLeft size={24} color={C.textPrimary}/></Pressable>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.bgElevated, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
            <Shield size={13} color={current.startsWith('https://') ? C.green : C.textMuted}/>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: C.textSecondary }}>{host}</Text>
            {connected && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.green }}/>}
          </View>
          <Pressable onPress={() => ref.current?.reload()} hitSlop={8}><Repeat size={18} color={C.textSecondary}/></Pressable>
          <Pressable onPress={() => { Linking.openURL(current).catch(() => {}); }} hitSlop={8}><Globe size={18} color={C.textSecondary}/></Pressable>
        </View>

        {loading && (
          <View style={{ height: 2, backgroundColor: C.blueDim }}>
            <View style={{ height: 2, width: '40%', backgroundColor: C.blue }}/>
          </View>
        )}

        <WebView
          ref={ref}
          source={{ uri: url }}
          onNavigationStateChange={(s) => setCurrent(s.url)}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onMessage={(e) => onMessage(e.nativeEvent.data)}
          injectedJavaScriptBeforeContentLoaded={INJECTED_PROVIDER_JS}
          style={{ flex: 1, backgroundColor: C.bgBase }}
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
        />

        {/* dApp request approval sheet */}
        {pending && (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: C.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.blueDim, alignItems: 'center', justifyContent: 'center' }}>
                  {isConnect ? <Globe size={18} color={C.blue}/> : <Shield size={18} color={C.blue}/>}
                </View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: C.textPrimary, flex: 1 }}>
                  {isConnect ? 'Connection request' : pending.method === 'eth_sendTransaction' ? 'Confirm transaction' : 'Signature request'}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: C.textSecondary, lineHeight: 19 }}>{summary}</Text>
              <Text style={{ fontSize: 11, color: C.textMuted }} numberOfLines={1}>From {host}</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <Pressable onPress={reject} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.borderDefault, alignItems: 'center' }}>
                  <Text style={{ color: C.textPrimary, fontWeight: '700' }}>Reject</Text>
                </Pressable>
                <Pressable onPress={approve} style={{ flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: C.blue, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>{isConnect ? 'Connect' : 'Approve'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* ─────────────────── Market screen (web parity) ─────────────────── */

/** Coins shown on the Market screen — Litho ecosystem + the mainstream coins
 *  the wallet transacts on. Mirrors apps/web's market list. */
const MARKET_LIST: { sym: string; name: string }[] = [
  { sym: 'LITHO',  name: 'Lithosphere' },
  { sym: 'LitBTC', name: 'Bitcoin (wrapped)' },
  { sym: 'JOT',    name: 'Jot Art' },
  { sym: 'LAX',    name: 'Lithosphere Algorithmic' },
  { sym: 'COLLE',  name: 'Colle AI' },
  { sym: 'IMAGE',  name: 'Imagen Network' },
  { sym: 'FGPT',   name: 'FurGPT' },
  { sym: 'MUSA',   name: 'Mansa AI' },
  { sym: 'SOL',    name: 'Solana' },
  { sym: 'BTC',    name: 'Bitcoin' },
  { sym: 'ATOM',   name: 'Cosmos Hub' },
  { sym: 'ETH',    name: 'Ethereum' },
  { sym: 'BNB',    name: 'BNB' },
  { sym: 'POL',    name: 'Polygon' },
  { sym: 'AVAX',   name: 'Avalanche' },
];

function fmtCompactUsd(n: number | null): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtMarketPrice(n: number): string {
  if (!isFinite(n)) return '—';
  if (n > 0 && n < 0.01) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 8 })}`;
  if (n < 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function MarketScreen({ goBack, onOpenToken }: { goBack: () => void; onOpenToken: (sym: string) => void }) {
  const C = useColors();
  const styles = useStyles();
  const [quotes, setQuotes] = useState<Record<string, MarketQuote> | null>(null);
  const [search, setSearch] = useState('');

  const load = () => { fetchMarketQuotes().then(setQuotes).catch(() => {}); };
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, []);

  const q = search.trim().toLowerCase();
  const rows = MARKET_LIST.filter(t => !q || t.sym.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bgCard }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: C.borderSubtle }}>
        <Pressable onPress={goBack} hitSlop={16} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
        </Pressable>
        <Text style={{ color: C.textPrimary, fontWeight: '800', fontSize: 18, marginLeft: 4 }}>Market</Text>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextInput
          style={styles.input}
          placeholder="Search coins…"
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {rows.map((t, i) => {
          const mq = quotes?.[t.sym];
          const known = !!mq && mq.chg24h !== null; // live feed
          const price = mq?.usd;
          return (
            <Pressable
              key={t.sym}
              onPress={() => onOpenToken(t.sym)}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: C.borderSubtle }}
            >
              <Text style={{ width: 22, color: C.textMuted, fontSize: 11 }}>{i + 1}</Text>
              <Avatar symbol={t.sym} color={ASSET_COLORS[t.sym.toUpperCase()] ?? '#52525b'} size={34}/>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 14 }}>{t.name}</Text>
                <Text style={{ color: C.textMuted, fontSize: 11 }}>{t.sym}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 13, fontFamily: MONO }}>
                  {typeof price === 'number' ? fmtMarketPrice(price) : '—'}
                </Text>
                <Text style={{ fontSize: 11, marginTop: 2, color: !known ? C.textMuted : (mq!.chg24h! >= 0 ? C.green : C.red) }}>
                  {known ? `${mq!.chg24h! >= 0 ? '+' : ''}${mq!.chg24h}%` : 'cap ' + fmtCompactUsd(null)}
                  {known ? ` · ${fmtCompactUsd(mq!.marketCap)}` : ''}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────── Assets screen + allocation donut (web parity) ─────── */

/** SVG donut (string for SvgXml) — one arc per asset, sized by % of total. */
function donutSvg(segs: { color: string; pct: number }[]): string {
  const r = 64, cx = 80, cy = 80, sw = 22;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segs.map((s) => {
    const len  = (s.pct / 100) * circ;
    const draw = Math.max(0, len - 2);
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${draw} ${circ - draw}" stroke-dashoffset="${-offset}" stroke-linecap="butt"/>`;
    offset += len;
    return el;
  }).join('');
  return `<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg"><g transform="rotate(-90 ${cx} ${cy})">${arcs}</g></svg>`;
}

function AssetsScreen({ goBack, onOpenToken }: { goBack: () => void; onOpenToken: (sym: string) => void }) {
  const C = useColors();
  const styles = useStyles();
  const addr = useWalletAddr();
  const seed = useWalletSeed();
  const { assets, totalUsd, loading, offline, reload } = usePortfolio(addr, seed);

  const held  = assets.filter(a => a.usdValue > 0);
  const total = held.reduce((s, a) => s + a.usdValue, 0) || 1;
  const rows  = held.map(a => ({ ...a, pct: Math.max(1, Math.round((a.usdValue / total) * 100)) }));
  const svg   = rows.length ? donutSvg(rows.map(r => ({ color: r.color, pct: r.pct }))) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bgCard }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: C.borderSubtle }}>
        <Pressable onPress={goBack} hitSlop={16} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
        </Pressable>
        <Text style={{ color: C.textPrimary, fontWeight: '800', fontSize: 18, marginLeft: 4 }}>Assets</Text>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={C.textSecondary}/>}
      >
        {svg && (
          <View style={{ alignItems: 'center', marginVertical: 12 }}>
            <View style={{ width: 180, height: 180, alignItems: 'center', justifyContent: 'center' }}>
              <SvgXml xml={svg} width={180} height={180}/>
              <View style={{ position: 'absolute', alignItems: 'center' }}>
                <Text style={{ color: C.textMuted, fontSize: 11 }}>Total</Text>
                <Text style={{ color: C.textPrimary, fontSize: 18, fontWeight: '800' }}>{formatUsd(totalUsd)}</Text>
              </View>
            </View>
          </View>
        )}

        {!loading && offline && <Text style={{ color: C.textMuted, padding: 16, textAlign: 'center' }}>Couldn’t reach the indexer — pull to retry.</Text>}
        {!loading && !offline && rows.length === 0 && <Text style={{ color: C.textMuted, padding: 16, textAlign: 'center' }}>No assets yet.</Text>}

        {rows.map((a, i) => (
          <Pressable
            key={a.sym + i}
            onPress={() => onOpenToken(a.sym)}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: i < rows.length - 1 ? 1 : 0, borderBottomColor: C.borderSubtle }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: a.color, marginRight: 10 }}/>
            <Avatar symbol={a.sym} color={a.color} size={34}/>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 14 }}>{a.name}</Text>
              <Text style={{ color: C.textMuted, fontSize: 11 }}>{a.balanceText} {a.sym} · {a.pct}%</Text>
            </View>
            <Text style={{ color: C.textPrimary, fontWeight: '700', fontSize: 14 }}>{formatUsd(a.usdValue)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/* NFTs — mirrors apps/web's NFTs tab. The on-chain NFT indexer ships with a
   later backend slice, so for now this is the same honest empty state the web
   shows (LEP-721 / LEP-1155) plus a deep link to the Lithosphere marketplace. */
function NFTsScreen({ goBack }: { goBack: () => void }) {
  const C = useColors();
  const styles = useStyles();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bgCard }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: C.borderSubtle }}>
        <Pressable onPress={goBack} hitSlop={16} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
        </Pressable>
        <Text style={{ color: C.textPrimary, fontWeight: '800', fontSize: 18, marginLeft: 4 }}>NFTs</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingTop: 40 }}>
        <View style={{ alignItems: 'center', gap: 12, padding: 24, borderRadius: 16, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSubtle }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: C.blueDim, borderWidth: 1, borderColor: C.borderSubtle, alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon size={26} color={C.blue}/>
          </View>
          <Text style={{ color: C.textPrimary, fontSize: 16, fontWeight: '800' }}>No NFTs yet</Text>
          <Text style={{ color: C.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
            NFTs you receive on Lithosphere (LEP-721 / LEP-1155) will appear here.
            Indexing ships with the next backend slice — until then, browse and mint
            on the Lithosphere marketplace.
          </Text>
          <Pressable
            onPress={() => Linking.openURL('https://makalu.litho.ai/nfts').catch(() => {})}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: C.blue }}
          >
            <BadgeCheck size={14} color="#fff"/>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Browse marketplace</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* First-run welcome — introduces the Lithosphere Makalu home network the
   first time a user reaches the unlocked wallet. Self-gates on an
   AsyncStorage flag (written the moment it shows) so it appears at most once
   per install. Client request (Esha, 2026-06-15). */
const MAKALU_WELCOME_FLAG = 'thanos.makalu_welcome.v1';
function MakaluWelcomeModal() {
  const C = useColors();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(MAKALU_WELCOME_FLAG).then(v => {
      if (v === '1') return;
      setVisible(true);
      AsyncStorage.setItem(MAKALU_WELCOME_FLAG, '1').catch(() => {});
    }).catch(() => {});
  }, []);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <Pressable onPress={() => setVisible(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360, backgroundColor: C.bgCard, borderRadius: 18, padding: 24, alignItems: 'center' }}>
          <Image source={require('./assets/images/Thanos_Logo_Transparent.png')} style={{ width: 60, height: 60, marginBottom: 14, resizeMode: 'contain' }}/>
          <Text style={{ color: C.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 6 }}>Welcome to Thanos</Text>
          <Text style={{ color: C.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 6 }}>
            Your wallet is on the Lithosphere Makalu network (chain 700777) — the Web4 home chain. The native coin is LITHO; Bitcoin, Solana, Cosmos and EVM are built in too.
          </Text>
          <Text style={{ color: C.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'center', marginBottom: 18 }}>
            Explorer: makalu.litho.ai · RPC: rpc.litho.ai
          </Text>
          <Pressable onPress={() => setVisible(false)} style={{ width: '100%', paddingVertical: 13, borderRadius: 12, backgroundColor: '#3b7af7', alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Got it</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  /** Token-detail overlay — opened by tapping a token row. */
  const [detailSym, setDetailSym] = useState<string | null>(null);
  /** Asset carried from detail into Send/Swap so they open pre-seeded. */
  const [seedSym, setSeedSym] = useState<string | null>(null);
  // Dark-first, matching the web/desktop/extension clients (they're all
  // dark by default). The Settings toggle still lets users switch to light.
  const [isDark, setIsDark] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [walletSeed, setWalletSeed] = useState<string[]>([]);
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  // Multi-account state — same pattern as web/desktop/extension, but the
  // store is AsyncStorage so we hydrate once on app start.
  const [activeIdx, setActiveIdx]            = useState(0);
  const [accountCount, setAccountCountState] = useState(1);
  useEffect(() => {
    void loadAccountsFromStorage().then(() => {
      setActiveIdx(getActiveAccountIndex());
      setAccountCountState(getAccountCount());
    });
    void loadContactsFromStorage();
  }, []);

  // Derive + cache the contact-encryption key from the unlocked seed.
  // Cleared on lock so the address book falls back to ciphertext display.
  useEffect(() => {
    void setContactEncryptionKey(unlocked && walletSeed.length ? walletSeed : null);
    return () => { void setContactEncryptionKey(null); };
  }, [unlocked, walletSeed]);
  const switchAccount = (idx: number) => {
    if (idx < 0 || idx >= accountCount) return;
    setActiveAccountIndex(idx);
    setActiveIdx(idx);
  };
  const addAccount = () => {
    if (accountCount >= MAX_ACCOUNTS) return;
    const next = accountCount;
    setAccountCount(next + 1);
    setAccountCountState(next + 1);
    setActiveAccountIndex(next);
    setActiveIdx(next);
  };

  useEffect(() => {
    (async () => {
      // 1) Legacy migration — if the previous plaintext mnemonic exists in
      //    AsyncStorage, re-encrypt it into the SecureStore vault and wipe.
      if (await hasLegacyPlaintext()) {
        await migrateLegacyPlaintext();
      }

      // 2) Vault check.
      const vault = await loadVault();
      setHasVault(!!vault);
      if (!vault) return;

      // 3) Refresh-survival within the current JS runtime: if a session key
      //    is in module memory (set by createVault/openVault on a previous
      //    mount), use it. On cold start the module is fresh and this is
      //    null — user must enter password.
      const key = getSessionKey();
      if (!key) return;
      const mnemonic = await openVaultWithKey(vault, key);
      if (mnemonic) {
        setWalletSeed(mnemonic.split(' '));
        setUnlocked(true);
        // Mirror into the module-isolated signer so signing requests
        // don't have to thread the seed through every call site.
        try {
          const signer = await import('./lib/signer');
          signer.setSeed(mnemonic);
        } catch { /* signer load failed — fall back to in-component signing */ }
      } else {
        clearSessionKey();
      }
    })().catch(() => { /* fall through to onboarding */ });
  }, []);

  const colors = isDark ? DARK : LIGHT;
  const styles = useMemo(() => makeStyles(colors), [isDark]);
  const toggle = () => setIsDark(d => !d);

  // Once unlocked, if the user has opted into notifications, (re)register
  // this device's push token against the wallet address.
  useEffect(() => {
    if (!unlocked || walletSeed.length === 0) return;
    isNotificationsEnabled().then(on => {
      if (on) registerPush(deriveEvmAddress(walletSeed, activeIdx)).catch(() => {});
    });
  }, [unlocked, walletSeed, activeIdx]);

  // Load the custom-RPC override (Settings) into the signer at boot.
  useEffect(() => {
    AsyncStorage.getItem(PREF_CUSTOM_RPC).then(url => setRpcOverride(url || null)).catch(() => {});
  }, []);

  // Auto-lock: when the app returns from the background, lock if it was
  // away longer than the configured timeout (0 = never).
  const bgSince = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'background' || state === 'inactive') {
        bgSince.current = Date.now();
      } else if (state === 'active' && bgSince.current && unlocked) {
        const away = Date.now() - bgSince.current;
        bgSince.current = null;
        const mins = parseInt((await AsyncStorage.getItem(PREF_AUTOLOCK)) ?? '0', 10) || 0;
        if (mins > 0 && away > mins * 60_000) handleLock();
      }
    });
    return () => sub.remove();
  }, [unlocked]);

  const handleLock = () => {
    setUnlocked(false);
    setWalletSeed([]);
    clearSessionKey();
    // Wipe the module-isolated signer cache so no signing operations
    // can happen until the next unlock.
    void import('./lib/signer').then(s => s.clearSeed()).catch(() => { /* not loaded */ });
    // The biometric-protected key stays on disk so the user can unlock
    // again with Face ID on the next session. Only "Reset wallet"
    // (in OnboardingScreen) wipes it.
  };

  // Wait for storage check before deciding which screen to show
  if (hasVault === null) {
    return (
      <ThemeCtx.Provider value={colors}>
        <StylesCtx.Provider value={styles}>
          <SafeAreaView style={[styles.root, { justifyContent: 'center', alignItems: 'center' }]}>
            <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bgBase}/>
          </SafeAreaView>
        </StylesCtx.Provider>
      </ThemeCtx.Provider>
    );
  }

  // Onboarding / unlock gate
  if (!unlocked) {
    return (
      <ThemeCtx.Provider value={colors}>
        <StylesCtx.Provider value={styles}>
          <ToggleCtx.Provider value={toggle}>
            <SafeAreaView style={styles.root}>
              <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bgBase}/>
              <OnboardingScreen
                hasVault={hasVault}
                onComplete={(seed) => {
                  setWalletSeed(seed);
                  setHasVault(true);
                  setUnlocked(true);
                  // Mirror seed into the module-isolated signer.
                  void import('./lib/signer').then(s => s.setSeed(seed)).catch(() => { /* skip */ });
                  // Session key was cached inside createVault / openVault; no
                  // extra plaintext flag is written. Cold-start still requires
                  // password since the JS module is re-loaded — this is the
                  // intentional security trade-off after removing plaintext.
                }}
              />
            </SafeAreaView>
          </ToggleCtx.Provider>
        </StylesCtx.Provider>
      </ThemeCtx.Provider>
    );
  }

  const walletAddr = walletSeed.length > 0 ? deriveEvmAddress(walletSeed, activeIdx) : '0x0000…0000';
  const shortAddr = walletAddr.length > 12 ? `${walletAddr.slice(0,6)}…${walletAddr.slice(-4)}` : walletAddr;

  return (
    <ThemeCtx.Provider value={colors}>
      <StylesCtx.Provider value={styles}>
        <ToggleCtx.Provider value={toggle}>
        <WalletAddrCtx.Provider value={walletAddr}>
        <WalletSeedCtx.Provider value={walletSeed}>
        <BrowserCtx.Provider value={setBrowserUrl}>
          <SafeAreaView style={styles.root}>
            <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bgBase} />

            {/* First-run Lithosphere Makalu welcome — self-gates, shows once. */}
            <MakaluWelcomeModal/>

            {/* Always-mounted WalletConnect listener — pops an approve/
                reject sheet whenever a paired dApp sends a sign request. */}
            <WalletConnectRequestHost seed={walletSeed}/>

            {/* In-app browser overlay (Discover dApps / typed links) */}
            {browserUrl && <InAppBrowser url={browserUrl} onClose={() => setBrowserUrl(null)} seed={walletSeed}/>}

            {/* Top header */}
            <View style={styles.topbar}>
              <Pressable
                style={styles.acct}
                /* Tap = account switcher (mnemonic wallets only). Long-press
                   = lock shortcut, same as before. PK-only wallets keep
                   the previous tap-to-lock behaviour. */
                onPress={() => {
                  if (walletSeed.length === 0) return;
                  // PK wallets are single-account — show one entry regardless of
                  // any stale persisted count from a previous mnemonic wallet.
                  const pkWallet = isPrivateKeyWallet(walletSeed);
                  const shownCount = pkWallet ? 1 : accountCount;
                  const shownActive = pkWallet ? 0 : activeIdx;
                  Alert.alert(
                    'Account',
                    `Active: Account ${shownActive + 1}`,
                    [
                      ...Array.from({ length: shownCount }, (_, i) => ({
                        text: `${i === shownActive ? '✓ ' : ''}Account ${i + 1}`,
                        onPress: () => switchAccount(i),
                      })),
                      // No "Add account" for private-key wallets — a raw key
                      // is a single account, not an HD tree.
                      ...(accountCount < MAX_ACCOUNTS && !isPrivateKeyWallet(walletSeed) ? [{ text: '+ Add account', onPress: addAccount }] : []),
                      { text: 'Cancel', style: 'cancel' as const },
                    ],
                  );
                }}
                onLongPress={() => Alert.alert(
                  'Lock wallet?',
                  'You\'ll need your password to unlock.',
                  [
                    { text: 'Cancel', style: 'cancel' as const },
                    { text: 'Lock',   style: 'destructive' as const, onPress: handleLock },
                  ],
                )}
              >
                <View style={styles.acctAvatar}><Text style={styles.acctAvatarText}>○</Text></View>
                <View>
                  <Text style={styles.acctName}>{`Account ${walletSeed.length > 0 && !isPrivateKeyWallet(walletSeed) ? activeIdx + 1 : 1}`}</Text>
                  <Text style={styles.acctAddr}>{shortAddr}</Text>
                </View>
              </Pressable>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Pressable onPress={toggle} style={styles.themeBtn}>
                  <Text style={{ fontSize: 16 }}>{isDark ? '☀' : '🌙'}</Text>
                </Pressable>
                <View style={styles.netPill}>
                  <View style={styles.netDot}/>
                  <Text style={styles.netText}>Makalu</Text>
                </View>
              </View>
            </View>

            {/* Body — animated screen transitions */}
            <View style={styles.body}>
              <AnimatedSwitch keyName={screen} style={{ flex: 1 }}>
                {screen === 'home'     && <HomeScreen navigate={setScreen} onOpenToken={setDetailSym}/>}
                {screen === 'send'     && <SendScreen goBack={() => { setScreen('home'); setSeedSym(null); }}
                  initialChain={seedSym && ['BTC','SOL','ATOM'].includes(seedSym) ? (seedSym === 'BTC' ? 'bitcoin' : seedSym === 'SOL' ? 'solana' : 'cosmos') : (seedSym ? 'evm' : undefined)}
                  initialSym={seedSym && !['BTC','SOL','ATOM'].includes(seedSym) ? seedSym : undefined}/>}
                {screen === 'receive'  && <ReceiveScreen goBack={() => setScreen('home')}/>}
                {screen === 'swap'     && <SwapScreen goBack={() => { setScreen('home'); setSeedSym(null); }} initialFrom={seedSym ?? undefined}/>}
                {screen === 'discover' && <DiscoverScreen/>}
                {screen === 'earn'     && <EarnScreen goBack={() => setScreen('home')}/>}
                {screen === 'market'   && <MarketScreen goBack={() => setScreen('home')} onOpenToken={setDetailSym}/>}
                {screen === 'assets'   && <AssetsScreen goBack={() => setScreen('home')} onOpenToken={setDetailSym}/>}
                {screen === 'nfts'     && <NFTsScreen goBack={() => setScreen('home')}/>}
                {screen === 'activity' && <ActivityScreen/>}
                {screen === 'settings' && <SettingsScreen/>}
              </AnimatedSwitch>
            </View>

            {/* Token-detail overlay — full-screen Modal over the tab shell. */}
            <Modal visible={!!detailSym} animationType="slide" onRequestClose={() => setDetailSym(null)} presentationStyle="fullScreen">
              {detailSym && (
                <TokenDetailScreen
                  sym={detailSym}
                  goBack={() => setDetailSym(null)}
                  onSend={() => { setSeedSym(detailSym); setDetailSym(null); setScreen('send'); }}
                  onReceive={() => { setDetailSym(null); setScreen('receive'); }}
                  onSwap={() => { setSeedSym(detailSym); setDetailSym(null); setScreen('swap'); }}
                />
              )}
            </Modal>

            {/* Bottom tabs */}
            <View style={styles.tabbar}>
              {TABS.map(t => {
                const active = screen === t.key || (t.key === 'home' && (screen === 'send' || screen === 'receive'));
                return (
                  <Pressable key={t.key} style={styles.tab} onPress={() => setScreen(t.key)}>
                    {active && <View style={styles.tabActiveBar}/>}
                    <t.Icon size={20} color={active ? colors.blue : colors.textMuted} strokeWidth={active ? 2.4 : 2}/>
                    <Text style={[styles.tabLabel, active && { color: colors.blue, fontWeight: '700' }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SafeAreaView>
        </BrowserCtx.Provider>
        </WalletSeedCtx.Provider>
        </WalletAddrCtx.Provider>
        </ToggleCtx.Provider>
      </StylesCtx.Provider>
    </ThemeCtx.Provider>
  );
}

/* ─────────────────────────── Styles ─────────────────────────── */

/* Global text-size multiplier for mobile — matches web/desktop 1.5x zoom feel.
   Applied to every fontSize in the StyleSheet below via _scaleFontSizes(). */
const MOBILE_TEXT_SCALE = 1.5;
function _scaleFontSizes<T extends Record<string, any>>(raw: T): T {
  for (const k in raw) {
    const s: any = raw[k];
    if (s && typeof s === 'object') {
      if (typeof s.fontSize === 'number')   s.fontSize   = Math.round(s.fontSize   * MOBILE_TEXT_SCALE);
      if (typeof s.lineHeight === 'number') s.lineHeight = Math.round(s.lineHeight * MOBILE_TEXT_SCALE);
    }
  }
  return raw;
}

function makeStyles(C: Colors) {
  return StyleSheet.create(_scaleFontSizes({
    root:      { flex: 1, backgroundColor: C.bgBase },
    body:      { flex: 1 },
    scroll:    { flex: 1 },
    scrollContent: { padding: 16, gap: 14 },

    /* Topbar */
    topbar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
      backgroundColor: C.bgSurface,
    },
    acct: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: C.bgElevated, borderColor: C.borderDefault, borderWidth: 1,
      borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12, paddingLeft: 4,
    },
    acctAvatar: {
      width: 30, height: 30, borderRadius: 15,
      backgroundColor: C.bgHover,
      alignItems: 'center', justifyContent: 'center',
    },
    acctAvatarText: { color: C.textMuted, fontSize: 13, fontWeight: '700' },
    acctName: { color: C.textPrimary, fontSize: 13, fontWeight: '600', letterSpacing: -0.2 },
    acctAddr: { color: C.textMuted, fontSize: 10, fontFamily: MONO, marginTop: 1 },

    themeBtn: {
      width: 32, height: 32, borderRadius: 8,
      backgroundColor: C.bgElevated,
      borderColor: C.borderSubtle, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },

    /* Network pill (top of home) */
    netPillRow: { alignItems: 'flex-start', marginBottom: 4 },
    netPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 10, paddingVertical: 5,
      backgroundColor: C.greenDim,
      borderColor: 'rgba(16,185,129,0.22)', borderWidth: 1,
      borderRadius: 999,
    },
    netDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
    netText: { color: C.green, fontSize: 11, fontWeight: '700', letterSpacing: -0.1 },

    /* Premium balance card */
    balanceCard: {
      backgroundColor: C.bgCard,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 20,
      padding: 20,
      position: 'relative',
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    balanceCardOverlay: {
      position: 'absolute',
      top: -60, right: -60,
      width: 200, height: 200,
      borderRadius: 100,
      backgroundColor: C.blue,
      opacity: 0.06,
    },
    balanceLabel: {
      color: C.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5,
    },
    balanceAmt: {
      color: C.textPrimary, fontSize: 36, fontWeight: '800', letterSpacing: -1.4,
      marginTop: 4,
    },
    balanceSub: { color: C.textMuted, fontSize: 12, fontWeight: '500' },
    changePill: {
      paddingHorizontal: 9, paddingVertical: 3,
      backgroundColor: C.greenDim,
      borderRadius: 999, borderWidth: 1, borderColor: 'rgba(16,185,129,0.22)',
    },
    changePillText: { color: C.green, fontSize: 11, fontWeight: '700' },
    balanceDivider: {
      height: 1, backgroundColor: C.borderSubtle, marginVertical: 16,
    },
    balanceMetricLabel: {
      color: C.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    balanceMetricValue: {
      color: C.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.4,
      marginTop: 3,
    },

    /* Quick action pills */
    qaRow: { flexDirection: 'row', gap: 8, marginVertical: 4 },
    qaBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7,
      paddingVertical: 9, paddingLeft: 6, paddingRight: 12,
      backgroundColor: C.bgCard,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 999,
      justifyContent: 'center',
    },
    qaIcon: {
      width: 26, height: 26, borderRadius: 13,
      backgroundColor: C.blueDim,
      alignItems: 'center', justifyContent: 'center',
    },
    qaIconText: { color: C.blue, fontSize: 14, fontWeight: '700' },
    qaLabel: { color: C.textPrimary, fontSize: 12.5, fontWeight: '600', letterSpacing: -0.2 },

    /* Section title */
    assetsHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 6, paddingHorizontal: 4, marginTop: 4,
    },
    sectionTitle: {
      color: C.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: -0.2,
    },
    assetsCount: {
      color: C.textMuted, fontSize: 12, fontWeight: '600',
      backgroundColor: C.bgElevated, paddingHorizontal: 8, paddingVertical: 2,
      borderRadius: 999,
    },

    /* Card / rows */
    card: {
      backgroundColor: C.bgCard,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 16,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 13, paddingHorizontal: 14,
    },
    rowBorder: { borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
    rowMid:   { flex: 1 },
    rowRight: { alignItems: 'flex-end' },
    rowSymbol:{ color: C.textPrimary, fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
    rowSub:   { color: C.textMuted, fontSize: 11, marginTop: 2, fontWeight: '500' },
    rowChangeInline: { fontSize: 11, fontWeight: '600' },
    rowAmt:   { color: C.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
    rowBal:   { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: MONO },

    /* Avatar — single solid color, white initial */
    avatar: {
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: '#fff', fontWeight: '700' },

    /* Tx icon */
    txIcon: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
    },
    txArrow: { fontSize: 16, fontWeight: '700' },

    /* Page header / titles */
    headerRow: { paddingVertical: 4 },
    backText:  { color: C.textSecondary, fontSize: 13, fontWeight: '500' },
    pageTitle: { color: C.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.6 },
    pageTitleLarge: { color: C.textPrimary, fontSize: 28, fontWeight: '800', letterSpacing: -1 },
    pageSubtitle:   { color: C.textMuted, fontSize: 13, marginTop: 4, marginBottom: 8 },

    /* Modern screen header */
    screenHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 4, marginBottom: 6,
    },
    backBtn: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: C.bgElevated,
      alignItems: 'center', justifyContent: 'center',
    },
    backArrow: { color: C.textPrimary, fontSize: 26, fontWeight: '300', marginTop: -3, marginLeft: -2 },
    screenTitle: {
      color: C.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.3,
    },

    /* Asset selector card (used in Send) */
    assetSelectCard: {
      backgroundColor: C.bgCard,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 16, padding: 16,
      shadowColor: '#000',
      shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    assetSelectRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10,
    },
    assetSelectName: { color: C.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
    assetSelectBal:  { color: C.textMuted, fontSize: 11, marginTop: 2 },

    maxBtn: {
      paddingHorizontal: 10, paddingVertical: 4,
      backgroundColor: C.blueDim,
      borderColor: 'rgba(59,122,247,0.22)', borderWidth: 1,
      borderRadius: 999,
    },
    maxBtnText: { color: C.blue, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
    scanBtn: {
      width: 36, height: 36, borderRadius: 9,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: C.blueDim,
      borderColor: 'rgba(59,122,247,0.22)', borderWidth: 1,
    },

    bigAmountInput: {
      color: C.textPrimary, fontSize: 32, fontWeight: '800', letterSpacing: -1,
      padding: 0,
    },
    amountUsdSub: { color: C.textMuted, fontSize: 12, fontWeight: '500', marginTop: 4 },

    feeRowCard: {
      backgroundColor: C.bgElevated,
      borderRadius: 12, padding: 12, gap: 6,
    },
    feeTextValue: { color: C.textPrimary, fontSize: 12, fontWeight: '600' },

    btnSecondary: {
      height: 46, borderRadius: 12,
      backgroundColor: C.bgElevated,
      borderColor: C.borderDefault, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    btnSecondaryText: { color: C.textPrimary, fontSize: 13, fontWeight: '600', letterSpacing: -0.2 },

    /* Receive screen */
    receiveCard: {
      backgroundColor: C.bgCard,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 18, padding: 18, gap: 14,
      shadowColor: '#000',
      shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    networkSelector: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: C.bgElevated,
      borderRadius: 12, padding: 12,
    },
    networkSelectorText: { flex: 1, color: C.textPrimary, fontSize: 13, fontWeight: '600' },

    qrCornerTL: { position: 'absolute', top: 8, left: 8, width: 16, height: 16, borderTopWidth: 3, borderLeftWidth: 3, borderColor: C.blue, zIndex: 3 },
    qrCornerTR: { position: 'absolute', top: 8, right: 8, width: 16, height: 16, borderTopWidth: 3, borderRightWidth: 3, borderColor: C.blue, zIndex: 3 },
    qrCornerBL: { position: 'absolute', bottom: 8, left: 8, width: 16, height: 16, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: C.blue, zIndex: 3 },
    qrCornerBR: { position: 'absolute', bottom: 8, right: 8, width: 16, height: 16, borderBottomWidth: 3, borderRightWidth: 3, borderColor: C.blue, zIndex: 3 },
    qrInner: {
      width: 156, height: 156,
      alignItems: 'center', justifyContent: 'center',
    },

    addrCard: {
      backgroundColor: C.bgElevated,
      borderRadius: 12, padding: 14,
    },
    addrTextLarge: {
      color: C.textPrimary, fontSize: 13, fontFamily: MONO,
      marginTop: 6, letterSpacing: -0.2,
    },
    warningCard: {
      backgroundColor: 'rgba(234,179,8,0.08)',
      borderColor: 'rgba(234,179,8,0.22)', borderWidth: 1,
      borderRadius: 10, padding: 10,
    },
    warningCardText: { color: C.yellow, fontSize: 11, lineHeight: 16 },

    /* Activity */
    filterRow: { flexDirection: 'row', gap: 6, marginVertical: 6 },
    filterPill: {
      paddingHorizontal: 14, paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: C.bgElevated,
      borderColor: C.borderSubtle, borderWidth: 1,
    },
    filterPillActive: { backgroundColor: C.blueDim, borderColor: 'rgba(59,122,247,0.32)' },
    filterPillText: { color: C.textMuted, fontSize: 12, fontWeight: '600' },
    filterPillTextActive: { color: C.blue, fontWeight: '700' },
    dateHeader: {
      color: C.textMuted, fontSize: 11, fontWeight: '700',
      letterSpacing: 1, marginTop: 8, marginBottom: 2, paddingHorizontal: 4,
      textTransform: 'uppercase',
    },

    /* Settings */
    sectionLabel: {
      color: C.textMuted, fontSize: 11, fontWeight: '700',
      letterSpacing: 1, paddingVertical: 4, paddingHorizontal: 4, marginTop: 8,
      textTransform: 'uppercase',
    },

    /* Premium settings hero + icon-led section headers */
    setHero: {
      paddingBottom: 14,
      marginBottom: 4,
      borderBottomWidth: 1,
      borderBottomColor: C.borderSubtle,
    },
    setHeroTitle: {
      color: C.textPrimary,
      fontSize: 28,
      fontWeight: '800',
      letterSpacing: -0.8,
      marginBottom: 4,
    },
    setHeroSub: {
      color: C.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    setSectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
      marginBottom: 6,
      paddingHorizontal: 2,
    },
    setSectionIcon: {
      width: 32, height: 32,
      borderRadius: 9,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(59,122,247,0.12)',
      borderWidth: 1,
      borderColor: 'rgba(59,122,247,0.28)',
    },
    setSectionTitle: {
      color: C.textPrimary,
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    setSectionSub: {
      color: C.textMuted,
      fontSize: 11,
      marginTop: 1,
    },
    acctHeaderCard: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: C.bgCard,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 16, padding: 14,
      shadowColor: '#000',
      shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    acctHeaderName: { color: C.textPrimary, fontSize: 15, fontWeight: '700', letterSpacing: -0.3 },
    acctHeaderAddr: { color: C.textMuted, fontSize: 11, fontFamily: MONO, marginTop: 2 },
    copyChip: {
      paddingHorizontal: 12, paddingVertical: 6,
      backgroundColor: C.blueDim,
      borderRadius: 999,
    },
    copyChipText: { color: C.blue, fontSize: 11, fontWeight: '700' },
    settingIcon: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: C.bgElevated,
      alignItems: 'center', justifyContent: 'center',
      marginRight: 12,
    },
    toggleSwitch: {
      width: 40, height: 22, borderRadius: 11,
      backgroundColor: C.bgHover,
      justifyContent: 'center', paddingHorizontal: 2,
    },
    toggleSwitchOn: { backgroundColor: C.blue },
    toggleThumb: {
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: '#fff',
      shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
    },
    toggleThumbOn: { transform: [{ translateX: 18 }] },

    /* Form */
    fieldLabel: { color: C.textSecondary, fontSize: 11, fontWeight: '500', marginBottom: 6 },
    input: {
      backgroundColor: C.bgElevated,
      borderColor: C.borderDefault, borderWidth: 1,
      borderRadius: 12,
      color: C.textPrimary,
      fontSize: 14,
      paddingVertical: 12, paddingHorizontal: 14,
    },
    feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
    feeText:{ color: C.textMuted, fontSize: 11 },

    btnPrimary: {
      height: 50,
      backgroundColor: C.blue,
      borderRadius: 14,
      alignItems: 'center', justifyContent: 'center',
      marginTop: 4,
    },
    btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: -0.3 },

    /* QR / Receive */
    qrFrame: {
      backgroundColor: '#fff',
      borderRadius: 16,
      padding: 16,
      alignSelf: 'center',
      marginVertical: 8,
    },
    qrPlaceholder: {
      width: 180, height: 180,
      backgroundColor: '#0b0b14',
      alignItems: 'center', justifyContent: 'center',
      borderRadius: 4,
    },
    qrPlaceholderText: { color: C.blue, fontSize: 38, fontWeight: '900' },
    addrBox: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: C.bgElevated,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 12, padding: 12,
    },
    addrText: { flex: 1, color: C.textSecondary, fontSize: 11, fontFamily: MONO, lineHeight: 16 },
    copyBtn:  {
      backgroundColor: C.bgHover, borderRadius: 8,
      paddingVertical: 6, paddingHorizontal: 12,
    },
    copyBtnText: { color: C.textSecondary, fontSize: 11, fontWeight: '600' },
    helperText:  { color: C.textMuted, fontSize: 11, lineHeight: 18, paddingHorizontal: 2 },

    /* Settings */
    settingRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 14, paddingHorizontal: 14,
    },
    settingLabel: { color: C.textPrimary, fontSize: 13, fontWeight: '600' },
    settingDesc:  { color: C.textMuted, fontSize: 11, marginTop: 2 },
    chevron:      { color: C.textMuted, fontSize: 22, fontWeight: '300' },
    versionText:  { color: C.textMuted, fontSize: 10, textAlign: 'center', marginTop: 16 },

    /* Tabbar */
    tabbar: {
      flexDirection: 'row',
      borderTopWidth: 1, borderTopColor: C.borderSubtle,
      backgroundColor: C.bgSurface,
      paddingTop: 6, paddingBottom: 8,
      paddingHorizontal: 8,
      gap: 4,
    },
    tab: {
      flex: 1, paddingVertical: 8,
      alignItems: 'center', justifyContent: 'center', gap: 3,
      borderRadius: 12,
    },
    tabActiveBar: {
      position: 'absolute', top: 4, alignSelf: 'center',
      width: 4, height: 4, borderRadius: 2,
      backgroundColor: C.blue,
    },
    tabIcon:  { color: C.textMuted, fontSize: 17 },
    tabLabel: { color: C.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: -0.1 },

    /* ── Onboarding ── */
    onboardWrap: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    onboardCard: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: C.bgCard,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 22,
      padding: 28,
    },
    onboardLogo: {
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 14,
      position: 'relative',
      height: 168,
    },
    onboardLogoGlow: {
      // Soft blue halo behind the lockup — approximates the web's radial glow.
      position: 'absolute',
      width: 150, height: 150, borderRadius: 75,
      backgroundColor: C.blue, opacity: 0.16,
    },
    onboardLogoImage: {
      width: 160, height: 160,
    },
    onboardBrand: {
      color: C.textPrimary, fontSize: 13, fontWeight: '700',
      letterSpacing: 1.2, textAlign: 'center',
      marginBottom: 18,
      textTransform: 'uppercase',
    },
    onboardTitle: {
      color: C.textPrimary, fontSize: 22, fontWeight: '700',
      letterSpacing: -0.6, textAlign: 'center', marginBottom: 8,
    },
    onboardSub: {
      color: C.textMuted, fontSize: 13, lineHeight: 19,
      textAlign: 'center', marginBottom: 22,
    },
    onboardTagline: {
      color: C.textPrimary, fontSize: 16, fontWeight: '700',
      letterSpacing: -0.3, textAlign: 'center',
      marginBottom: 24,
    },
    onboardErr: {
      color: C.red, fontSize: 12, fontWeight: '600',
      textAlign: 'center', marginTop: 8,
      backgroundColor: C.redDim,
      borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10,
      borderColor: 'rgba(248,113,113,0.2)', borderWidth: 1,
    },
    warnList: {
      paddingVertical: 12,
      borderTopWidth: 1, borderBottomWidth: 1,
      borderColor: C.borderSubtle,
      marginBottom: 18,
    },
    warnItem: {
      color: C.textSecondary, fontSize: 12, paddingVertical: 4,
    },
    seedGrid: {
      flexDirection: 'row', flexWrap: 'wrap',
      backgroundColor: C.bgElevated,
      borderRadius: 12, padding: 10,
      marginBottom: 14,
      gap: 6,
    },
    seedWord: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: C.bgCard,
      borderRadius: 8, paddingVertical: 7, paddingHorizontal: 9,
      width: '31%',
    },
    seedWordInput: {
      borderColor: C.blue, borderWidth: 1,
    },
    seedNum: { color: C.textMuted, fontSize: 10, fontWeight: '600' },
    seedText: { color: C.textPrimary, fontSize: 12, fontWeight: '500' },
    seedInput: {
      flex: 1,
      color: C.blue, fontSize: 12, fontWeight: '600',
      padding: 0,
    },
    copyableBox: {
      backgroundColor: C.bgElevated,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
      borderColor: C.borderSubtle, borderWidth: 1,
    },
    copyableText: {
      color: C.textPrimary,
      fontSize: 12,
      fontFamily: MONO,
      lineHeight: 18,
      letterSpacing: 0.2,
    },
    copyPhraseBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingVertical: 12,
      backgroundColor: C.blueDim,
      borderColor: 'rgba(59,122,247,0.22)', borderWidth: 1,
      borderRadius: 12,
    },
    copyPhraseBtnText: { color: C.blue, fontSize: 13, fontWeight: '700' },
    btnOutline: {
      height: 50,
      borderRadius: 14,
      borderColor: C.borderDefault, borderWidth: 1,
      backgroundColor: C.bgElevated,
      alignItems: 'center', justifyContent: 'center',
      marginTop: 8,
    },
    btnOutlineText: {
      color: C.textPrimary, fontSize: 14, fontWeight: '600',
      letterSpacing: -0.2,
    },
    btnLink: {
      color: C.blue, fontSize: 13, fontWeight: '600',
      textAlign: 'center', paddingVertical: 14,
      marginTop: 8,
      borderTopColor: C.borderSubtle, borderTopWidth: 1,
    },
  }));
}
