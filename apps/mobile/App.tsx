import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import 'react-native-get-random-values'; // polyfills global crypto.getRandomValues — required by vault.ts
import {
  Alert, Animated, Easing, Image, Linking, Modal, Pressable, RefreshControl, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Wallet, HDNodeWallet, Mnemonic, formatUnits } from 'ethers';
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
import { QrScannerModal } from './components/QrScannerModal';
import { WalletConnectModal, WalletConnectRequestHost } from './components/WalletConnect';
import { tokenIconSource } from './lib/token-icons';
import { getPortfolio, getActivity, type IndexerActivityItem } from './lib/indexer';
import { fetchEcosystemPrices } from './lib/pricing';
import { resolveRecipient, evmToLitho } from './lib/address';
import { sendAsset } from './lib/wc-signer';
import { SvgXml } from 'react-native-svg';
import { WebView } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowUpRight, ArrowDownLeft, Repeat, Plus,
  Home, Clock, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  Fingerprint, Zap, Globe, Server, Key, AlertTriangle, Moon, Sun, Shield,
  Copy, Share2, Eye, EyeOff, ScanFace, ScanLine, Search, Compass,
} from 'lucide-react-native';
import { ECOSYSTEM_APPS, ECOSYSTEM_HUB, type EcosystemApp, groupBySection, looksLikeUrl, normalizeUrl } from './lib/ecosystem';
import { discoverAppIcon } from './lib/token-icons';
import { fetchPortfolioHistory, type Holding, type PortfolioHistory, type Range } from './lib/price-history';

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
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
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

/** Brand colour per token symbol, for the Avatar circle. */
const ASSET_COLORS: Record<string, string> = {
  LITHO: '#8b7df7', WLITHO: '#a395f8', BTC: '#f7931a', LITBTC: '#f7931a',
  ETH: '#627eea', SOL: '#14f195', USDC: '#2775ca', USDT: '#26a17b',
  BNB: '#f3ba2f', JOT: '#3b7af7', IMAGE: '#10b981', LAX: '#a3e635',
  FGPT: '#10b981', FURGPT: '#10b981', COLLE: '#a3e635', AGII: '#8b7df7',
  BLDR: '#f97316', MUSA: '#eab308',
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

/** Fetch + price the wallet's portfolio from the indexer. */
function usePortfolio(address: string): PortfolioState {
  const [nonce, setNonce]   = useState(0);
  const [assets, setAssets] = useState<DisplayAsset[]>([]);
  const [totalUsd, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!address) { setAssets([]); setTotal(0); setLoading(false); setOffline(false); return; }
    let cancelled = false;
    setLoading(true); setOffline(false);
    (async () => {
      try {
        const [portfolio, prices] = await Promise.all([
          getPortfolio(address),
          fetchEcosystemPrices(),
        ]);
        if (cancelled) return;
        const next: DisplayAsset[] = portfolio.assets.map((a) => {
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
        setAssets(next);
        setTotal(next.reduce((s, a) => s + a.usdValue, 0));
        setLoading(false);
      } catch {
        if (cancelled) return;
        setAssets([]); setTotal(0); setLoading(false); setOffline(true);
      }
    })();
    return () => { cancelled = true; };
  }, [address, nonce]);

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

function HomeScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const C = useColors();
  const styles = useStyles();
  const addr = useWalletAddr();
  const { assets, totalUsd, loading, offline, reload } = usePortfolio(addr);
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
        <QuickAction Icon={Plus}          label="Buy"/>
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

      {/* Assets */}
      <View>
        <View style={styles.assetsHeader}>
          <Text style={styles.sectionTitle}>Assets</Text>
          <Text style={styles.assetsCount}>{assets.length}</Text>
        </View>
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
            <Pressable key={`${a.sym}-${a.chainId}`} style={[styles.row, i < assets.length - 1 && styles.rowBorder]}>
              <Avatar symbol={a.sym} color={a.color} />
              <View style={styles.rowMid}>
                <Text style={styles.rowSymbol}>{a.name}</Text>
                <Text style={styles.rowSub}>{a.priceUsd > 0 ? formatUsd(a.priceUsd) : '—'}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmt}>{formatUsd(a.usdValue)}</Text>
                <Text style={styles.rowBal}>{a.balanceText} {a.sym}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function SendScreen({ goBack }: { goBack: () => void }) {
  const C = useColors();
  const styles = useStyles();
  const addr = useWalletAddr();
  const seed = useWalletSeed();
  const { assets, loading } = usePortfolio(addr);
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [selectedSym, setSelectedSym] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const coin = assets.find((a) => a.sym === selectedSym) ?? assets[0] ?? null;
  const amtNum = parseFloat(amt || '0');
  const usd = coin ? amtNum * coin.priceUsd : 0;
  const overBalance = !!coin && amtNum > coin.balance;
  const recipientOk = isValidRecipient(to);
  const canReview = !!coin && amtNum > 0 && !overBalance && !!to && recipientOk && !sending;

  const doSend = async () => {
    if (!coin || sending) return;
    if (!coin.native && !coin.tokenAddress) {
      Alert.alert('Cannot send', `${coin.sym} has no contract address available.`);
      return;
    }
    setSending(true);
    try {
      const recipient = await resolveRecipient(to);
      const hash = await sendAsset({
        seed,
        to:           recipient,
        amount:       amt,
        decimals:     coin.decimals,
        tokenAddress: coin.native ? undefined : coin.tokenAddress,
      });
      setSending(false);
      setAmt(''); setTo('');
      Alert.alert(
        'Transaction sent ✓',
        `${amt} ${coin.sym} broadcast on Makalu.\n\nTx hash:\n${hash}`,
        [{ text: 'Done', onPress: goBack }],
      );
    } catch (e) {
      setSending(false);
      Alert.alert('Send failed', (e as Error)?.message || 'Could not broadcast the transaction.');
    }
  };

  const onReview = () => {
    if (!coin) return;
    Alert.alert(
      'Confirm send',
      `Send ${amt} ${coin.sym}\nTo: ${to}\n≈ ${formatUsd(usd)}\n\nThis broadcasts a real transaction on Makalu and cannot be undone.`,
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

      {/* From asset card */}
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

      {/* Amount card */}
      <View style={styles.assetSelectCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={styles.fieldLabel}>AMOUNT</Text>
          <Pressable
            onPress={() => coin && setAmt(String(coin.balance))}
            style={styles.maxBtn}
          >
            <Text style={styles.maxBtnText}>MAX</Text>
          </Pressable>
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
          {overBalance ? 'Amount exceeds balance' : `≈ ${formatUsd(usd)} USD`}
        </Text>
      </View>

      {/* Recipient */}
      <View style={styles.assetSelectCard}>
        <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>RECIPIENT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TextInput
            style={[styles.input, { flex: 1, backgroundColor: 'transparent', borderWidth: 0, padding: 0, fontSize: 14, fontFamily: 'monospace' }]}
            placeholder="0x… , litho1… or name.litho"
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
            Not a valid address or .litho name
          </Text>
        )}
      </View>

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

      <Pressable
        style={[styles.btnPrimary, !canReview && { opacity: 0.4 }]}
        disabled={!canReview}
        onPress={onReview}
      >
        <Text style={styles.btnPrimaryText}>{sending ? 'Sending…' : 'Review send'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function ReceiveScreen({ goBack }: { goBack: () => void }) {
  const C = useColors();
  const styles = useStyles();
  const walletAddr = useWalletAddr();
  const [copied, setCopied]   = useState(false);
  const [qrSvg, setQrSvg]     = useState<string | null>(null);
  const [showAlt, setShowAlt] = useState(false);   // false = litho1, true = 0x

  // Derive the Lithosphere bech32 form from the same 0x keypair — one
  // wallet, two formats. Defaults to showing the chain-native litho1.
  const lithoAddr = useMemo(() => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddr)) return '';
    try { return evmToLitho(walletAddr); } catch { return ''; }
  }, [walletAddr]);

  const displayed = lithoAddr && !showAlt ? lithoAddr : walletAddr;

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

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.screenHeader}>
        <Pressable onPress={goBack} hitSlop={16} style={styles.backBtn}>
          <ChevronLeft size={22} color={C.textPrimary} strokeWidth={2.2}/>
        </Pressable>
        <Text style={styles.screenTitle}>Receive</Text>
        <View style={{ width: 36 }}/>
      </View>

      <View style={styles.receiveCard}>
        {/* Network selector */}
        <Pressable style={styles.networkSelector}>
          <View style={styles.netDot}/>
          <Text style={styles.networkSelectorText}>Lithosphere · Makalu</Text>
          <ChevronRight size={18} color={C.textMuted}/>
        </Pressable>

        {/* Litho1 / EVM toggle — same wallet, two address formats. */}
        {!!lithoAddr && (
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
          <Text style={styles.addrTextLarge} numberOfLines={1} ellipsizeMode="middle">
            {displayed || '—'}
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={[styles.btnSecondary, { flex: 1 }]} onPress={copy}>
            <Text style={styles.btnSecondaryText}>{copied ? '✓ Copied' : 'Copy address'}</Text>
          </Pressable>
          <Pressable style={[styles.btnSecondary, { flex: 1 }]}>
            <Text style={styles.btnSecondaryText}>Share</Text>
          </Pressable>
        </View>

        <View style={styles.warningCard}>
          <Text style={styles.warningCardText}>
            Only send LITHO and Makalu-network tokens to this address. Sending other assets may result in permanent loss.
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

      {/* Filter pills */}
      <View style={styles.filterRow}>
        {['All', 'Sent', 'Received', 'Swap'].map((f, i) => (
          <Pressable key={f} style={[styles.filterPill, i === 0 && styles.filterPillActive]}>
            <Text style={[styles.filterPillText, i === 0 && styles.filterPillTextActive]}>{f}</Text>
          </Pressable>
        ))}
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
        {!loading && !offline && items.length === 0 && (
          <Text style={[styles.rowSub, { padding: 16 }]}>No transactions yet.</Text>
        )}
        {items.map((t, i) => {
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
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.textPrimary }}>Explore Web3</Text>
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
  const isDark = C.bgBase === DARK.bgBase;

  /* Biometric capability + enabled-state. Refreshes after the user
     toggles it so the row reflects reality. */
  const [bioKind, setBioKind]   = useState<BiometricKind>('none');
  const [bioReady, setBioReady] = useState(false);
  const [bioOn, setBioOn]       = useState(false);
  const [copied, setCopied]     = useState(false);
  const [wcOpen, setWcOpen]     = useState(false);

  const refreshBio = async () => {
    const cap = await getBiometricCapability();
    setBioKind(cap.kind);
    setBioReady(cap.hasHardware && cap.isEnrolled);
    setBioOn(await isBiometricUnlockEnabled());
  };
  useEffect(() => { void refreshBio(); }, []);

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
    { label: 'Auto-lock',         desc: 'After 5 minutes of inactivity',   Icon: Clock },
    { label: 'Change password',   desc: 'Update wallet password',          Icon: Key },
    { label: 'Recovery phrase',   desc: 'View your 12 / 24-word seed',     Icon: AlertTriangle, danger: true },
  ];
  const NETWORK_OPTS: SettingItem[] = [
    { label: 'Network',           desc: 'Makalu (mainnet)',                Icon: Globe },
    { label: 'Custom RPC',        desc: 'rpc.litho.ai',                    Icon: Server },
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
          <Text style={styles.acctHeaderName}>Account 1</Text>
          <Text style={styles.acctHeaderAddr} numberOfLines={1} ellipsizeMode="middle">
            {walletAddr || '—'}
          </Text>
        </View>
        <Pressable style={styles.copyChip} onPress={copyAddr}>
          <Text style={styles.copyChipText}>{copied ? '✓' : 'Copy'}</Text>
        </Pressable>
      </View>

      <Section Icon={Shield} title="Security"   sub="Protect access to your wallet" items={SECURITY_OPTS}/>
      <Section Icon={Globe}  title="Network"    sub="Connection and RPC endpoints"  items={NETWORK_OPTS}/>

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
    </ScrollView>
  );
}

/* ─────────────────────────── Shell ─────────────────────────── */

type Screen = 'home' | 'send' | 'receive' | 'swap' | 'discover' | 'activity' | 'settings';

const TABS: { key: Screen; label: string; Icon: any }[] = [
  { key: 'home',     label: 'Home',     Icon: Home },
  { key: 'swap',     label: 'Swap',     Icon: Repeat },
  { key: 'discover', label: 'Discover', Icon: Compass },
  { key: 'activity', label: 'Activity', Icon: Clock },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon },
];

/* ─────────────────── Wallet helpers ─────────────────── */

function generateMnemonic(): string[] {
  try {
    const w = Wallet.createRandom();
    return w.mnemonic!.phrase.split(' ');
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

function deriveEvmAddress(seed: string[]): string {
  try {
    return HDNodeWallet.fromPhrase(seed.join(' '), undefined, "m/44'/60'/0'/0/0").address;
  } catch { return '0x0000000000000000000000000000000000000000'; }
}

// Storage keys live in ./lib/vault.ts now — these legacy AsyncStorage keys
// are only referenced by migrateLegacyPlaintext() and get wiped on first run.

/* ─────────────────── Onboarding ─────────────────── */

type OnboardStep = 'welcome' | 'create-warn' | 'create-show' | 'create-confirm'
                 | 'create-pwd' | 'import' | 'import-pwd' | 'unlock';

function OnboardingScreen({
  hasVault,
  onComplete,
}: { hasVault: boolean; onComplete: (seed: string[]) => void }) {
  const C = useColors();
  const styles = useStyles();
  const [step, setStep] = useState<OnboardStep>(hasVault ? 'unlock' : 'welcome');
  const [seed, setSeed] = useState<string[]>([]);
  const [importInput, setImportInput] = useState('');
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

  const startCreate = () => { setSeed(generateMnemonic()); setStep('create-warn'); };

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
    <ScrollView style={[styles.scroll, { backgroundColor: C.bgBase }]} contentContainerStyle={styles.onboardWrap}>
      <View style={styles.onboardCard}>
        <View style={styles.onboardLogo}>
          <View style={styles.onboardLogoGlow}/>
          <Image
            source={require('./assets/images/Thanos_Logo_Transparent.png')}
            style={styles.onboardLogoImage}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.onboardBrand}>Thanos Wallet</Text>

        <AnimatedSwitch keyName={step} style={{ width: '100%' }}>

        {step === 'welcome' && <>
          <Text style={styles.onboardTitle}>Welcome to Thanos</Text>
          <Text style={styles.onboardSub}>Multi-chain Web4 wallet. Lithosphere · Bitcoin · EVM.</Text>
          <Pressable style={styles.btnPrimary} onPress={startCreate}>
            <Text style={styles.btnPrimaryText}>Create new wallet</Text>
          </Pressable>
          <Pressable style={styles.btnOutline} onPress={() => setStep('import')}>
            <Text style={styles.btnOutlineText}>Import existing wallet</Text>
          </Pressable>
        </>}

        {step === 'create-warn' && <>
          <Text style={styles.onboardTitle}>Save your recovery phrase</Text>
          <Text style={styles.onboardSub}>12 words below are the only way to restore your wallet. Anyone with these words has full access. Never share them online.</Text>
          <View style={styles.warnList}>
            <Text style={styles.warnItem}>✓  Write them down on paper</Text>
            <Text style={styles.warnItem}>✓  Keep them somewhere private</Text>
            <Text style={styles.warnItem}>✓  Thanos will never ask for this phrase</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[styles.btnOutline, { flex: 1 }]} onPress={() => setStep('welcome')}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </Pressable>
            <Pressable style={[styles.btnPrimary, { flex: 1, marginTop: 0 }]} onPress={() => setStep('create-show')}>
              <Text style={styles.btnPrimaryText}>I understand</Text>
            </Pressable>
          </View>
        </>}

        {step === 'create-show' && <>
          <Text style={styles.onboardTitle}>Your recovery phrase</Text>
          <Text style={styles.onboardSub}>Write these 12 words down in order. Long-press any word to select, or tap Copy below.</Text>
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
            <Pressable style={[styles.btnOutline, { flex: 1 }]} onPress={() => setStep('create-warn')}>
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
                <Text style={{ color: C.textPrimary, fontFamily: 'monospace', fontSize: 12, fontWeight: '600' }}>{w}</Text>
              </Pressable>
            ))}
          </View>
          {orderMismatch && <Text style={{ color: C.red, fontSize: 12, marginBottom: 8 }}>Order doesn't match. Tap slots to undo.</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={[styles.btnOutline, { flex: 1 }]} onPress={() => setStep('create-show')}>
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
              style={[styles.btnOutline, { flex: 1 }]}
              onPress={() => setStep(step === 'create-pwd' ? 'create-confirm' : 'import')}
            >
              <Text style={styles.btnOutlineText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1, marginTop: 0, opacity: (password.length >= 8 && password === password2 && !busy) ? 1 : 0.45 }]}
              disabled={password.length < 8 || password !== password2 || busy}
              onPress={step === 'create-pwd' ? finishCreate : finishImport}
            >
              <Text style={styles.btnPrimaryText}>
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
            <Pressable style={[styles.btnOutline, { flex: 1 }]} onPress={() => setStep('welcome')}>
              <Text style={styles.btnOutlineText}>Back</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, { flex: 1, marginTop: 0 }]}
              onPress={() => setStep('import-pwd')}
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
function InAppBrowser({ url, onClose }: { url: string; onClose: () => void }) {
  const C = useColors();
  const ref = useRef<WebView>(null);
  const [current, setCurrent] = useState(url);
  const [loading, setLoading] = useState(true);
  let host = current;
  try { host = new URL(current).host; } catch { /* keep raw */ }

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
          style={{ flex: 1, backgroundColor: C.bgBase }}
          allowsBackForwardNavigationGestures
          /* Keep the wallet's keys isolated from arbitrary dApp pages: no
             auto-injected provider yet (full WalletConnect-in-webview is a
             follow-up). Third-party cookies on for normal site logins. */
          setSupportMultipleWindows={false}
        />
      </SafeAreaView>
    </Modal>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [isDark, setIsDark] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [walletSeed, setWalletSeed] = useState<string[]>([]);
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);

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
      } else {
        clearSessionKey();
      }
    })().catch(() => { /* fall through to onboarding */ });
  }, []);

  const colors = isDark ? DARK : LIGHT;
  const styles = useMemo(() => makeStyles(colors), [isDark]);
  const toggle = () => setIsDark(d => !d);

  const handleLock = () => {
    setUnlocked(false);
    setWalletSeed([]);
    clearSessionKey();
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

  const walletAddr = walletSeed.length > 0 ? deriveEvmAddress(walletSeed) : '0x0000…0000';
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

            {/* Always-mounted WalletConnect listener — pops an approve/
                reject sheet whenever a paired dApp sends a sign request. */}
            <WalletConnectRequestHost seed={walletSeed}/>

            {/* In-app browser overlay (Discover dApps / typed links) */}
            {browserUrl && <InAppBrowser url={browserUrl} onClose={() => setBrowserUrl(null)}/>}

            {/* Top header */}
            <View style={styles.topbar}>
              <Pressable style={styles.acct} onLongPress={() => Alert.alert(
                'Lock wallet?',
                'You\'ll need your password to unlock.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Lock', style: 'destructive', onPress: handleLock },
                ],
              )}>
                <View style={styles.acctAvatar}><Text style={styles.acctAvatarText}>○</Text></View>
                <View>
                  <Text style={styles.acctName}>Account 1</Text>
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
                {screen === 'home'     && <HomeScreen navigate={setScreen}/>}
                {screen === 'send'     && <SendScreen goBack={() => setScreen('home')}/>}
                {screen === 'receive'  && <ReceiveScreen goBack={() => setScreen('home')}/>}
                {screen === 'swap'     && <SendScreen goBack={() => setScreen('home')}/>}
                {screen === 'discover' && <DiscoverScreen/>}
                {screen === 'activity' && <ActivityScreen/>}
                {screen === 'settings' && <SettingsScreen/>}
              </AnimatedSwitch>
            </View>

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
    acctAddr: { color: C.textMuted, fontSize: 10, fontFamily: 'monospace', marginTop: 1 },

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
    rowBal:   { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: 'monospace' },

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
      color: C.textPrimary, fontSize: 13, fontFamily: 'monospace',
      marginTop: 6, letterSpacing: -0.2,
    },
    warningCard: {
      backgroundColor: 'rgba(234,179,8,0.08)',
      borderColor: 'rgba(234,179,8,0.22)', borderWidth: 1,
      borderRadius: 10, padding: 10,
    },
    warningCardText: { color: '#92590a', fontSize: 11, lineHeight: 16 },

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
    acctHeaderAddr: { color: C.textMuted, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
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
      backgroundColor: C.purple500,
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
    qrPlaceholderText: { color: C.purple500, fontSize: 38, fontWeight: '900' },
    addrBox: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: C.bgElevated,
      borderColor: C.borderSubtle, borderWidth: 1,
      borderRadius: 12, padding: 12,
    },
    addrText: { flex: 1, color: C.textSecondary, fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
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
      marginBottom: 10,
      position: 'relative',
      height: 80,
    },
    onboardLogoGlow: {
      position: 'absolute',
      width: 120, height: 120, borderRadius: 60,
      backgroundColor: C.blue, opacity: 0.12,
      top: -20,
    },
    onboardLogoImage: {
      width: 76, height: 76,
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
      fontFamily: 'monospace',
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
      height: 48,
      borderRadius: 12,
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
