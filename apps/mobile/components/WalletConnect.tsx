/**
 * Mobile WalletConnect v2 UI.
 *
 * Two exports:
 *   WalletConnectModal       — pairing (paste / scan a wc: URI),
 *                              session-proposal approval, and the list
 *                              of connected dApps with disconnect.
 *   WalletConnectRequestHost — always-mounted listener that pops an
 *                              approve/reject sheet whenever a paired
 *                              dApp sends a signing request.
 *
 * Both are self-styled with a dark sheet palette (consistent regardless
 * of the app's light/dark theme — signing surfaces read better dark).
 *
 * Signing is delegated to lib/wc-signer.ts; pairing + session lifecycle
 * to lib/walletconnect.ts.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, Pressable, TextInput, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { X, Globe, ScanLine, Power } from 'lucide-react-native';
import type { WalletKitTypes } from '@reown/walletkit';
import type { SessionTypes } from '@walletconnect/types';
import {
  pair, approveSession, rejectSession,
  getActiveSessions, disconnectSession,
  respondRequest, respondError, onSessionProposal, onSessionRequest,
} from '../lib/walletconnect';
import { executeWcRequest, summariseRequest, WcSignerError } from '../lib/wc-signer';
import { QrScannerModal } from './QrScannerModal';
import { isWalletConnectUri } from '../lib/qr';
import { TransactionSimulator, type SimulationReport } from '../lib/tx-simulator';

/* ─── Dark sheet palette ──────────────────────────────────────────── */
const P = {
  bg:      '#0e0e12',
  card:    '#1c1c22',
  border:  '#282834',
  text:    '#f0f0f4',
  sub:     '#9696aa',
  blue:    '#3b7af7',
  red:     '#f87171',
  green:   '#10b981',
};

/* ════════════════════════════════════════════════════════════════════
   WalletConnectModal — pairing + sessions
   ════════════════════════════════════════════════════════════════════ */

type WcView = 'list' | 'pair' | 'proposal';

export function WalletConnectModal({
  visible, onClose, evmAddress,
}: { visible: boolean; onClose: () => void; evmAddress: string }) {
  const [view, setView]         = useState<WcView>('list');
  const [uri, setUri]           = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionTypes.Struct[]>([]);
  const [proposal, setProposal] = useState<WalletKitTypes.SessionProposal | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const map = await getActiveSessions();
      setSessions(Object.values(map));
    } catch { /* kit not ready — empty list */ }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setView('list'); setUri(''); setError(null); setProposal(null);
    void refreshSessions();
  }, [visible, refreshSessions]);

  // Subscribe to incoming proposals while the modal is mounted.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    onSessionProposal((p) => { setProposal(p); setBusy(false); setView('proposal'); })
      .then(fn => { unsub = fn; })
      .catch(() => {});
    return () => { if (unsub) unsub(); };
  }, []);

  const doPair = async (rawUri: string) => {
    const u = rawUri.trim();
    if (!u) return;
    if (!isWalletConnectUri(u)) { setError('That is not a WalletConnect URI (must start with "wc:").'); return; }
    setError(null); setBusy(true);
    try {
      await pair(u);
      // session_proposal listener flips the view shortly after.
    } catch (e) {
      setError((e as Error).message || 'Pairing failed');
      setBusy(false);
    }
  };

  const onApprove = async () => {
    if (!proposal || !evmAddress) return;
    setBusy(true);
    try {
      await approveSession(proposal.id, evmAddress);
      setProposal(null);
      await refreshSessions();
      setView('list');
    } catch (e) {
      setError((e as Error).message || 'Approval failed');
    } finally { setBusy(false); }
  };

  const onReject = async () => {
    if (!proposal) return;
    try { await rejectSession(proposal.id); } catch { /* dApp may have given up */ }
    setProposal(null);
    setView('list');
  };

  const onDisconnect = async (topic: string) => {
    try { await disconnectSession(topic); } catch { /* already gone */ }
    await refreshSessions();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>
              {view === 'pair' ? 'New connection' : view === 'proposal' ? 'Connection request' : 'WalletConnect'}
            </Text>
            <Pressable onPress={onClose} hitSlop={14}><X size={22} color={P.text}/></Pressable>
          </View>

          {/* ── List ── */}
          {view === 'list' && (
            <ScrollView style={{ maxHeight: 420 }}>
              {sessions.length === 0 ? (
                <Text style={s.empty}>No connected apps yet.</Text>
              ) : sessions.map((sx) => {
                const meta = sx.peer?.metadata;
                return (
                  <View key={sx.topic} style={s.row}>
                    <View style={s.rowIcon}><Globe size={18} color={P.sub}/></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.rowName} numberOfLines={1}>{meta?.name || 'Unknown dApp'}</Text>
                      <Text style={s.rowSub} numberOfLines={1}>{meta?.url || ''}</Text>
                    </View>
                    <Pressable style={s.disconnectBtn} onPress={() => onDisconnect(sx.topic)}>
                      <Power size={14} color={P.red}/>
                      <Text style={s.disconnectText}>Disconnect</Text>
                    </Pressable>
                  </View>
                );
              })}
              <Pressable style={s.primaryBtn} onPress={() => { setView('pair'); setError(null); }}>
                <Text style={s.primaryBtnText}>+ New connection</Text>
              </Pressable>
            </ScrollView>
          )}

          {/* ── Pair ── */}
          {view === 'pair' && (
            <View>
              <Text style={s.label}>WalletConnect URI</Text>
              <TextInput
                style={s.input}
                placeholder="wc:…"
                placeholderTextColor={P.sub}
                value={uri}
                onChangeText={setUri}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <Pressable
                  style={[s.secondaryBtn, { flex: 1 }]}
                  onPress={async () => {
                    const c = await Clipboard.getStringAsync();
                    if (c) setUri(c.trim());
                  }}
                >
                  <Text style={s.secondaryBtnText}>Paste</Text>
                </Pressable>
                <Pressable
                  style={[s.secondaryBtn, { flex: 1, flexDirection: 'row', gap: 6 }]}
                  onPress={() => setScanOpen(true)}
                >
                  <ScanLine size={16} color={P.text}/>
                  <Text style={s.secondaryBtnText}>Scan QR</Text>
                </Pressable>
              </View>
              {error && <Text style={s.error}>{error}</Text>}
              <Pressable
                style={[s.primaryBtn, { opacity: uri.trim() && !busy ? 1 : 0.45 }]}
                disabled={!uri.trim() || busy}
                onPress={() => doPair(uri)}
              >
                {busy ? <ActivityIndicator color="#fff"/> : <Text style={s.primaryBtnText}>Connect</Text>}
              </Pressable>
              <Pressable onPress={() => { setView('list'); setError(null); }}>
                <Text style={s.linkBtn}>Back</Text>
              </Pressable>
            </View>
          )}

          {/* ── Proposal ── */}
          {view === 'proposal' && proposal && (
            <View>
              <View style={s.proposalHead}>
                <View style={s.rowIcon}><Globe size={24} color={P.blue}/></View>
                <Text style={s.proposalName}>{proposal.params.proposer.metadata.name}</Text>
                <Text style={s.rowSub}>{proposal.params.proposer.metadata.url}</Text>
              </View>
              <View style={s.permCard}>
                <Text style={s.permTitle}>THIS APP WILL BE ABLE TO</Text>
                <Text style={s.permBody}>
                  • View your wallet address &amp; balance{'\n'}
                  • Request transaction &amp; signature approvals{'\n'}
                  • Each request needs your explicit approval
                </Text>
              </View>
              {error && <Text style={s.error}>{error}</Text>}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={onReject} disabled={busy}>
                  <Text style={s.secondaryBtnText}>Reject</Text>
                </Pressable>
                <Pressable style={[s.primaryBtn, { flex: 1, marginTop: 0 }]} onPress={onApprove} disabled={busy}>
                  {busy ? <ActivityIndicator color="#fff"/> : <Text style={s.primaryBtnText}>Connect</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>

      <QrScannerModal
        visible={scanOpen}
        title="Scan WalletConnect QR"
        onClose={() => setScanOpen(false)}
        onResult={(data) => { setScanOpen(false); setUri(data.trim()); void doPair(data); }}
      />
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════════
   WalletConnectRequestHost — session_request approval
   ════════════════════════════════════════════════════════════════════ */

interface PendingReq {
  topic:   string;
  id:      number;
  method:  string;
  params:  unknown;
  summary: string;
  dApp:    string;
}

export function WalletConnectRequestHost({ seed }: { seed: string[] }) {
  const [pending, setPending] = useState<PendingReq | null>(null);
  const [busy, setBusy]       = useState<'approve' | 'reject' | null>(null);
  // Pre-sign simulation — runs whenever a pending eth_sendTransaction
  // arrives. Other methods (personal_sign, eth_signTypedData_v4) don't
  // touch on-chain state, so we skip simulation for them.
  const [simReport, setSimReport] = useState<SimulationReport | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    onSessionRequest((req) => {
      const method = req.params.request.method;
      const params = req.params.request.params;
      setPending({
        topic:   req.topic,
        id:      req.id,
        method,
        params,
        summary: summariseRequest(method, params),
        dApp:    (req as unknown as { verifyContext?: { verified?: { origin?: string } } })
                   .verifyContext?.verified?.origin ?? 'A connected dApp',
      });
    }).then(fn => { unsub = fn; }).catch(() => {});
    return () => { if (unsub) unsub(); };
  }, []);

  /* Simulate the pending eth_sendTransaction so the approval sheet can
     show contract-recipient warnings + insufficient-balance critical
     before the user signs. Lithic chain → Makalu. */
  useEffect(() => {
    if (!pending || pending.method !== 'eth_sendTransaction') {
      setSimReport(null); return;
    }
    const tx = (pending.params as unknown[] | undefined)?.[0] as { to?: string; value?: string; from?: string } | undefined;
    if (!tx?.to) { setSimReport(null); return; }
    const toAddr = tx.to;   // narrow for the async closure
    let cancelled = false;
    (async () => {
      try {
        const sim = new TransactionSimulator();
        const valueWei  = BigInt(tx.value || '0x0');
        const amountEth = (Number(valueWei) / 1e18).toString();
        const report = await sim.simulateSend({
          chainId: 700777,   // Makalu — the chain mobile WC sessions live on today
          from:    tx.from || '',
          to:      toAddr,
          amount:  amountEth,
        });
        if (!cancelled) setSimReport(report);
      } catch { if (!cancelled) setSimReport(null); }
    })();
    return () => { cancelled = true; };
  }, [pending]);

  const close = () => { setPending(null); setBusy(null); };

  const onApprove = async () => {
    if (!pending || busy) return;
    setBusy('approve');
    try {
      const result = await executeWcRequest(seed, { request: { method: pending.method, params: pending.params } });
      await respondRequest({ topic: pending.topic, id: pending.id, result });
    } catch (e) {
      const code = e instanceof WcSignerError ? e.code : -32603;
      const msg  = (e as Error).message || 'Request failed';
      try { await respondError({ topic: pending.topic, id: pending.id, code, message: msg }); } catch { /* dApp gone */ }
    }
    close();
  };

  const onReject = async () => {
    if (!pending || busy) return;
    setBusy('reject');
    try { await respondError({ topic: pending.topic, id: pending.id, code: 5000, message: 'User rejected' }); }
    catch { /* dApp gone */ }
    close();
  };

  if (!pending) return null;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onReject}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Approve request</Text>
            <Pressable onPress={onReject} hitSlop={14}><X size={22} color={P.text}/></Pressable>
          </View>
          <Text style={s.rowSub}>{pending.dApp}</Text>
          <View style={s.permCard}>
            <Text style={s.permTitle}>{pending.method}</Text>
            <Text style={s.permBody}>{pending.summary}</Text>
          </View>

          {/* Pre-sign simulation — warning/critical issues for tx requests.
              Info-level issues are suppressed in the compact sheet view. */}
          {simReport && simReport.issues.filter(i => i.level !== 'info').map((issue, i) => {
            const isCritical = issue.level === 'critical';
            return (
              <View
                key={`${issue.code}-${i}`}
                style={{
                  marginTop: 10,
                  padding: 10,
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

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={onReject} disabled={busy === 'approve'}>
              <Text style={s.secondaryBtnText}>{busy === 'reject' ? '…' : 'Reject'}</Text>
            </Pressable>
            <Pressable
              style={[s.primaryBtn, { flex: 1, marginTop: 0, opacity:
                busy === 'reject' || (simReport?.issues.some(i => i.level === 'critical') ?? false) ? 0.5 : 1 }]}
              onPress={onApprove}
              disabled={busy === 'reject' || (simReport?.issues.some(i => i.level === 'critical') ?? false)}
            >
              {busy === 'approve'
                ? <ActivityIndicator color="#fff"/>
                : <Text style={s.primaryBtnText}>
                    {simReport?.issues.some(i => i.level === 'critical') ? 'Blocked' : 'Approve'}
                  </Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────── */
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: P.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 36, borderTopWidth: 1, borderColor: P.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title:  { color: P.text, fontSize: 18, fontWeight: '700' },
  empty:  { color: P.sub, fontSize: 14, textAlign: 'center', paddingVertical: 24 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: P.border,
  },
  rowIcon: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: P.card,
    alignItems: 'center', justifyContent: 'center',
  },
  rowName: { color: P.text, fontSize: 15, fontWeight: '600' },
  rowSub:  { color: P.sub, fontSize: 12, marginTop: 2 },

  disconnectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8,
    borderWidth: 1, borderColor: P.red,
  },
  disconnectText: { color: P.red, fontSize: 12, fontWeight: '700' },

  label: { color: P.sub, fontSize: 12, fontWeight: '600', marginBottom: 6, letterSpacing: 0.4 },
  input: {
    backgroundColor: P.card, borderWidth: 1, borderColor: P.border, borderRadius: 10,
    color: P.text, fontSize: 16, paddingHorizontal: 12, paddingVertical: 11,
  },
  error: { color: P.red, fontSize: 12, marginTop: 10 },

  primaryBtn: {
    backgroundColor: P.blue, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: P.card, borderWidth: 1, borderColor: P.border, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { color: P.text, fontSize: 14, fontWeight: '700' },
  linkBtn: { color: P.sub, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 14 },

  proposalHead: { alignItems: 'center', gap: 6, paddingVertical: 6 },
  proposalName: { color: P.text, fontSize: 16, fontWeight: '700', marginTop: 4 },

  permCard: { backgroundColor: P.card, borderRadius: 12, padding: 14, marginTop: 12 },
  permTitle: { color: P.sub, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  permBody:  { color: P.text, fontSize: 13, lineHeight: 20 },
});
