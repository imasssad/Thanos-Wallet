import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  Pressable, SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';

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
  statusBar:     'light-content' as const,
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
  statusBar:     'dark-content' as const,
};

type Colors = typeof DARK;

const ThemeCtx   = createContext<Colors>(DARK);
const ToggleCtx  = createContext<() => void>(() => {});
const StylesCtx  = createContext(makeStyles(DARK));

function useColors()  { return useContext(ThemeCtx); }
function useToggle()  { return useContext(ToggleCtx); }
function useStyles()  { return useContext(StylesCtx); }

/* ─────────────────────────── Mock data ─────────────────────────── */

const ACCOUNT_ADDR = 'litho1a7kxm8gq3n2p4d9fh6we0r1t5y8u3i2o9z4v';

const ASSETS = [
  { sym: 'LITHO', name: 'Lithosphere', chain: 'Makalu',  bal: '4,280.00', usd: '$1,284.00', price: '$0.300',  chg:  3.42, color: '#8b7df7' },
  { sym: 'BTC',   name: 'Bitcoin',     chain: 'Bitcoin', bal: '0.04821',  usd: '$2,891.00', price: '$59,962', chg: -1.17, color: '#f7931a' },
  { sym: 'SOL',   name: 'Solana',      chain: 'Solana',  bal: '12.380',   usd: '$1,772.00', price: '$143.10', chg:  5.88, color: '#14f195' },
  { sym: 'ETH',   name: 'Ethereum',    chain: 'EVM',     bal: '0.6142',   usd: '$2,210.00', price: '$3,598',  chg:  0.54, color: '#627eea' },
  { sym: 'USDC',  name: 'USD Coin',    chain: 'EVM',     bal: '840.00',   usd: '$840.00',   price: '$1.00',   chg:  0.01, color: '#2775ca' },
  { sym: 'COLLE', name: 'Colle AI',    chain: 'Makalu',  bal: '18,000',   usd: '$360.00',   price: '$0.020',  chg:  8.22, color: '#10b981' },
];

const TXS = [
  { type: 'Received', sym: 'LITHO', amt: '+1,200',  time: '2 min ago',  pos: true  },
  { type: 'Sent',     sym: 'BTC',   amt: '-0.012',  time: '1 hr ago',   pos: false },
  { type: 'Swap',     sym: 'SOL',   amt: '2.4',     time: '3 hr ago',   pos: false },
  { type: 'Received', sym: 'USDC',  amt: '+840',    time: 'Yesterday',  pos: true  },
];

/* ─────────────────────────── Reusable bits ─────────────────────────── */

function Avatar({ symbol, color, size = 36 }: { symbol: string; color: string; size?: number }) {
  const styles = useStyles();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{symbol.slice(0, 1)}</Text>
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const styles = useStyles();
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/* ─────────────────────────── Screens ─────────────────────────── */

function HomeScreen({ navigate }: { navigate: (s: Screen) => void }) {
  const C = useColors();
  const styles = useStyles();

  const QuickAction = ({ icon, label, onPress }: { icon: string; label: string; onPress?: () => void }) => (
    <Pressable style={styles.qaBtn} onPress={onPress}>
      <View style={styles.qaIcon}><Text style={styles.qaIconText}>{icon}</Text></View>
      <Text style={styles.qaLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {/* Balance hero */}
      <View style={styles.balanceBlock}>
        <Text style={styles.balanceLabel}>TOTAL BALANCE</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
          <Text style={styles.balanceAmt}>$9,357.00</Text>
          <View style={styles.changePill}>
            <Text style={styles.changePillText}>▲ 2.34%</Text>
          </View>
        </View>
        <Text style={styles.balanceSub}>+$214.32 today</Text>
      </View>

      {/* Quick actions row (pills) */}
      <View style={styles.qaRow}>
        <QuickAction icon="↑" label="Send"    onPress={() => navigate('send')}/>
        <QuickAction icon="↓" label="Receive" onPress={() => navigate('receive')}/>
        <QuickAction icon="⇄" label="Swap"    onPress={() => navigate('swap')}/>
        <QuickAction icon="+" label="Buy"/>
      </View>

      {/* Assets */}
      <View>
        <View style={styles.assetsHeader}>
          <Text style={styles.sectionTitle}>Assets</Text>
          <Text style={styles.assetsCount}>{ASSETS.length}</Text>
        </View>
        <View style={styles.card}>
          {ASSETS.map((a, i) => (
            <Pressable key={`${a.sym}-${a.chain}`} style={[styles.row, i < ASSETS.length - 1 && styles.rowBorder]}>
              <Avatar symbol={a.sym} color={a.color} />
              <View style={styles.rowMid}>
                <Text style={styles.rowSymbol}>{a.name}</Text>
                <Text style={styles.rowSub}>
                  {a.price} <Text style={{ color: a.chg >= 0 ? C.green : C.red, fontWeight: '600' }}>{a.chg >= 0 ? '+' : ''}{a.chg.toFixed(2)}%</Text>
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowAmt}>{a.usd}</Text>
                <Text style={styles.rowBal}>{a.bal} {a.sym}</Text>
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
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerRow}>
        <Pressable onPress={goBack} hitSlop={12}><Text style={styles.backText}>←  Back</Text></Pressable>
      </View>
      <Text style={styles.pageTitle}>Send LITHO</Text>

      <View>
        <Text style={styles.fieldLabel}>Recipient</Text>
        <TextInput
          style={styles.input}
          placeholder="litho1… or name.litho"
          placeholderTextColor={C.textMuted}
          value={to}
          onChangeText={setTo}
        />
      </View>

      <View>
        <Text style={styles.fieldLabel}>Amount</Text>
        <TextInput
          style={styles.input}
          placeholder="0.00"
          placeholderTextColor={C.textMuted}
          value={amt}
          onChangeText={setAmt}
          keyboardType="decimal-pad"
        />
      </View>

      {!!amt && (
        <View style={styles.feeRow}>
          <Text style={styles.feeText}>Network fee</Text>
          <Text style={styles.feeText}>~0.002 LITHO</Text>
        </View>
      )}

      <Pressable
        style={[styles.btnPrimary, (!to || !amt) && { opacity: 0.4 }]}
        disabled={!to || !amt}
      >
        <Text style={styles.btnPrimaryText}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

function ReceiveScreen({ goBack }: { goBack: () => void }) {
  const C = useColors();
  const styles = useStyles();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerRow}>
        <Pressable onPress={goBack} hitSlop={12}><Text style={styles.backText}>←  Back</Text></Pressable>
      </View>
      <Text style={styles.pageTitle}>Receive on Makalu</Text>

      <View style={styles.qrFrame}>
        <View style={styles.qrPlaceholder}>
          <Text style={styles.qrPlaceholderText}>QR</Text>
        </View>
      </View>

      <View style={styles.addrBox}>
        <Text style={styles.addrText}>{ACCOUNT_ADDR}</Text>
        <Pressable style={styles.copyBtn}><Text style={styles.copyBtnText}>Copy</Text></Pressable>
      </View>

      <Text style={styles.helperText}>
        Only send LITHO and Makalu-network tokens to this address.
      </Text>
    </ScrollView>
  );
}

function ActivityScreen() {
  const C = useColors();
  const styles = useStyles();
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>Activity</Text>
      <View style={styles.card}>
        {TXS.map((t, i) => (
          <Pressable key={i} style={[styles.row, i < TXS.length - 1 && styles.rowBorder]}>
            <View style={[styles.txIcon, { backgroundColor: t.pos ? C.greenDim : C.purpleGlow }]}>
              <Text style={[styles.txArrow, { color: t.pos ? C.green : C.purple300 }]}>
                {t.type === 'Sent' ? '↗' : t.type === 'Received' ? '↙' : '⇄'}
              </Text>
            </View>
            <View style={styles.rowMid}>
              <Text style={styles.rowSymbol}>{t.type}</Text>
              <Text style={styles.rowSub}>{t.time}</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.rowAmt, { color: t.pos ? C.green : C.textPrimary }]}>
                {t.amt} {t.sym}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

function SettingsScreen() {
  const C = useColors();
  const styles = useStyles();
  const toggle = useToggle();
  const isDark = C.bgBase === DARK.bgBase;

  const SETTINGS = [
    { label: 'Biometric unlock', desc: 'Use Face ID to unlock' },
    { label: 'Connected dApps',  desc: '2 active sessions' },
    { label: 'Network',          desc: 'Makalu (testnet)' },
    { label: 'Recovery phrase',  desc: 'View 12-word seed', danger: true },
  ];
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.pageTitle}>Settings</Text>
      <SectionTitle>WALLET</SectionTitle>
      <View style={styles.card}>
        {SETTINGS.map((s, i) => (
          <Pressable key={i} style={[styles.settingRow, i < SETTINGS.length - 1 && styles.rowBorder]}>
            <View>
              <Text style={[styles.settingLabel, s.danger && { color: C.red }]}>{s.label}</Text>
              <Text style={styles.settingDesc}>{s.desc}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
      <SectionTitle>APPEARANCE</SectionTitle>
      <View style={styles.card}>
        <Pressable style={styles.settingRow} onPress={toggle}>
          <View>
            <Text style={styles.settingLabel}>Theme</Text>
            <Text style={styles.settingDesc}>{isDark ? 'Dark mode' : 'Light mode'} — tap to switch</Text>
          </View>
          <Text style={{ fontSize: 18 }}>{isDark ? '☀' : '🌙'}</Text>
        </Pressable>
      </View>
      <Text style={styles.versionText}>Thanos Wallet v0.8.1 · Makalu Sync</Text>
    </ScrollView>
  );
}

/* ─────────────────────────── Shell ─────────────────────────── */

type Screen = 'home' | 'send' | 'receive' | 'swap' | 'activity' | 'settings';

const TABS: { key: Screen; label: string; icon: string }[] = [
  { key: 'home',     label: 'Home',     icon: '◇' },
  { key: 'swap',     label: 'Swap',     icon: '⇄' },
  { key: 'activity', label: 'Activity', icon: '◷' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [isDark, setIsDark] = useState(true);

  const colors = isDark ? DARK : LIGHT;
  const styles = useMemo(() => makeStyles(colors), [isDark]);
  const toggle = () => setIsDark(d => !d);

  return (
    <ThemeCtx.Provider value={colors}>
      <StylesCtx.Provider value={styles}>
        <ToggleCtx.Provider value={toggle}>
          <SafeAreaView style={styles.root}>
            <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bgBase} />

            {/* Top header */}
            <View style={styles.topbar}>
              <Pressable style={styles.acct}>
                <View style={styles.acctAvatar}><Text style={styles.acctAvatarText}>○</Text></View>
                <View>
                  <Text style={styles.acctName}>Account 1</Text>
                  <Text style={styles.acctAddr}>{ACCOUNT_ADDR.slice(0, 7)}…{ACCOUNT_ADDR.slice(-5)}</Text>
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

            {/* Body */}
            <View style={styles.body}>
              {screen === 'home'     && <HomeScreen navigate={setScreen}/>}
              {screen === 'send'     && <SendScreen goBack={() => setScreen('home')}/>}
              {screen === 'receive'  && <ReceiveScreen goBack={() => setScreen('home')}/>}
              {screen === 'swap'     && <SendScreen goBack={() => setScreen('home')}/>}
              {screen === 'activity' && <ActivityScreen/>}
              {screen === 'settings' && <SettingsScreen/>}
            </View>

            {/* Bottom tabs */}
            <View style={styles.tabbar}>
              {TABS.map(t => {
                const active = screen === t.key || (t.key === 'home' && (screen === 'send' || screen === 'receive'));
                return (
                  <Pressable key={t.key} style={styles.tab} onPress={() => setScreen(t.key)}>
                    {active && <View style={styles.tabActiveBar}/>}
                    <Text style={[styles.tabIcon, active && { color: colors.blue }]}>{t.icon}</Text>
                    <Text style={[styles.tabLabel, active && { color: colors.blue, fontWeight: '700' }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </SafeAreaView>
        </ToggleCtx.Provider>
      </StylesCtx.Provider>
    </ThemeCtx.Provider>
  );
}

/* ─────────────────────────── Styles ─────────────────────────── */

function makeStyles(C: Colors) {
  return StyleSheet.create({
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

    netPill: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 10, paddingVertical: 4,
      backgroundColor: 'rgba(74,222,128,0.07)',
      borderColor: 'rgba(74,222,128,0.16)', borderWidth: 1,
      borderRadius: 999,
    },
    netDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
    netText: { color: C.green, fontSize: 11, fontWeight: '600' },

    /* Balance hero */
    balanceBlock: { paddingVertical: 14, paddingHorizontal: 4 },
    balanceLabel: {
      color: C.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.2,
    },
    balanceAmt:   {
      color: C.textPrimary, fontSize: 38, fontWeight: '800', letterSpacing: -1.4,
    },
    balanceSub:   { color: C.textMuted, fontSize: 12, fontWeight: '500', marginTop: 6 },
    changePill: {
      paddingHorizontal: 9, paddingVertical: 3,
      backgroundColor: C.greenDim,
      borderRadius: 999, borderWidth: 1, borderColor: 'rgba(16,185,129,0.22)',
    },
    changePillText: { color: C.green, fontSize: 11, fontWeight: '700' },

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
  });
}
