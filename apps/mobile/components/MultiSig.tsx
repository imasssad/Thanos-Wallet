/**
 * Thanos MultiSig on mobile (LEP100-15 §82–84): the same screens and flows as the web app, the
 * extension and the desktop app, in React Native. The logic is the shared core in lib/multisig
 * (a copy of packages/multisig/src, kept in step by scripts/sync-multisig.mjs); signing goes
 * through lib/signer, where the seed already lives.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatUnits } from 'ethers';
import {
  AIMode,
  PROPOSAL_STATE_LABEL,
  ProposalState,
  SIGNER_TYPE_LABEL,
  SignerType,
  describeError,
  displayAccount,
  explorerTxUrl,
  formatTimestamp,
  formatTokenUnits,
  isAnyAddress,
  isHumanSigner,
  parseAddress,
  shortAccount,
  toLithoAddress,
  type Address,
  type Call,
  type ReviewField,
  type TransactionReview,
} from '@litho-vault/sdk';
import {
  MultisigClient,
  cleanVaultName,
  multisigNetwork,
  type KeyValueStore,
  type MultisigNetwork,
  type ProposalLine,
  type WalletBridge,
} from '../lib/multisig';
import { deriveAddress, signAndBroadcast, signTypedData } from '../lib/signer';

/** The palette App.tsx passes down (its DARK or LIGHT colours). */
export interface MultiSigColors {
  bgBase: string; bgCard: string; bgElevated: string; bgHover: string; bgSurface: string;
  borderSubtle: string; borderDefault: string;
  blue: string; blueDim: string; green: string; greenDim: string; red: string; redDim: string; orange: string;
  textPrimary: string; textSecondary: string; textMuted: string;
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' }) as string;

const asyncStore: KeyValueStore = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
};

let cachedNetwork: MultisigNetwork | null = null;
function mobileMultisigNetwork(): MultisigNetwork {
  cachedNetwork ??= multisigNetwork({
    CHAIN_ID:       process.env.EXPO_PUBLIC_MULTISIG_CHAIN_ID,
    CHAIN_NAME:     process.env.EXPO_PUBLIC_MULTISIG_CHAIN_NAME,
    RPC_URL:        process.env.EXPO_PUBLIC_MULTISIG_RPC_URL,
    EXPLORER_URL:   process.env.EXPO_PUBLIC_MULTISIG_EXPLORER_URL,
    FACTORY:        process.env.EXPO_PUBLIC_MULTISIG_FACTORY,
    LENS:           process.env.EXPO_PUBLIC_MULTISIG_LENS,
    AI_GUARD:       process.env.EXPO_PUBLIC_MULTISIG_AI_GUARD,
    RECOVERY_GUARD: process.env.EXPO_PUBLIC_MULTISIG_RECOVERY_GUARD,
    FREEZE_GUARD:   process.env.EXPO_PUBLIC_MULTISIG_FREEZE_GUARD,
    IMPLEMENTATION: process.env.EXPO_PUBLIC_MULTISIG_IMPLEMENTATION,
    DEPLOY_BLOCK:   process.env.EXPO_PUBLIC_MULTISIG_DEPLOY_BLOCK,
    INDEXER_URL:    process.env.EXPO_PUBLIC_MULTISIG_INDEXER_URL,
    APP_URL:        process.env.EXPO_PUBLIC_MULTISIG_APP_URL,
  });
  return cachedNetwork;
}

/** The active account's bridge; the HD path is fixed when made and checked before each signature. */
function mobileMultisigBridge(address: string, accountIndex: number): WalletBridge {
  const hdPath = `m/44'/60'/0'/0/${accountIndex}`;
  const check = () => {
    if (deriveAddress(hdPath).toLowerCase() !== address.toLowerCase()) throw new Error('The active account changed. Go back and try again.');
  };
  return {
    address,
    canSign: true,
    sendTransaction: async (tx) => {
      check();
      return signAndBroadcast(hdPath, { to: tx.to, data: tx.data, value: tx.value, gasLimit: tx.gasLimit }, { chainId: tx.chainId, rpcUrl: tx.rpcUrl });
    },
    signTypedData: async ({ domain, types, message }) => {
      check();
      return signTypedData(hdPath, { domain, types, value: message });
    },
    openUrl: (url) => void Linking.openURL(url),
  };
}

// ─────────────────────────────── state helpers ───────────────────────────────

function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]) {
  const [state, setState] = useState<{ data?: T; error: string | null; loading: boolean }>({ error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e) => alive && setState((s) => ({ ...s, error: describeError(e), loading: false })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(describeError(e));
      return undefined;
    } finally {
      busy.current = false;
      setPending(null);
    }
  }, []);
  return { pending, error, run };
}

type Route =
  | { name: 'home' }
  | { name: 'vault'; address: Address }
  | { name: 'proposal'; address: Address; id: bigint }
  | { name: 'transfer'; address: Address }
  | { name: 'create' }
  | { name: 'add' };

interface Ctx {
  client: MultisigClient;
  chainId: number;
  account: Address | null;
  C: MultiSigColors;
  s: ReturnType<typeof makeStyles>;
  go: (r: Route) => void;
  replace: (r: Route) => void;
  back: () => void;
}

// ─────────────────────────────── root ───────────────────────────────

export function MultiSigScreen({ address, accountIndex, colors, goBack }: { address: string | null; accountIndex: number; colors: MultiSigColors; goBack: () => void }) {
  const network = useMemo(() => mobileMultisigNetwork(), []);
  const bridge = useMemo(() => (address ? mobileMultisigBridge(address, accountIndex) : null), [address, accountIndex]);
  const client = useMemo(() => new MultisigClient(network, bridge, { store: asyncStore }), [network, bridge]);
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1]!;
  const ctx: Ctx = {
    client,
    chainId: network.chain.id,
    account: (parseAddress(address ?? '') ?? null) as Address | null,
    C: colors,
    s,
    go: (r) => setStack((st) => [...st, r]),
    replace: (r) => setStack((st) => [...st.slice(0, -1), r]),
    back: () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)),
  };
  const onBack = stack.length > 1 ? ctx.back : goBack;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" testID="thanos-multisig">
      {route.name === 'home' && <Home ctx={ctx} onBack={onBack} />}
      {route.name === 'vault' && <Vault key={route.address} ctx={ctx} address={route.address} onBack={onBack} />}
      {route.name === 'proposal' && <Proposal key={`${route.address}:${route.id}`} ctx={ctx} address={route.address} id={route.id} onBack={onBack} />}
      {route.name === 'transfer' && <Transfer ctx={ctx} address={route.address} onBack={onBack} />}
      {route.name === 'create' && <Create ctx={ctx} onBack={onBack} />}
      {route.name === 'add' && <Add ctx={ctx} onBack={onBack} />}
    </ScrollView>
  );
}

// ─────────────────────────────── primitives ───────────────────────────────

function Header({ ctx, title, subtitle, onBack, onRefresh }: { ctx: Ctx; title: React.ReactNode; subtitle?: React.ReactNode; onBack?: () => void; onRefresh?: () => void }) {
  const { s } = ctx;
  return (
    <View style={s.header}>
      {onBack && (
        <Pressable onPress={onBack} style={s.iconBtn} accessibilityLabel="Back" testID="tms-back">
          <Text style={s.iconText}>‹</Text>
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      </View>
      {onRefresh && (
        <Pressable onPress={onRefresh} style={s.iconBtn} accessibilityLabel="Refresh">
          <Text style={s.iconText}>↻</Text>
        </Pressable>
      )}
    </View>
  );
}

function Card({ ctx, title, children, right }: { ctx: Ctx; title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={ctx.s.card}>
      {(title || right) && (
        <View style={ctx.s.cardHead}>
          {title ? <Text style={ctx.s.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

function Btn({ ctx, label, onPress, kind = 'secondary', disabled, testID }: { ctx: Ctx; label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; testID?: string }) {
  const { s } = ctx;
  return (
    <Pressable onPress={onPress} disabled={disabled} testID={testID} style={[s.btn, kind === 'primary' ? s.btnPrimary : kind === 'danger' ? s.btnDanger : s.btnSecondary, disabled && { opacity: 0.45 }]}>
      <Text style={[s.btnText, kind === 'primary' && { color: '#fff' }, kind === 'danger' && { color: ctx.C.red }]}>{label}</Text>
    </Pressable>
  );
}

type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'bad';
function toneColors(C: MultiSigColors, tone: Tone) {
  switch (tone) {
    case 'info': return { bg: C.blueDim, fg: C.blue };
    case 'good': return { bg: C.greenDim, fg: C.green };
    case 'warn': return { bg: C.redDim, fg: C.orange };
    case 'bad': return { bg: C.redDim, fg: C.red };
    default: return { bg: C.bgElevated, fg: C.textSecondary };
  }
}

function Pill({ ctx, tone = 'neutral', label, testID }: { ctx: Ctx; tone?: Tone; label: string; testID?: string }) {
  const t = toneColors(ctx.C, tone);
  return (
    <View style={[ctx.s.pill, { backgroundColor: t.bg }]} testID={testID}>
      <Text style={[ctx.s.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

function Notice({ ctx, tone = 'info', text, testID }: { ctx: Ctx; tone?: Exclude<Tone, 'neutral'>; text: string; testID?: string }) {
  const t = toneColors(ctx.C, tone);
  return (
    <View style={[ctx.s.notice, { backgroundColor: t.bg, borderColor: t.fg }]} testID={testID}>
      <Text style={ctx.s.noticeText}>{text}</Text>
    </View>
  );
}

function Loading({ ctx, label }: { ctx: Ctx; label?: string }) {
  return (
    <View style={ctx.s.loading}>
      <ActivityIndicator color={ctx.C.blue} />
      {label ? <Text style={ctx.s.muted}>{label}</Text> : null}
    </View>
  );
}

function Err({ ctx, error }: { ctx: Ctx; error: string | null | undefined }) {
  return error ? <Notice ctx={ctx} tone="bad" text={error} testID="tms-error" /> : null;
}

/**
 * Every address as litho1… (people, the multisig, tokens). Full views add the 0x form on a second
 * line; in compact ones a tap switches to 0x…. Long-press copies the form shown.
 */
function Addr({ ctx, address, full = false }: { ctx: Ctx; address: string; full?: boolean }) {
  const [showEvm, setShowEvm] = useState(false);
  const a = parseAddress(address);
  if (!a) return <Text style={ctx.s.mono}>{address}</Text>;
  const litho = toLithoAddress(a);
  if (full) {
    return (
      <View>
        <Pressable onLongPress={() => void Clipboard.setStringAsync(litho)} accessibilityLabel="Long-press to copy the litho1 address">
          <Text style={ctx.s.mono}>{litho}</Text>
        </Pressable>
        <Pressable onLongPress={() => void Clipboard.setStringAsync(a)} accessibilityLabel="Long-press to copy the 0x address">
          <Text style={[ctx.s.mono, { color: ctx.C.textMuted, fontSize: 11 }]}>{a}</Text>
        </Pressable>
      </View>
    );
  }
  const shown = showEvm ? a : litho;
  const short = showEvm ? `${a.slice(0, 8)}…${a.slice(-6)}` : `${litho.slice(0, 12)}…${litho.slice(-6)}`;
  return (
    <Pressable
      onPress={() => setShowEvm((x) => !x)}
      onLongPress={() => void Clipboard.setStringAsync(shown)}
      accessibilityLabel={showEvm ? 'Tap for the litho1 address; long-press to copy' : 'Tap for the 0x address; long-press to copy'}
    >
      <Text style={ctx.s.mono}>{short}</Text>
    </Pressable>
  );
}

function AddressField({ ctx, value, onChange, placeholder, testID }: { ctx: Ctx; value: string; onChange: (v: string) => void; placeholder?: string; testID?: string }) {
  const parsed = value.trim() ? parseAddress(value) : null;
  const hint = parsed ? (value.trim().toLowerCase().startsWith('litho1') ? `EVM: ${parsed}` : toLithoAddress(parsed)) : null;
  return (
    <View style={{ gap: 4 }}>
      <TextInput
        style={[ctx.s.input, ctx.s.mono]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? 'litho1… or 0x…'}
        placeholderTextColor={ctx.C.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
      />
      {value.trim() && !isAnyAddress(value) ? <Text style={ctx.s.fieldError}>Not a valid address</Text> : hint ? <Text style={[ctx.s.hint, ctx.s.mono]}>{hint}</Text> : null}
    </View>
  );
}

function Rows({ ctx, rows }: { ctx: Ctx; rows: { key: string; label: string; value: React.ReactNode; tone?: Tone }[] }) {
  return (
    <View>
      {rows.map((r, i) => (
        <View key={r.key} style={[ctx.s.kvRow, i === rows.length - 1 && { borderBottomWidth: 0 }]} testID={`tms-field-${r.key}`}>
          <Text style={ctx.s.kvLabel}>{r.label}</Text>
          {typeof r.value === 'string' ? <Text style={[ctx.s.kvValue, r.tone && r.tone !== 'neutral' && { color: toneColors(ctx.C, r.tone).fg }]}>{r.value}</Text> : r.value}
        </View>
      ))}
    </View>
  );
}

function stateTone(state: ProposalState): Tone {
  if (state === ProposalState.READY || state === ProposalState.EXECUTED) return 'good';
  if (state === ProposalState.PENDING || state === ProposalState.QUEUED) return 'info';
  if (state === ProposalState.CANCELLED) return 'neutral';
  return 'bad';
}

// ─────────────────────────────── screens ───────────────────────────────

function Home({ ctx, onBack }: { ctx: Ctx; onBack: () => void }) {
  const { client, account, s, go } = ctx;
  const chain = client.network.chain;
  const list = useAsync(() => client.summaries(account), [client, account]);
  if (!client.available) {
    return (
      <View style={s.screen}>
        <Header ctx={ctx} title="MultiSig" subtitle="Shared accounts that need several approvals to move funds" onBack={onBack} />
        <Notice ctx={ctx} text={`Thanos MultiSig opens on ${chain.name} as soon as the Litho Vault contracts are deployed there. Nothing to set up on your side.`} testID="tms-unavailable" />
      </View>
    );
  }
  return (
    <View style={s.screen}>
      <Header ctx={ctx} title="MultiSig" subtitle={`Shared accounts on ${chain.name} that need several approvals to move funds`} onBack={onBack} onRefresh={list.reload} />
      <View style={s.actions}>
        <Btn ctx={ctx} kind="primary" label="Create MultiSig" onPress={() => go({ name: 'create' })} disabled={!account} testID="tms-create" />
        <Btn ctx={ctx} label="Add existing" onPress={() => go({ name: 'add' })} testID="tms-add" />
      </View>
      {list.loading && !list.data && <Loading ctx={ctx} label="Finding your multisigs" />}
      <Err ctx={ctx} error={list.error} />
      {list.data?.length === 0 && (
        <Card ctx={ctx}>
          <Text style={s.muted}>No multisigs yet. Create one with the people who should approve payments, or add one you were made a signer of.</Text>
        </Card>
      )}
      {list.data?.map((v) => (
        <Pressable key={v.address} style={s.row} onPress={() => go({ name: 'vault', address: v.address })} testID={`tms-vault-${v.address}`}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.rowTitle}>{v.name}</Text>
            <Text style={[s.rowSub, s.mono]}>
              {shortAccount(v.address, 6)} · {String(v.threshold)} of {v.signers.filter((x) => isHumanSigner(x.type)).length}
            </Text>
            <View style={s.pills}>
              {v.needsMyApproval > 0 && <Pill ctx={ctx} tone="info" label={`Needs your approval · ${v.needsMyApproval}`} />}
              {v.readyToExecute > 0 && <Pill ctx={ctx} tone="good" label={`Ready to execute · ${v.readyToExecute}`} />}
              {v.frozen && <Pill ctx={ctx} tone="bad" label="Frozen" />}
              {!v.isSigner && <Pill ctx={ctx} label="View only" />}
            </View>
          </View>
          <Text style={s.rowValue}>{formatTokenUnits(v.balance, 18, 'LITHO')}</Text>
        </Pressable>
      ))}
      <Text style={s.footnote}>
        Thanos MultiSig runs on Litho Vault, the LEP100-15 smart account: every payment is a proposal that the agreed number of signers must approve, and every signer sees the same decoded review first.
      </Text>
    </View>
  );
}

function ProposalRows({ ctx, lines, onOpen }: { ctx: Ctx; lines: ProposalLine[]; onOpen: (id: bigint) => void }) {
  return (
    <View style={{ gap: 6 }}>
      {lines.map((p) => (
        <Pressable key={String(p.id)} style={ctx.s.row} onPress={() => onOpen(p.id)} testID={`tms-proposal-${p.id}`}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={ctx.s.rowTitle} numberOfLines={2}>#{String(p.id)} · {p.summary}</Text>
            <View style={ctx.s.pills}>
              <Pill ctx={ctx} tone={stateTone(p.state)} label={PROPOSAL_STATE_LABEL[p.state]} />
              {p.myApproval === false && (p.state === ProposalState.PENDING || p.state === ProposalState.QUEUED || p.state === ProposalState.READY) && <Pill ctx={ctx} tone="info" label="Your approval needed" />}
            </View>
          </View>
          <Text style={ctx.s.rowValue}>{p.approvals}/{p.required}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Vault({ ctx, address, onBack }: { ctx: Ctx; address: Address; onBack: () => void }) {
  const { client, account, s, go, back } = ctx;
  const data = useAsync(async () => {
    const [snapshot, balances, proposals, name] = await Promise.all([client.snapshot(address), client.balances(address), client.proposalLines(address), client.nameOf(address)]);
    return { snapshot, balances, proposals, name };
  }, [client, address]);
  if (!data.data) return <View style={s.screen}><Header ctx={ctx} title="MultiSig" onBack={onBack} />{data.loading ? <Loading ctx={ctx} label="Reading the multisig" /> : <Err ctx={ctx} error={data.error} />}</View>;
  const { snapshot, balances, proposals, name } = data.data;
  const humans = snapshot.signers.filter((x) => isHumanSigner(x.type));
  const me = account?.toLowerCase();
  const isSigner = !!me && humans.some((x) => x.address.toLowerCase() === me);
  return (
    <View style={s.screen}>
      <Header ctx={ctx} title={name} onBack={onBack} onRefresh={data.reload} />
      <Pressable onPress={() => void Clipboard.setStringAsync(address)}>
        <View testID="tms-vault-address">
          <Addr ctx={ctx} address={address} full />
        </View>
      </Pressable>
      {snapshot.freeze.frozen && <Notice ctx={ctx} tone="bad" text="This multisig is frozen: nothing can leave it until the freeze ends or the signers lift it." />}
      {!isSigner && <Notice ctx={ctx} text="You are not a signer of this multisig, so you can follow it but not approve." />}
      <Card ctx={ctx} title="Balance" right={isSigner ? <Btn ctx={ctx} kind="primary" label="Send" onPress={() => go({ name: 'transfer', address })} testID="tms-new-transfer" /> : null}>
        {balances.map((b) => (
          <View key={b.token.address} style={s.balance}>
            <Text style={s.text}>{b.token.symbol}</Text>
            <Text style={[s.text, { fontWeight: '700' }]}>{formatTokenUnits(b.amount, b.token.decimals)}</Text>
          </View>
        ))}
        <Text style={s.footnote}>To fund it, send to the address above on {client.network.chain.name} only.</Text>
      </Card>
      <Card ctx={ctx} title="Proposals">
        {proposals.open.length === 0 && <Text style={s.muted}>Nothing waiting for approval.</Text>}
        <ProposalRows ctx={ctx} lines={proposals.open} onOpen={(id) => go({ name: 'proposal', address, id })} />
        {proposals.closed.length > 0 && <Text style={s.subhead}>Recent</Text>}
        <ProposalRows ctx={ctx} lines={proposals.closed} onOpen={(id) => go({ name: 'proposal', address, id })} />
      </Card>
      <Card ctx={ctx} title={`Signers · ${String(snapshot.threshold)} of ${humans.length} must approve`}>
        {snapshot.signers
          .filter((x) => x.type !== SignerType.RECOVERY)
          .map((x) => (
            <View key={x.address} style={s.signer}>
              <Addr ctx={ctx} address={x.address} />
              {x.address.toLowerCase() === me && <Pill ctx={ctx} tone="info" label="You" />}
              {x.type !== SignerType.KEY && <Pill ctx={ctx} label={SIGNER_TYPE_LABEL[x.type]} />}
            </View>
          ))}
      </Card>
      <View style={s.actions}>
        {client.network.appUrl && <Btn ctx={ctx} label="More settings in Litho Vault" onPress={() => void Linking.openURL(`${client.network.appUrl}/#/v/${address}`)} />}
        <Btn ctx={ctx} kind="danger" label="Remove from list" onPress={async () => { await client.saved.remove(address); back(); }} testID="tms-remove" />
      </View>
    </View>
  );
}

const RECOMMENDATION = ['Allow', 'Review', 'Block'];
const AI_MODE = ['Off', 'Advisory', 'Required review', 'Policy guard'];

function Proposal({ ctx, address, id, onBack }: { ctx: Ctx; address: Address; id: bigint; onBack: () => void }) {
  const { client, account, chainId, s } = ctx;
  const data = useAsync(async () => {
    const [view, snapshot] = await Promise.all([client.proposal(address, id), client.snapshot(address)]);
    const executedTx = view.details.state === ProposalState.EXECUTED ? await client.executionTx(address, id) : null;
    return { view, snapshot, executedTx };
  }, [client, address, id]);
  const action = useAction();
  const [ack, setAck] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!data.data) return <View style={s.screen}><Header ctx={ctx} title={`Proposal #${id}`} onBack={onBack} />{data.loading ? <Loading ctx={ctx} label="Reading the proposal and simulating it" /> : <Err ctx={ctx} error={data.error} />}</View>;
  const { view, snapshot, executedTx } = data.data;
  const { review, details, fields } = view;
  const field = (key: string) => fields.find((f) => f.key === key)?.value ?? '—';
  const state = details.state;
  const open = state === ProposalState.PENDING || state === ProposalState.QUEUED || state === ProposalState.READY;
  const me = account?.toLowerCase();
  const mine = details.approvals.find((a) => a.signer.toLowerCase() === me);
  const isProposer = !!me && details.proposal.proposer.toLowerCase() === me;
  const approved = details.approvals.filter((a) => a.approved).length;
  const enoughWithRelayed = state === ProposalState.PENDING && view.relayedValid > 0 && approved + view.relayedValid >= Number(details.status.requiredApprovals);
  const needsAck = review.requiresAcknowledgement && !ack;
  const assessment = details.assessment;
  const act = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setDone(null);
    if ((await action.run(label, fn)) !== undefined) {
      setDone(success);
      data.reload();
    }
  };
  const recipients = [...new Set(review.decodedCalls.flatMap((d) => (d.recipient ? [d.recipient] : [])))];
  const explorer = executedTx ? explorerTxUrl(client.network.chain, executedTx) : null;
  return (
    <View style={s.screen}>
      <Header ctx={ctx} title={`Proposal #${id}`} onBack={onBack} />
      <View style={s.pills}>
        <Pill ctx={ctx} tone={stateTone(state)} label={PROPOSAL_STATE_LABEL[state]} testID="tms-state" />
      </View>
      <Text style={s.muted}>Proposed on {formatTimestamp(details.proposal.createdAt)}</Text>
      {review.warnings.filter((w) => w.level === 'danger').map((w) => <Notice key={`${w.code}:${w.callIndex ?? ''}`} ctx={ctx} tone="bad" text={w.message} />)}
      <Card ctx={ctx}>
        <Rows
          ctx={ctx}
          rows={[
            { key: 'action', label: 'Action', value: review.actionType },
            { key: 'asset', label: 'Asset', value: field('asset') },
            { key: 'amount', label: 'Amount', value: field('amount') },
            { key: 'recipient', label: 'Recipient', value: recipients.length ? <View style={{ gap: 4 }}>{recipients.map((r) => <Addr key={r} ctx={ctx} address={r} full />)}</View> : 'None' },
            { key: 'network', label: 'Network', value: `${client.network.chain.name} (chain ${chainId})` },
            { key: 'fee', label: 'Estimated fee', value: field('fee') },
            { key: 'contract', label: 'Contract', value: field('contract'), tone: review.unknownContractCall ? 'bad' : undefined },
            { key: 'function', label: 'Function', value: field('function') },
            { key: 'calldata', label: 'Calldata', value: field('decoded') },
            { key: 'simulation', label: 'Simulation', value: review.simulation.summary, tone: review.simulation.status === 'success' ? 'good' : review.simulation.status === 'failed' ? 'bad' : 'warn' },
            {
              key: 'approvals',
              label: 'Approvals',
              value: (
                <View style={{ gap: 6 }}>
                  {details.approvals.filter((a) => a.type !== SignerType.RECOVERY).map((a) => (
                    <View key={a.signer} style={s.signer}>
                      <Text style={{ color: a.approved ? ctx.C.green : ctx.C.textMuted }}>{a.approved ? '✓' : '○'}</Text>
                      <Addr ctx={ctx} address={a.signer} />
                      {a.signer.toLowerCase() === me && <Pill ctx={ctx} tone="info" label="You" />}
                    </View>
                  ))}
                  {view.relayedValid > 0 && <Text style={s.muted}>+ {view.relayedValid} signed without gas, not yet submitted</Text>}
                </View>
              ),
            },
            { key: 'required', label: 'Required threshold', value: `${approved} of ${field('required')}` },
            {
              key: 'ai',
              label: 'AI risk assessment',
              value: assessment
                ? `Risk ${assessment.riskScore.toLocaleString()} / 10,000 · ${RECOMMENDATION[assessment.recommendation] ?? 'Unknown'} · valid until ${formatTimestamp(assessment.expiresAt)}`
                : snapshot.aiConfig.mode === AIMode.OFF ? 'AI protection is off for this multisig' : `No assessment yet (AI mode: ${AI_MODE[snapshot.aiConfig.mode] ?? 'unknown'})`,
            },
            { key: 'warnings', label: 'Policy warnings', value: field('warnings'), tone: review.warnings.some((w) => w.level === 'danger') ? 'bad' : review.warnings.length ? 'warn' : undefined },
            { key: 'expiration', label: 'Expiration', value: field('timing') },
            {
              key: 'tx',
              label: 'Transaction hash',
              value: executedTx ? (
                <Pressable onPress={() => explorer && void Linking.openURL(explorer)}>
                  <Text style={[s.mono, { color: ctx.C.blue }]}>{executedTx.slice(0, 12)}…{executedTx.slice(-8)}</Text>
                </Pressable>
              ) : state === ProposalState.EXECUTED ? 'Executed (hash not found)' : 'Not executed yet',
            },
          ]}
        />
      </Card>
      {open && (
        <Card ctx={ctx} title="Your decision">
          {!account && <Notice ctx={ctx} tone="warn" text="Unlock your wallet to act on multisigs" />}
          {account && !mine && <Notice ctx={ctx} text="You are not a signer of this multisig." />}
          {review.requiresAcknowledgement && (
            <Pressable style={s.check} onPress={() => setAck((a) => !a)} testID="tms-ack">
              <Text style={{ color: ack ? ctx.C.blue : ctx.C.textMuted, fontSize: 18 }}>{ack ? '☑' : '☐'}</Text>
              <Text style={[s.muted, { flex: 1 }]}>I checked the warnings above, and the recipient, contract and calldata with the proposer through a separate channel.</Text>
            </Pressable>
          )}
          <View style={s.actions}>
            {mine && !mine.approved && <Btn ctx={ctx} kind="primary" label="Approve" disabled={needsAck || !!action.pending} onPress={() => void act('Approving', () => client.approve(address, id), 'Approved')} testID="tms-approve" />}
            {mine && !mine.approved && client.network.indexerUrl && <Btn ctx={ctx} label="Approve without gas" disabled={needsAck || !!action.pending} onPress={() => void act('Signing', () => client.signAndShare(address, id), 'Signed. The other signers will see your approval.')} testID="tms-sign" />}
            {mine?.approved && <Btn ctx={ctx} label="Revoke my approval" disabled={!!action.pending} onPress={() => void act('Revoking', () => client.revoke(address, id), 'Approval revoked')} testID="tms-revoke" />}
            {mine && (state === ProposalState.READY || enoughWithRelayed) && <Btn ctx={ctx} kind="primary" label="Execute" disabled={needsAck || review.blocked || !!action.pending} onPress={() => void act('Executing', () => client.execute(address, id, view), 'Executed')} testID="tms-execute" />}
            {isProposer && <Btn ctx={ctx} kind="danger" label="Cancel proposal" disabled={!!action.pending} onPress={() => void act('Cancelling', () => client.cancel(address, id), 'Cancelled')} testID="tms-cancel" />}
          </View>
          {state === ProposalState.QUEUED && <Text style={s.footnote}>Approved. It can be executed from {formatTimestamp(details.proposal.executableAt)}.</Text>}
          {action.pending && <Loading ctx={ctx} label={`${action.pending}… then waiting for the network`} />}
          <Err ctx={ctx} error={action.error} />
        </Card>
      )}
      {done && !action.pending && <Notice ctx={ctx} tone="good" text={done} testID="tms-done" />}
    </View>
  );
}

function Transfer({ ctx, address, onBack }: { ctx: Ctx; address: Address; onBack: () => void }) {
  const { client, chainId, s, replace } = ctx;
  const balances = useAsync(() => client.balances(address), [client, address]);
  const [asset, setAsset] = useState(0);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [draft, setDraft] = useState<{ calls: Call[]; review: TransactionReview; fields: ReviewField[] } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const action = useAction();
  const list = balances.data ?? [];
  const selected = list[asset];

  if (draft) {
    const field = (key: string) => draft.fields.find((f) => f.key === key)?.value ?? '—';
    const needsAck = draft.review.requiresAcknowledgement && !ack;
    return (
      <View style={s.screen}>
        <Header ctx={ctx} title="Review the proposal" subtitle="The other signers will see exactly this before they approve" onBack={() => setDraft(null)} />
        {draft.review.warnings.filter((w) => w.level === 'danger').map((w) => <Notice key={w.code} ctx={ctx} tone="bad" text={w.message} />)}
        <Card ctx={ctx}>
          <Rows
            ctx={ctx}
            rows={[
              { key: 'action', label: 'Action', value: draft.review.actionType },
              { key: 'asset', label: 'Asset', value: field('asset') },
              { key: 'amount', label: 'Amount', value: field('amount') },
              { key: 'recipient', label: 'Recipient', value: field('recipient') },
              { key: 'network', label: 'Network', value: `${client.network.chain.name} (chain ${chainId})` },
              { key: 'simulation', label: 'Simulation', value: draft.review.simulation.summary, tone: draft.review.simulation.status === 'success' ? 'good' : draft.review.simulation.status === 'failed' ? 'bad' : 'warn' },
              { key: 'required', label: 'Approvals needed', value: field('required') },
              { key: 'timing', label: 'Timelock', value: field('timing') },
              { key: 'warnings', label: 'Policy warnings', value: field('warnings') },
              { key: 'fee', label: 'Fee to propose', value: draft.review.fees.propose?.formatted ?? '—' },
            ]}
          />
        </Card>
        {draft.review.requiresAcknowledgement && (
          <Pressable style={s.check} onPress={() => setAck((a) => !a)}>
            <Text style={{ color: ack ? ctx.C.blue : ctx.C.textMuted, fontSize: 18 }}>{ack ? '☑' : '☐'}</Text>
            <Text style={[s.muted, { flex: 1 }]}>I understand the warnings above.</Text>
          </Pressable>
        )}
        <View style={s.actions}>
          <Btn
            ctx={ctx}
            kind="primary"
            label="Propose and approve"
            disabled={needsAck || draft.review.blocked || !!action.pending}
            onPress={async () => {
              const result = await action.run('Proposing', () => client.propose(address, draft.calls));
              if (result) replace({ name: 'proposal', address, id: result.id });
            }}
            testID="tms-propose"
          />
          <Btn ctx={ctx} label="Edit" onPress={() => setDraft(null)} />
        </View>
        {action.pending && <Loading ctx={ctx} label={`${action.pending}… then waiting for the network`} />}
        <Err ctx={ctx} error={action.error} />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <Header ctx={ctx} title="Send from MultiSig" subtitle="Creates a proposal; it is sent once enough signers approve" onBack={onBack} />
      {balances.loading && !balances.data && <Loading ctx={ctx} />}
      <Err ctx={ctx} error={balances.error} />
      <Card ctx={ctx}>
        <Text style={s.label}>Asset</Text>
        <View style={s.pills}>
          {list.map((b, i) => (
            <Pressable key={b.token.address} onPress={() => setAsset(i)} style={[s.chip, i === asset && { borderColor: ctx.C.blue }]}>
              <Text style={s.text}>{b.token.symbol} · {formatTokenUnits(b.amount, b.token.decimals)}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.label}>Amount</Text>
        <View style={s.inputRow}>
          <TextInput style={[s.input, { flex: 1 }]} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.0" placeholderTextColor={ctx.C.textMuted} testID="tms-amount" />
          {selected && <Btn ctx={ctx} label="Max" onPress={() => setAmount(formatUnits(selected.amount, selected.token.decimals))} />}
        </View>
        {formError && <Text style={s.fieldError}>{formError}</Text>}
        <Text style={s.label}>Recipient</Text>
        <AddressField ctx={ctx} value={recipient} onChange={setRecipient} testID="tms-recipient" />
        <View style={[s.actions, { marginTop: 12 }]}>
          <Btn
            ctx={ctx}
            kind="primary"
            label="Review"
            disabled={!amount || !recipient || !selected || !!action.pending}
            onPress={async () => {
              setFormError(null);
              let calls: Call[];
              try {
                calls = client.transferCalls({ asset: selected!.token, amount, recipient });
              } catch (e) {
                setFormError((e as Error).message);
                return;
              }
              const result = await action.run('Reviewing', () => client.reviewDraft(address, calls));
              if (result) {
                setAck(false);
                setDraft({ calls, ...result });
              }
            }}
            testID="tms-review-btn"
          />
        </View>
        {action.pending && <Loading ctx={ctx} label="Decoding and simulating" />}
        <Err ctx={ctx} error={action.error} />
      </Card>
    </View>
  );
}

function Create({ ctx, onBack }: { ctx: Ctx; onBack: () => void }) {
  const { client, chainId, account, s, replace } = ctx;
  const [name, setName] = useState('');
  const [others, setOthers] = useState<string[]>(['']);
  const [threshold, setThreshold] = useState(2);
  const action = useAction();
  const count = 1 + others.filter((o) => o.trim()).length;
  const effective = Math.min(threshold, count);
  const draft = useMemo(() => client.draftMultisig({ others, threshold: effective }), [client, others, effective]);
  return (
    <View style={s.screen}>
      <Header ctx={ctx} title="Create MultiSig" subtitle="A shared account that moves funds only when enough of its signers approve" onBack={onBack} />
      <Card ctx={ctx} title="1. Network">
        <Text style={s.muted} testID="tms-create-network">{client.network.chain.name} (chain {chainId}). The multisig exists on this network only; send it funds only here.</Text>
      </Card>
      <Card ctx={ctx} title="2. Name and signers">
        <Text style={s.label}>Name (only in your wallet)</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} maxLength={40} placeholder="Team treasury" placeholderTextColor={ctx.C.textMuted} testID="tms-name" />
        <Text style={s.label}>Signer 1 (you)</Text>
        <Text style={[s.mono, s.static]} testID="tms-me">{account ? displayAccount(account) : '—'}</Text>
        {others.map((o, i) => (
          <View key={i}>
            <Text style={s.label}>Signer {i + 2}</Text>
            <AddressField ctx={ctx} value={o} onChange={(v) => setOthers((l) => l.map((x, j) => (j === i ? v : x)))} testID={`tms-signer-${i + 2}`} />
            {others.length > 1 && (
              <Pressable onPress={() => setOthers((l) => l.filter((_, j) => j !== i))}>
                <Text style={s.link}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}
        {others.length < 19 && (
          <Pressable onPress={() => setOthers((l) => [...l, ''])} testID="tms-add-signer">
            <Text style={s.link}>+ Add signer</Text>
          </Pressable>
        )}
      </Card>
      <Card ctx={ctx} title="3. Approvals required">
        <View style={s.pills}>
          {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
            <Pressable key={n} onPress={() => setThreshold(n)} style={[s.chip, n === effective && { borderColor: ctx.C.blue }]} testID={`tms-threshold-${n}`}>
              <Text style={s.text}>{n} of {count}</Text>
            </Pressable>
          ))}
        </View>
        {effective === 1 && count > 1 && <Text style={s.hint}>With 1, any single signer can move funds alone.</Text>}
      </Card>
      <Card ctx={ctx} title="4. AI protection (optional)">
        <Text style={s.muted}>Off. A signed AI risk assessment can later be required for risky payments, or used to ask for more approvals; it can never approve on its own.</Text>
      </Card>
      <Card ctx={ctx} title="5. Recovery (optional)">
        <Text style={s.muted}>Off. Guardians who can replace a lost signer's key after a delay can be added later, through an approved proposal.</Text>
      </Card>
      <Card ctx={ctx} title="6. Deploy">
        {draft.errors.length > 0 && <Notice ctx={ctx} tone="warn" text={draft.errors.join('\n')} testID="tms-create-errors" />}
        <Text style={s.muted}>You pay the network fee to create it. Signers and the approval count can be changed later only with the approval of the current signers.</Text>
        <View style={[s.actions, { marginTop: 10 }]}>
          <Btn
            ctx={ctx}
            kind="primary"
            label="Create MultiSig"
            disabled={draft.errors.length > 0 || !!action.pending || !account}
            onPress={async () => {
              const result = await action.run('Creating the multisig', () => client.create(draft.config, cleanVaultName(name) || 'MultiSig'));
              if (result) replace({ name: 'vault', address: result.address });
            }}
            testID="tms-deploy"
          />
        </View>
        {action.pending && <Loading ctx={ctx} label={`${action.pending}… then waiting for the network`} />}
        <Err ctx={ctx} error={action.error} />
      </Card>
    </View>
  );
}

function Add({ ctx, onBack }: { ctx: Ctx; onBack: () => void }) {
  const { client, s, replace } = ctx;
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const action = useAction();
  return (
    <View style={s.screen}>
      <Header ctx={ctx} title="Add existing MultiSig" subtitle={`Any Litho Vault multisig on ${client.network.chain.name}`} onBack={onBack} />
      <Card ctx={ctx}>
        <Text style={s.label}>MultiSig address</Text>
        <AddressField ctx={ctx} value={address} onChange={setAddress} testID="tms-add-address" />
        <Text style={s.label}>Name (only in your wallet)</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} maxLength={40} placeholder="Treasury" placeholderTextColor={ctx.C.textMuted} testID="tms-add-name" />
        <View style={[s.actions, { marginTop: 12 }]}>
          <Btn
            ctx={ctx}
            kind="primary"
            label="Add"
            disabled={!address.trim() || !!action.pending}
            onPress={async () => {
              const saved = await action.run('Checking', () => client.addExisting(address, name));
              if (saved) replace({ name: 'vault', address: saved.address });
            }}
            testID="tms-add-submit"
          />
        </View>
        {action.pending && <Loading ctx={ctx} label="Checking the address" />}
        <Err ctx={ctx} error={action.error} />
      </Card>
    </View>
  );
}

// ─────────────────────────────── styles ───────────────────────────────

function makeStyles(C: MultiSigColors) {
  return StyleSheet.create({
    scroll: { padding: 16, paddingBottom: 120 },
    screen: { gap: 12 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    iconBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.borderDefault, backgroundColor: C.bgElevated, alignItems: 'center', justifyContent: 'center' },
    iconText: { color: C.textSecondary, fontSize: 20, lineHeight: 22 },
    title: { color: C.textPrimary, fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },
    subtitle: { color: C.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
    card: { backgroundColor: C.bgCard, borderColor: C.borderSubtle, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    cardTitle: { color: C.textPrimary, fontSize: 15, fontWeight: '700' },
    subhead: { color: C.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: 10 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    btn: { minHeight: 42, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
    btnPrimary: { backgroundColor: C.blue, borderColor: C.blue },
    btnSecondary: { backgroundColor: C.bgElevated, borderColor: C.borderDefault },
    btnDanger: { backgroundColor: 'transparent', borderColor: C.red },
    btnText: { color: C.textPrimary, fontSize: 14, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: C.bgSurface, borderWidth: 1, borderColor: C.borderSubtle },
    rowTitle: { color: C.textPrimary, fontSize: 14, fontWeight: '700' },
    rowSub: { color: C.textMuted, fontSize: 12 },
    rowValue: { color: C.textPrimary, fontSize: 14, fontWeight: '700' },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    pillText: { fontSize: 11, fontWeight: '700' },
    notice: { padding: 10, borderRadius: 12, borderWidth: 1 },
    noticeText: { color: C.textPrimary, fontSize: 13, lineHeight: 18 },
    loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    muted: { color: C.textSecondary, fontSize: 13, lineHeight: 19 },
    text: { color: C.textPrimary, fontSize: 14 },
    footnote: { color: C.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
    mono: { fontFamily: MONO, fontSize: 12.5, color: C.textPrimary },
    static: { padding: 10, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: C.borderDefault, backgroundColor: C.bgSurface },
    balance: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    signer: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    kvRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.borderSubtle, gap: 4 },
    kvLabel: { color: C.textMuted, fontSize: 12, fontWeight: '600' },
    kvValue: { color: C.textPrimary, fontSize: 13, lineHeight: 18 },
    label: { color: C.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 8 },
    input: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.borderDefault, backgroundColor: C.bgElevated, color: C.textPrimary, fontSize: 14 },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    hint: { color: C.textMuted, fontSize: 12 },
    fieldError: { color: C.red, fontSize: 12 },
    link: { color: C.blue, fontSize: 13, fontWeight: '700', marginTop: 6 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.borderDefault, backgroundColor: C.bgElevated },
    check: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  });
}
