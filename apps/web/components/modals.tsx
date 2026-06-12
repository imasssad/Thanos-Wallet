'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { TOKENS } from '../lib/tokens';
import { useWallet } from './shell/AppShell';
import {
  validateAddressForChain, resolveToEvm, truncateLithoAddress,
  MAKALU_CHAIN_ID,
} from '../lib/address';
import {
  sendTokens, estimateSendFee, SendError, makeProvider,
  sendNativeEvm, estimateNativeEvmFee,
} from '../lib/signer';
import { signerSend, SignerError } from '../lib/signer-client';
import {
  getQuote   as multxGetQuote,
  execute    as multxExecute,
  getStatus  as multxGetStatus,
  type Quote as MultXQuote,
  MultXUnavailable,
} from '../lib/multx';
import {
  getQuote   as igniteGetQuote,
  execute    as igniteExecute,
  getStatus  as igniteGetStatus,
  IgniteUnavailable,
} from '../lib/ignite';
import { TokenSelect } from './ui/TokenSelect';
import { TokenIcon } from './TokenIcon';
import { QrScannerModal } from './QrScannerModal';
import { searchContacts, findContactByAddress, type Contact } from '../lib/address-book';
import { looksLikeName, resolveName } from '../lib/dnns';
import { isValidSolanaAddress, sendSol, sendSplToken, SolanaSendError, solanaExplorerUrl } from '../lib/solana';
import { isValidBitcoinAddress, sendBitcoin, estimateBitcoinFee, BitcoinSendError, bitcoinExplorerUrl } from '../lib/bitcoin';
import {
  isValidCosmosAddress, sendCosmos, estimateCosmosFee, CosmosSendError, cosmosExplorerUrl,
} from '../lib/cosmos';
import { sendBitcoinWithLedger } from '../lib/ledger-btc';
import { sendSolWithLedger } from '../lib/ledger-sol';
import {
  getActiveLedgerBtcAccount, getActiveLedgerSolAccount,
} from '../lib/ledger-accounts';
import { signAndBroadcastTx as ledgerSignEvmTx } from '../lib/ledger';
import { getActiveLedgerAccount } from './LedgerModal';
import {
  sendEvmWithTrezor, sendBitcoinWithTrezor, sendSolWithTrezor, TrezorError,
} from '../lib/trezor';
import {
  getActiveTrezorEvmAccount, getActiveTrezorBtcAccount, getActiveTrezorSolAccount,
} from '../lib/trezor-accounts';
import { getMakaluProvider, getKametProvider, KAMET_CHAIN_ID } from '../lib/rpc';
import { getEvmProvider } from '../lib/evm-chains';
import { parseUnits as ethersParseUnits } from 'ethers';
import { LedgerError } from '../lib/ledger-transport';
import { recordPendingTx } from '../lib/tx-store';
import { useLiveBalances, invalidateLiveBalances } from '../lib/useLiveBalances';
import { EVM_CHAINS } from '../lib/evm-chains';
import { classifyRecipient } from '../lib/phishing';
import { PhishingBanner } from './PhishingBanner';
import { simulateEvmSend, type SimulationReport } from '../lib/simulation';
import { SimulationPanel, hasCriticalIssue } from './SimulationPanel';
import { bridgePollBackoffMs } from '@thanos/sdk-core';
import * as RadixSelect from '@radix-ui/react-select';
import { QrCode, Check, ChevronDown } from 'lucide-react';

const TOKEN_SYMBOLS = TOKENS.map(t => t.sym);
/** Tokens sendable on Lithosphere Makalu (native LITHO + LEP100). */
const MAKALU_SYMBOLS = TOKENS.filter(t => t.chain === 'Makalu').map(t => t.sym);

export type ModalKind = 'send' | 'receive' | 'swap' | null;

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type SendStage = 'compose' | 'broadcasting' | 'pending' | 'confirmed' | 'failed';

/** Send-screen networks: Lithosphere first (the primary chain), then
 *  Bitcoin / Solana, then every EVM chain we support. Each carries an
 *  identifier the send branch uses to route. */
type SendNet =
  | { id: 'makalu';  label: 'Lithosphere Makalu' }
  | { id: 'kamet';   label: 'Lithosphere Kamet'  }
  | { id: 'bitcoin'; label: 'Bitcoin' }
  | { id: 'solana';  label: 'Solana' }
  | { id: 'cosmos';  label: 'Cosmos Hub' }
  | { id: `evm:${number}`; label: string };

const SEND_NETWORKS: SendNet[] = [
  { id: 'makalu',  label: 'Lithosphere Makalu' },
  { id: 'kamet',   label: 'Lithosphere Kamet'  },
  { id: 'bitcoin', label: 'Bitcoin' },
  { id: 'solana',  label: 'Solana' },
  { id: 'cosmos',  label: 'Cosmos Hub' },
  ...EVM_CHAINS.map(c => ({ id: `evm:${c.chainId}` as const, label: c.name })),
];

export function SendModal({ onClose, initialNetwork, initialCoin }: {
  onClose: () => void;
  /** Pre-select a network (e.g. opened from a token detail screen). */
  initialNetwork?: SendNet['id'];
  /** Pre-select an asset on that network (e.g. 'FGPT'). */
  initialCoin?: string;
}) {
  const wallet = useWallet();
  const [network, setNetwork] = useState<SendNet['id']>(initialNetwork ?? 'makalu');
  const [coin, setCoin]       = useState(initialCoin ?? 'LITHO');
  const [to, setTo]           = useState('');
  const [amount, setAmount]   = useState('');

  /* When the user changes network, reset `coin` to the right default for
     that chain. Each chain has exactly one sendable asset today
     (Lithosphere is the exception — multiple LEP100 tokens via the
     existing TokenSelect inside the asset row). Keyed on the PREVIOUS
     network value rather than a consumed-once ref so the reset only
     fires on a real network CHANGE — a skip-once ref gets eaten by
     React StrictMode's doubled mount effect and clobbers the caller's
     initialCoin pre-selection in dev. */
  const prevNetwork = React.useRef(network);
  useEffect(() => {
    if (prevNetwork.current === network) return;
    prevNetwork.current = network;
    if (network === 'makalu')       setCoin('LITHO');
    else if (network === 'kamet')   setCoin('LITHO');
    else if (network === 'bitcoin') setCoin('BTC');
    else if (network === 'solana')  setCoin('SOL');
    else if (network === 'cosmos')  setCoin('ATOM');
    else if (network.startsWith('evm:')) {
      const chainId = parseInt(network.slice(4), 10);
      const chain   = EVM_CHAINS.find(c => c.chainId === chainId);
      if (chain) setCoin(chain.nativeSymbol);
    }
  }, [network]);

  const evmChainId: number | null =
    network.startsWith('evm:') ? parseInt(network.slice(4), 10) : null;
  const evmChain = evmChainId !== null ? EVM_CHAINS.find(c => c.chainId === evmChainId) ?? null : null;

  const [stage, setStage]   = useState<SendStage>('compose');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [feeStr, setFeeStr] = useState<string | null>(null);
  // Pre-send simulation — populated by a debounced effect once
  // recipient + amount are valid. Null when not yet run or when the
  // chain isn't in sdk-core's registry (external EVM chains).
  const [simReport, setSimReport] = useState<SimulationReport | null>(null);

  // Recipient UX state — QR scanner + address-book autocomplete + DNNS resolver.
  const [showQr,       setShowQr]       = useState(false);
  const [showSuggest,  setShowSuggest]  = useState(false);
  const [dnnsResolved, setDnnsResolved] = useState<string | null>(null);
  const [dnnsState,    setDnnsState]    = useState<'idle' | 'resolving' | 'not-found'>('idle');
  const contactSuggestions = useMemo<Contact[]>(() => {
    const trimmed = to.trim();
    if (!trimmed) return [];
    return searchContacts(trimmed).slice(0, 5);
  }, [to]);
  const matchedContact = useMemo<Contact | null>(() => {
    // If the input already matches a saved contact, show their name beside the
    // green "Valid address" badge.
    return canonicalEvmFor(to);
  }, [to]);

  function canonicalEvmFor(input: string): Contact | null {
    const evm = resolveToEvm(input.trim());
    return evm ? findContactByAddress(evm) : null;
  }

  /* Live balances for every chain the wallet has access to. Single
     network call set, dedup'd across components via useLiveBalances'
     module-level cache. */
  const walletSource = wallet?.privateKey
    ? { kind: 'privateKey' as const, privateKey: wallet.privateKey }
    : wallet?.seed?.length
      ? { kind: 'mnemonic' as const, mnemonic: wallet.seed.join(' ') }
      : null;
  const live = useLiveBalances(wallet?.evmAddress, walletSource);
  const balanceFor = (sym: string) => live.bySym.get(sym.toLowerCase()) ?? '0';

  /* Lookup the token row for the currently selected symbol — drives
     chain-aware branches for validation, fee estimation and broadcast.
     Note: external EVM-native coins (ETH/BNB/POL/AVAX/…) aren't in TOKENS
     because that file is the Lithosphere ecosystem registry. The
     `isEvmSend` branch below is driven by `network`, not `selectedToken`. */
  const selectedToken = useMemo(() => TOKENS.find(t => t.sym === coin) ?? null, [coin]);
  const isEvmSend     = network.startsWith('evm:');
  const isSolanaSend  = !isEvmSend && (network === 'solana'  || selectedToken?.chain === 'Solana');
  const isBitcoinSend = !isEvmSend && (network === 'bitcoin' || selectedToken?.chain === 'Bitcoin');
  const isCosmosSend  = !isEvmSend && (network === 'cosmos'  || selectedToken?.chain === 'Cosmos');

  /* If the user has connected a Ledger for this coin, we route the
     signature through the device instead of the in-vault key. The
     wallet doesn't need to be unlocked at all in that case — `seed`
     and `privateKey` can both be empty.
     EVM is unified: one ETH-path Ledger account signs across Makalu
     and every external EVM chain since the keypair is chain-agnostic. */
  const ledgerBtc = useMemo(() => isBitcoinSend ? getActiveLedgerBtcAccount() : null, [isBitcoinSend]);
  const ledgerSol = useMemo(() => isSolanaSend  ? getActiveLedgerSolAccount() : null, [isSolanaSend]);
  /** Lithosphere chains share an EVM-style keypair, so the same Ledger
   *  account works on both Makalu and Kamet. */
  const isLithoSend = network === 'makalu' || network === 'kamet';
  /** Live provider for the active Lithosphere chain, picked once per
   *  render — used by every Lithosphere broadcast + confirmation poll. */
  const lithoProvider = useMemo(
    () => network === 'kamet' ? getKametProvider() : getMakaluProvider(),
    [network],
  );
  /** Chain id to anchor a Lithosphere send to — passed to Trezor and
   *  used in the confirmation-polling URL. */
  const lithoChainId = network === 'kamet' ? KAMET_CHAIN_ID : MAKALU_CHAIN_ID;
  const ledgerEvm = useMemo(
    () => (isEvmSend || isLithoSend) ? getActiveLedgerAccount() : null,
    [isEvmSend, isLithoSend],
  );
  /* Trezor — same per-coin model. Ledger takes precedence if somehow
     both are connected for the same coin (one device at a time is the
     expected case). */
  const trezorBtc = useMemo(() => (isBitcoinSend && !ledgerBtc) ? getActiveTrezorBtcAccount() : null, [isBitcoinSend, ledgerBtc]);
  const trezorSol = useMemo(() => (isSolanaSend  && !ledgerSol) ? getActiveTrezorSolAccount() : null, [isSolanaSend, ledgerSol]);
  const trezorEvm = useMemo(
    () => ((isEvmSend || isLithoSend) && !ledgerEvm) ? getActiveTrezorEvmAccount() : null,
    [isEvmSend, network, ledgerEvm],
  );
  const usingLedger = !!(ledgerBtc || ledgerSol || ledgerEvm);
  const usingTrezor = !!(trezorBtc || trezorSol || trezorEvm);
  const usingHardware = usingLedger || usingTrezor;
  const walletReady = !!(wallet?.seed?.length || wallet?.privateKey || usingHardware);

  /* Validate the recipient against the chain of the selected token. */
  const recipientValidation = useMemo(() => {
    const trimmed = to.trim();
    if (!trimmed) return { valid: false, format: null as 'evm' | 'litho' | 'solana' | 'btc' | 'cosmos' | null, reason: '' };
    if (isSolanaSend) {
      return isValidSolanaAddress(trimmed)
        ? { valid: true,  format: 'solana' as const, reason: '' }
        : { valid: false, format: 'solana' as const, reason: 'Not a valid Solana address (base58 PublicKey)' };
    }
    if (isBitcoinSend) {
      return isValidBitcoinAddress(trimmed)
        ? { valid: true,  format: 'btc' as const, reason: '' }
        : { valid: false, format: 'btc' as const, reason: 'Not a valid Bitcoin address (legacy / segwit / bech32 / taproot)' };
    }
    if (isCosmosSend) {
      return isValidCosmosAddress(trimmed)
        ? { valid: true,  format: 'cosmos' as const, reason: '' }
        : { valid: false, format: 'cosmos' as const, reason: 'Not a valid Cosmos address (cosmos1…)' };
    }
    if (isEvmSend) {
      // External EVM chains take 0x addresses only — no litho1 form here.
      return /^0x[a-fA-F0-9]{40}$/.test(trimmed)
        ? { valid: true,  format: 'evm' as const, reason: '' }
        : { valid: false, format: 'evm' as const, reason: `${evmChain?.name ?? 'EVM'} requires a 0x address` };
    }
    const v = validateAddressForChain(trimmed, MAKALU_CHAIN_ID);
    return { ...v, format: v.format as 'evm' | 'litho' | null };
  }, [to, isSolanaSend, isBitcoinSend, isCosmosSend, isEvmSend, evmChain]);

  /* Canonical EVM form — what we'd actually broadcast to the chain.
     If the user typed a DNNS name and we resolved it, use that instead. */
  const canonicalEvm = useMemo(() => {
    const direct = resolveToEvm(to.trim());
    if (direct) return direct;
    return dnnsResolved;
  }, [to, dnnsResolved]);

  /* Phishing / scam-recipient lookup. Runs on every EVM recipient
     (including the resolved 0x of a litho1 / DNNS input). Skipped on
     non-EVM chains since their scam-address space is different. */
  const recipientVerdict = useMemo(() => {
    if (isSolanaSend || isBitcoinSend) return null;
    const addr = canonicalEvm || (isEvmSend ? to.trim() : '');
    if (!addr) return null;
    return classifyRecipient(addr);
  }, [canonicalEvm, isSolanaSend, isBitcoinSend, isEvmSend, to]);
  const recipientBlocked = recipientVerdict?.risk === 'critical';

  /* Debounced DNNS resolution. Only fires when the input looks like a
     name (contains '.', not a raw address). Sets state to drive the inline
     "Resolved to 0x…" hint. */
  useEffect(() => {
    const trimmed = to.trim();
    // DNNS is a Lithosphere-only registry — suppress for non-Makalu sends.
    if (!looksLikeName(trimmed) || !isLithoSend) {
      // DNNS names are resolved for both Makalu and Kamet sends —
      // both chains share the keypair, and the name registry lives on
      // Kamet itself. Non-Lithosphere sends never trigger DNNS lookup.
      setDnnsResolved(null);
      setDnnsState('idle');
      return;
    }
    let cancelled = false;
    setDnnsState('resolving');
    const t = setTimeout(async () => {
      const addr = await resolveName(trimmed);
      if (cancelled) return;
      setDnnsResolved(addr);
      setDnnsState(addr ? 'idle' : 'not-found');
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [to, network]);

  /* Live fee estimate. EVM path uses gasLimit × maxFeePerGas via ethers.
     Solana txs cost a near-constant ~5_000 lamports (0.000005 SOL); we
     show that as the static estimate instead of round-tripping the RPC.
     Bitcoin fees depend on the mempool fee rate × tx vsize, which we
     don't compute pre-broadcast — show a placeholder. */
  useEffect(() => {
    if (!recipientValidation.valid || !amount) {
      setFeeStr(null);
      return;
    }
    if (isSolanaSend)  { setFeeStr('~0.000005 SOL'); return; }
    if (isCosmosSend)  {
      const est = estimateCosmosFee();
      setFeeStr(`~${est.atom} ATOM`);
      return;
    }
    if (isEvmSend && evmChainId !== null && evmChain) {
      if (!wallet?.seed?.length && !wallet?.privateKey) {
        setFeeStr(null);
        return;
      }
      let cancelled = false;
      setFeeStr('Estimating…');
      const t = setTimeout(async () => {
        try {
          const est = await estimateNativeEvmFee(
            wallet.privateKey ? { privateKey: wallet.privateKey } : { seed: wallet.seed },
            { chainId: evmChainId, recipient: to.trim(), amount },
          );
          if (!cancelled) setFeeStr(est ? `${Number(est.totalLitho).toFixed(6)} ${evmChain.nativeSymbol}` : null);
        } catch {
          if (!cancelled) setFeeStr(null);
        }
      }, 350);
      return () => { cancelled = true; clearTimeout(t); };
    }
    if (isBitcoinSend) {
      // Live BTC fee estimate — fetches UTXOs + mempool fastest fee rate,
      // estimates vsize from inputs+outputs. ~0 cost since no signing.
      if (!wallet?.seed?.length && !wallet?.privateKey) {
        setFeeStr(null);
        return;
      }
      const source = wallet.privateKey
        ? { kind: 'privateKey' as const, privateKey: wallet.privateKey }
        : { kind: 'mnemonic'   as const, mnemonic: wallet.seed.join(' ') };
      let cancelled = false;
      setFeeStr('Estimating…');
      const t = setTimeout(async () => {
        try {
          const est = await estimateBitcoinFee({ source, amount });
          if (!cancelled) setFeeStr(est ? `${est.btc} BTC · ${est.feeRate} sat/vB` : null);
        } catch {
          if (!cancelled) setFeeStr(null);
        }
      }, 400);
      return () => { cancelled = true; clearTimeout(t); };
    }
    if (!wallet?.seed?.length && !wallet?.privateKey) {
      setFeeStr(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const est = await estimateSendFee(
          wallet.privateKey ? { privateKey: wallet.privateKey } : { seed: wallet.seed },
          { symbol: coin, recipient: to, amount },
        );
        if (!cancelled) setFeeStr(est ? `${Number(est.totalLitho).toFixed(6)} LITHO` : null);
      } catch {
        if (!cancelled) setFeeStr(null);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [coin, to, amount, recipientValidation.valid, wallet?.seed, wallet?.privateKey, isSolanaSend, isBitcoinSend, isCosmosSend, isEvmSend, evmChainId, evmChain]);

  /* Pre-send simulation — runs alongside the fee estimate above. Only
     fires on EVM/Lithosphere sends (Bitcoin + Solana + Cosmos go through
     other simulators when their respective sdk-core clients support it).
     Result drives the SimulationPanel rendered above the network-fee row;
     a critical issue (e.g. INSUFFICIENT_BALANCE) also disables the Send
     button so the user can't dispatch a guaranteed-to-revert tx. */
  useEffect(() => {
    if (!recipientValidation.valid || !amount) { setSimReport(null); return; }
    const targetChainId = isEvmSend ? evmChainId : lithoChainId;
    if (!targetChainId) { setSimReport(null); return; }
    if (isSolanaSend || isBitcoinSend || isCosmosSend) { setSimReport(null); return; }
    const fromAddr = canonicalEvm || (isEvmSend ? to.trim() : '');
    // Don't simulate when we don't even know the sender — happens briefly
    // before the wallet resolves an EVM address from the active source.
    const senderAddr = (wallet?.addresses?.evm || '').trim();
    if (!senderAddr) { setSimReport(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const report = await simulateEvmSend({
        chainId:      targetChainId,
        from:         senderAddr,
        to:           fromAddr || to.trim(),
        amount,
        tokenSymbol:  coin,
      });
      if (!cancelled) setSimReport(report);
    }, 450);
    return () => { cancelled = true; clearTimeout(t); };
  }, [coin, to, amount, recipientValidation.valid, canonicalEvm, isEvmSend, isSolanaSend, isBitcoinSend, isCosmosSend, evmChainId, wallet?.addresses?.evm]);

  const onSubmit = async () => {
    if (!walletReady) {
      setError('Wallet is locked. Please refresh and unlock.');
      setStage('failed');
      return;
    }

    /* ─── Bitcoin branch ───────────────────────────────────────────────
       Three signing paths converge here:
         (a) Ledger Bitcoin app — when an active LedgerBtcAccount is set
             we hand the unsigned tx to the device for signing. No
             wallet seed needed.
         (b) BIP84 segwit (mnemonic) — derive from the unlocked seed.
         (c) Single-keypair P2WPKH (private key import).
       (b)/(c) build a PSBT locally, signal RBF, and broadcast via
       mempool.space — same as the existing flow. */
    if (isBitcoinSend) {
      setStage('broadcasting');
      setError(null);
      if (ledgerBtc) {
        try {
          const r = await sendBitcoinWithLedger({
            account:   ledgerBtc,
            recipient: to.trim(),
            amount,
          });
          recordPendingTx({
            id:           r.hash,
            chain:        'bitcoin',
            symbol:       'BTC',
            recipient:    to.trim(),
            amount,
            status:       'broadcast',
            broadcastAt:  Date.now(),
            updatedAt:    Date.now(),
            /* No PSBT snapshot from Ledger flow — RBF requires the
               same inputs+outputs which Ledger doesn't echo back. The
               Transactions view will skip the Bump button for this row. */
          });
          setTxHash(r.hash);
          setStage('pending');
        } catch (e) {
          const msg = e instanceof LedgerError ? e.message : (e as Error).message || 'Ledger send failed';
          setError(msg);
          setStage('failed');
        }
        return;
      }
      if (trezorBtc) {
        try {
          const hash = await sendBitcoinWithTrezor({ account: trezorBtc, recipient: to.trim(), amount });
          recordPendingTx({
            id: hash, chain: 'bitcoin', symbol: 'BTC', recipient: to.trim(), amount,
            status: 'broadcast', broadcastAt: Date.now(), updatedAt: Date.now(),
          });
          setTxHash(hash);
          setStage('pending');
        } catch (e) {
          const msg = e instanceof TrezorError ? e.message : (e as Error).message || 'Trezor send failed';
          setError(msg);
          setStage('failed');
        }
        return;
      }
      if (!wallet?.seed?.length && !wallet?.privateKey) {
        setError('Wallet is locked. Please refresh and unlock.');
        setStage('failed');
        return;
      }
      const source = wallet.privateKey
        ? { kind: 'privateKey' as const, privateKey: wallet.privateKey }
        : { kind: 'mnemonic'   as const, mnemonic: wallet.seed.join(' ') };
      try {
        const { hash, snapshot } = await sendBitcoin({
          source,
          recipient: to.trim(),
          amount,
        });
        // Persist so the Transactions view can show this as pending and
        // offer a "Bump fee" affordance until it confirms.
        recordPendingTx({
          id:           hash,
          chain:        'bitcoin',
          symbol:       'BTC',
          recipient:    to.trim(),
          amount,
          status:       'broadcast',
          broadcastAt:  Date.now(),
          updatedAt:    Date.now(),
          btc:          snapshot,
        });
        setTxHash(hash);
        setStage('pending');
      } catch (e) {
        const msg = e instanceof BitcoinSendError ? e.message : (e as Error).message || 'Failed to send';
        setError(msg);
        setStage('failed');
      }
      return;
    }

    /* ─── Cosmos branch ─────────────────────────────────────────────────
       Mnemonic-only — sign + broadcast a MsgSend via @cosmjs/stargate.
       Ledger Cosmos support is its own follow-up. */
    if (isCosmosSend) {
      if (!wallet?.seed?.length) {
        setError('Cosmos send requires a recovery-phrase wallet (private-key import not yet supported for ATOM).');
        setStage('failed');
        return;
      }
      setStage('broadcasting');
      setError(null);
      try {
        const hash = await sendCosmos({
          mnemonic:  wallet.seed.join(' '),
          recipient: to.trim(),
          amount,
        });
        setTxHash(hash);
        setStage('confirmed');
      } catch (e) {
        const msg = e instanceof CosmosSendError ? e.message : (e as Error).message || 'Failed to send';
        setError(msg);
        setStage('failed');
      }
      return;
    }

    /* ─── Solana branch ─────────────────────────────────────────────────
       Two paths:
         (a) Ledger Solana app — signs the compiled message on-device.
             Currently native SOL only; SPL token transfers via Ledger
             land in a follow-up that needs the Solana app's "blind
             signing" toggle.
         (b) Mnemonic-only main-thread flow (no private-key import). */
    if (isSolanaSend) {
      setStage('broadcasting');
      setError(null);
      if (ledgerSol) {
        if (selectedToken && selectedToken.address !== null) {
          setError('SPL token transfers via Ledger are not yet supported. Send native SOL or disconnect Ledger to use the in-vault key.');
          setStage('failed');
          return;
        }
        try {
          const sig = await sendSolWithLedger({
            account:   ledgerSol,
            recipient: to.trim(),
            amount,
          });
          setTxHash(sig);
          setStage('confirmed');
        } catch (e) {
          const msg = e instanceof LedgerError ? e.message : (e as Error).message || 'Ledger send failed';
          setError(msg);
          setStage('failed');
        }
        return;
      }
      if (trezorSol) {
        if (selectedToken && selectedToken.address !== null) {
          setError('SPL token transfers via Trezor are not yet supported. Send native SOL or disconnect Trezor.');
          setStage('failed');
          return;
        }
        try {
          const sig = await sendSolWithTrezor({ account: trezorSol, recipient: to.trim(), amount });
          setTxHash(sig);
          setStage('confirmed');
        } catch (e) {
          const msg = e instanceof TrezorError ? e.message : (e as Error).message || 'Trezor send failed';
          setError(msg);
          setStage('failed');
        }
        return;
      }
      if (!wallet?.seed?.length) {
        setError('Solana send requires a recovery-phrase wallet (private-key import not yet supported for SOL).');
        setStage('failed');
        return;
      }
      if (!selectedToken) return;
      try {
        const sig = selectedToken.address === null
          ? await sendSol({       mnemonic: wallet.seed.join(' '), recipient: to.trim(), amount })
          : await sendSplToken({  mnemonic: wallet.seed.join(' '), recipient: to.trim(), amount,
                                   mintAddress: selectedToken.address, decimals: selectedToken.decimals });
        setTxHash(sig);
        setStage('pending');
        // Solana finalizes in ~13s on average. Treat it as confirmed
        // after the optimistic 'confirmed' commitment that sendTransaction
        // implicitly waits for via the connection's preflight commitment.
        setStage('confirmed');
      } catch (e) {
        const msg = e instanceof SolanaSendError ? e.message : (e as Error).message || 'Failed to send';
        setError(msg);
        setStage('failed');
      }
      return;
    }

    /* ─── External EVM branch ───────────────────────────────────────────
       Native gas-coin send on Ethereum / BNB / Polygon / Base / Arbitrum /
       Linea / Optimism / Avalanche. Same keypair as Makalu, just routed
       through that chain's RPC via getEvmProvider. ERC-20 catalogs per
       chain land in a follow-up commit. */
    if (isEvmSend && evmChainId !== null && evmChain) {
      setStage('broadcasting');
      setError(null);

      /* Ledger EVM path — same keypair signs across all 8 chains. The
         Ledger account holds a derivation path; ledger.ts handles
         per-chain provider + EIP-1559 tx build. */
      if (ledgerEvm) {
        try {
          const provider = getEvmProvider(evmChainId);
          let value: bigint;
          try { value = ethersParseUnits(amount, evmChain.decimals); }
          catch { throw new Error('Invalid amount'); }
          const hash = await ledgerSignEvmTx({
            provider,
            from:  ledgerEvm.address,
            to:    to.trim(),
            value,
            path:  ledgerEvm.path,
          });
          setTxHash(hash);
          setStage('pending');
          provider.waitForTransaction(hash)
            .then(r => {
              if (!r) { setStage('failed'); return; }
              setStage(Number(r.status) === 1 ? 'confirmed' : 'failed');
              if (Number(r.status) !== 1) setError('Transaction reverted on-chain');
            })
            .catch(() => setStage('failed'));
        } catch (e) {
          const msg = (e as Error).message || 'Ledger EVM send failed';
          setError(msg);
          setStage('failed');
        }
        return;
      }

      /* Trezor EVM path — sendEvmWithTrezor builds the EIP-1559 tx,
         the device signs, we broadcast on the chain's provider. */
      if (trezorEvm) {
        try {
          const hash = await sendEvmWithTrezor({
            account: trezorEvm, chainId: evmChainId, recipient: to.trim(), amount,
          });
          setTxHash(hash);
          setStage('pending');
          getEvmProvider(evmChainId).waitForTransaction(hash)
            .then(r => {
              if (!r) { setStage('failed'); return; }
              setStage(Number(r.status) === 1 ? 'confirmed' : 'failed');
              if (Number(r.status) !== 1) setError('Transaction reverted on-chain');
            })
            .catch(() => setStage('failed'));
        } catch (e) {
          const msg = e instanceof TrezorError ? e.message : (e as Error).message || 'Trezor EVM send failed';
          setError(msg);
          setStage('failed');
        }
        return;
      }

      if (!wallet?.seed?.length && !wallet?.privateKey) {
        setError('Connect a hardware wallet or unlock your recovery-phrase wallet to send on EVM chains.');
        setStage('failed');
        return;
      }
      try {
        const result = await sendNativeEvm(
          wallet.privateKey ? { privateKey: wallet.privateKey } : { seed: wallet.seed },
          { chainId: evmChainId, recipient: to.trim(), amount },
        );
        setTxHash(result.hash);
        setStage('pending');
        result.wait()
          .then(r => {
            setStage(r.status === 1 ? 'confirmed' : 'failed');
            if (r.status !== 1) setError('Transaction reverted on-chain');
          })
          .catch(() => setStage('failed'));
      } catch (e) {
        const msg = e instanceof SendError ? e.message : (e as Error).message || 'Failed to send';
        setError(msg);
        setStage('failed');
      }
      return;
    }

    /* ─── Makalu EVM branch (LITHO + LEP100) ───────────────────────── */
    setStage('broadcasting');
    setError(null);

    /* Ledger Makalu path — only native LITHO sends are supported via
       Ledger today. LEP100 transfer() calldata via Ledger is a follow-
       up that needs the ERC-20 ABI provided as a "clearsigning" plugin
       on the Ethereum app, otherwise the device shows raw hex. */
    if (ledgerEvm && selectedToken) {
      if (selectedToken.address !== null) {
        setError('LEP100 token sends via Ledger require clearsigning support — coming soon. Send native LITHO or disconnect Ledger.');
        setStage('failed');
        return;
      }
      try {
        let value: bigint;
        try { value = ethersParseUnits(amount, selectedToken.decimals); }
        catch { throw new Error('Invalid amount'); }
        // Recipient may be litho1… — convert to 0x first.
        const evmRecipient = resolveToEvm(to.trim()) ?? to.trim();
        const hash = await ledgerSignEvmTx({
          provider: lithoProvider,
          from:  ledgerEvm.address,
          to:    evmRecipient,
          value,
          path:  ledgerEvm.path,
        });
        setTxHash(hash);
        setStage('pending');
        lithoProvider.waitForTransaction(hash)
          .then(r => {
            if (!r) { setStage('failed'); return; }
            setStage(Number(r.status) === 1 ? 'confirmed' : 'failed');
            if (Number(r.status) !== 1) setError('Transaction reverted on-chain');
          })
          .catch(() => setStage('failed'));
      } catch (e) {
        const msg = (e as Error).message || `Ledger ${network === 'kamet' ? 'Kamet' : 'Makalu'} send failed`;
        setError(msg);
        setStage('failed');
      }
      return;
    }

    /* Trezor Lithosphere path (Makalu or Kamet) — native LITHO only,
       same clearsigning caveat as Ledger for LEP100 tokens. */
    if (trezorEvm && selectedToken) {
      if (selectedToken.address !== null) {
        setError('LEP100 token sends via Trezor are not yet supported. Send native LITHO or disconnect Trezor.');
        setStage('failed');
        return;
      }
      try {
        const evmRecipient = resolveToEvm(to.trim()) ?? to.trim();
        const hash = await sendEvmWithTrezor({
          account: trezorEvm, chainId: lithoChainId, recipient: evmRecipient, amount,
        });
        setTxHash(hash);
        setStage('pending');
        lithoProvider.waitForTransaction(hash)
          .then(r => {
            if (!r) { setStage('failed'); return; }
            setStage(Number(r.status) === 1 ? 'confirmed' : 'failed');
            if (Number(r.status) !== 1) setError('Transaction reverted on-chain');
          })
          .catch(() => setStage('failed'));
      } catch (e) {
        const msg = e instanceof TrezorError ? e.message : (e as Error).message || `Trezor ${network === 'kamet' ? 'Kamet' : 'Makalu'} send failed`;
        setError(msg);
        setStage('failed');
      }
      return;
    }

    if (!wallet?.seed?.length && !wallet?.privateKey) {
      setError(`Connect a hardware wallet or unlock your recovery-phrase wallet to send on ${network === 'kamet' ? 'Kamet' : 'Makalu'}.`);
      setStage('failed');
      return;
    }
    /* Kamet keyring sends route through the signer worker, but the
       worker's handleSend doesn't yet thread the active chainId — every
       broadcast lands on Makalu. Until that lands (follow-up after the
       worker chainId refactor), block the path explicitly so a Kamet
       selection can't silently broadcast on the wrong chain. Hardware-
       wallet paths above are already chain-aware and untouched. */
    if (network === 'kamet') {
      setError('Sending LITHO on Kamet from an unlocked vault is not yet supported. Use a Ledger or Trezor for Kamet sends, or switch to Makalu.');
      setStage('failed');
      return;
    }
    try {
      // Prefer the worker-isolated signing path. The worker holds the
      // secret in its own context; the main thread only sees the tx hash
      // come back. If the worker is unavailable (race condition during
      // init, or unsupported browser) we fall back to in-process signing.
      // Convert litho1… recipients to 0x BEFORE handing off to the
      // signer worker — the worker hard-rejects any address that
      // doesn't start with 0x with "invalid_address", which surfaces
      // in the Send modal as a misleading "Transaction failed" even
      // though the litho1 address was valid. Same dual-address
      // helper the Ledger/Trezor branches above already use.
      const recipientForWorker = resolveToEvm(to.trim()) ?? to.trim();
      let hash: string;
      try {
        const result = await signerSend({ symbol: coin, recipient: recipientForWorker, amount });
        hash = result.hash;
      } catch (workerErr) {
        const code = workerErr instanceof SignerError ? workerErr.code : '';
        if (code === 'worker_locked' || code === 'worker_crashed') {
          // Same litho1 → 0x conversion on the main-thread fallback path —
          // sendTokens delegates to ethers Wallet.sendTransaction which
          // also rejects non-0x recipients.
          const fallback = await sendTokens(
            wallet.privateKey ? { privateKey: wallet.privateKey } : { seed: wallet.seed },
            { symbol: coin, recipient: recipientForWorker, amount },
          );
          hash = fallback.hash;
          // Background: legacy path exposes a wait() for confirmation polling.
          fallback.wait()
            .then(r => {
              setStage(r.status === 1 ? 'confirmed' : 'failed');
              if (r.status !== 1) setError('Transaction reverted on-chain');
            })
            .catch(() => setStage('failed'));
        } else {
          // Bubble typed worker errors through the same SendError shape so
          // the existing 'failed' UI surfaces a clean message.
          throw workerErr;
        }
      }
      setTxHash(hash);
      setStage('pending');
      // Worker path: poll the chain for confirmation via the main-thread
      // provider. Doesn't block the UI; user can dismiss the modal.
      if (!error && hash) {
        // Lithosphere confirmation polls on the chain-specific provider so
        // a Kamet send doesn't try to read Makalu RPC and time out.
        const confirmProvider = isLithoSend ? lithoProvider : makeProvider();
        confirmProvider.waitForTransaction(hash)
          .then(r => {
            if (!r) { setStage('failed'); return; }
            setStage(Number(r.status) === 1 ? 'confirmed' : 'failed');
            if (Number(r.status) !== 1) setError('Transaction reverted on-chain');
          })
          .catch(() => setStage('failed'));
      }
    } catch (e) {
      // SendError / SignerError carry pre-cleaned copy. Anything else is
      // a raw chain/provider error — run it through the humanizer so dev
      // shorthand ("no runners?!", ethers coalesce blobs) never reaches
      // the failure screen verbatim.
      const msg = e instanceof SendError ? e.message
               : e instanceof SignerError ? e.message
               : humanizeChainError((e as Error).message);
      setError(msg);
      setStage('failed');
    }
  };

  /* ─── Result states (broadcast / pending / confirmed / failed) ───── */

  if (stage !== 'compose') {
    const explorer = txHash
      ? (isSolanaSend  ? solanaExplorerUrl(txHash)
       : isBitcoinSend ? bitcoinExplorerUrl(txHash)
       : isCosmosSend  ? cosmosExplorerUrl(txHash)
       : isEvmSend && evmChain ? `${evmChain.explorerUrl}/tx/${txHash}`
       : `https://makalu.litho.ai/tx/${txHash}`)
      : null;
    return (
      <Modal title="Send" onClose={onClose}>
        <div className="modal-success">
          {stage === 'broadcasting' && <>
            <div className="success-icon" style={{ animation: 'lpScrollHint 1.4s ease-in-out infinite' }}>…</div>
            <div className="success-title">Signing &amp; broadcasting</div>
            <div className="success-sub">Sending {amount} {coin} to {truncateLithoAddress(to.trim(), 10, 6)}</div>
          </>}
          {stage === 'pending' && <>
            <div className="success-icon">✓</div>
            <div className="success-title">Submitted</div>
            <div className="success-sub">Waiting for confirmation…</div>
            {txHash && <a href={explorer ?? '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace', marginTop: 6 }}>
              {truncateLithoAddress(txHash, 14, 10)}
            </a>}
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
          </>}
          {stage === 'confirmed' && <>
            <div className="success-icon" style={{ color: 'var(--green)' }}>✓</div>
            <div className="success-title">Confirmed</div>
            <div className="success-sub">{amount} {coin} sent to {truncateLithoAddress(to.trim(), 10, 6)}</div>
            {txHash && <a href={explorer ?? '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, color: 'var(--blue)', wordBreak: 'break-all', fontFamily: 'Geist Mono, monospace', marginTop: 6 }}>
              View on explorer →
            </a>}
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 12 }}>Done</button>
          </>}
          {stage === 'failed' && <>
            <div className="success-icon" style={{ color: 'var(--red)' }}>✕</div>
            <div className="success-title">Transaction failed</div>
            <div className="success-sub" style={{ color: 'var(--red)' }}>{error || 'Unknown error'}</div>
            <button className="btn-primary" onClick={() => { setStage('compose'); setError(null); setTxHash(null); }}
              style={{ marginTop: 12 }}>Try again</button>
          </>}
        </div>
      </Modal>
    );
  }

  /* ─── Compose state — MM-style vertical flow ──────────────────────
     Order top-to-bottom:
       1) Amount HERO — big centered input + USD equivalent + asset chip
       2) "To" recipient — input + QR scan, with autocomplete + DNNS
       3) Network fee row
       4) Big Send button
     The asset chip beneath the amount opens the existing TokenSelect
     dropdown so we don't lose chain-aware behaviour. */

  const amountNum = parseFloat(amount || '0') || 0;
  const tokenPrice = TOKENS.find(t => t.sym === coin)?.priceUsd ?? 0;
  const usdEquivalent = amountNum > 0 && tokenPrice > 0
    ? `$${(amountNum * tokenPrice).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    : '$0.00';

  const currentNet = SEND_NETWORKS.find(n => n.id === network);

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="modal-body" style={{ gap: 0 }}>

        {/* ── Network picker ─────────────────────────────────────── */}
        <label className="field-label" style={{ marginBottom: 6 }}>Network</label>
        <RadixSelect.Root value={network} onValueChange={v => setNetwork(v as SendNet['id'])}>
          <RadixSelect.Trigger
            aria-label="Send network"
            className="field-select"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', cursor: 'pointer', textAlign: 'left',
              appearance: 'none', backgroundImage: 'none',
              marginBottom: 4,
            }}
          >
            <TokenIcon
              sym={
                isLithoSend           ? 'LITHO' :
                network === 'bitcoin' ? 'BTC' :
                network === 'solana'  ? 'SOL' :
                (evmChain?.nativeSymbol ?? 'LITHO')
              }
              color={evmChain?.color}
              size={22}
            />
            <RadixSelect.Value asChild>
              <span style={{ flex: 1, fontWeight: 600 }}>{currentNet?.label ?? 'Pick network'}</span>
            </RadixSelect.Value>
            <RadixSelect.Icon asChild>
              <ChevronDown size={16} strokeWidth={2} style={{ color: 'var(--text-muted)' }}/>
            </RadixSelect.Icon>
          </RadixSelect.Trigger>
          <RadixSelect.Portal>
            <RadixSelect.Content
              position="popper"
              sideOffset={6}
              className="card"
              style={{
                zIndex: 100,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 12, padding: 4,
                minWidth: 'var(--radix-select-trigger-width)',
                maxHeight: 'min(360px, var(--radix-select-content-available-height))',
                boxShadow: '0 10px 28px rgba(0,0,0,0.24)',
                overflow: 'hidden',
              }}
            >
              <RadixSelect.Viewport style={{ padding: 2 }}>
                {SEND_NETWORKS.map(n => {
                  const evmId = n.id.startsWith('evm:') ? parseInt(n.id.slice(4), 10) : null;
                  const chain = evmId !== null ? EVM_CHAINS.find(c => c.chainId === evmId) ?? null : null;
                  const sym   =
                    n.id === 'makalu'  ? 'LITHO' :
                    n.id === 'kamet'   ? 'LITHO' :
                    n.id === 'bitcoin' ? 'BTC' :
                    n.id === 'solana'  ? 'SOL' :
                    (chain?.nativeSymbol ?? 'LITHO');
                  return (
                    <RadixSelect.Item
                      key={n.id}
                      value={n.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px', borderRadius: 8,
                        cursor: 'pointer', outline: 'none', userSelect: 'none',
                        fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <TokenIcon sym={sym} color={chain?.color} size={22}/>
                      <RadixSelect.ItemText asChild>
                        <span style={{ flex: 1 }}>{n.label}</span>
                      </RadixSelect.ItemText>
                      <RadixSelect.ItemIndicator>
                        <Check size={14} strokeWidth={2.5} style={{ color: 'var(--blue)' }}/>
                      </RadixSelect.ItemIndicator>
                    </RadixSelect.Item>
                  );
                })}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>

        {/* ── Amount hero (big, centered) ─────────────────────────── */}
        <div style={{
          padding: '20px 0 12px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value)}
            type="number"
            placeholder="0"
            inputMode="decimal"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)',
              fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em',
              textAlign: 'center', width: '100%', padding: 0,
              fontFamily: 'inherit',
            }}
          />
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{usdEquivalent}</div>
        </div>

        {/* Asset chip — Lithosphere (Makalu + Kamet) has multiple sendable
            assets (LITHO + LEP100 tokens) so we keep the dropdown there.
            Every other chain has exactly one native asset, so we show a
            static chip. */}
        <div style={{ marginBottom: 12 }}>
          {isLithoSend ? (
            <TokenSelect value={coin} onChange={setCoin} options={MAKALU_SYMBOLS} ariaLabel="Send asset"/>
          ) : (
            <div className="field-select" style={{
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'default', opacity: 0.95,
            }}>
              <TokenIcon sym={coin} color={evmChain?.color} size={22}/>
              <span style={{ flex: 1, fontWeight: 600 }}>{coin}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>native</span>
            </div>
          )}
        </div>

        {/* Balance + MAX */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: 'var(--text-muted)', marginBottom: 14,
          padding: '0 2px',
        }}>
          <span>Balance: {balanceFor(coin)} {coin}</span>
          <button
            style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}
            onClick={() => setAmount(balanceFor(coin).replace(/,/g, ''))}
          >
            MAX
          </button>
        </div>

        <label className="field-label">To</label>
        <div style={{ position: 'relative' }}>
          <input
            className="field-input"
            placeholder={
              isSolanaSend  ? 'Solana address…'  :
              isBitcoinSend ? 'Bitcoin address…' :
              isCosmosSend  ? 'cosmos1…'         :
              isEvmSend     ? `${evmChain?.name ?? 'EVM'} address (0x…)` :
              'litho1… or 0x…'
            }
            value={to}
            onChange={e => { setTo(e.target.value); setShowSuggest(true); }}
            onFocus={() => setShowSuggest(true)}
            onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{ fontFamily: to ? 'Geist Mono, monospace' : undefined, fontSize: to ? 12 : 14, paddingRight: 44, paddingTop: 14, paddingBottom: 14 }}
          />
          <button
            type="button"
            onClick={() => setShowQr(true)}
            aria-label="Scan QR"
            title="Scan QR"
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
              borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex',
            }}
          >
            <QrCode size={18} color="var(--text-secondary)"/>
          </button>
        </div>

        {/* Saved-contact autocomplete — shows up to 5 matches as the user types. */}
        {showSuggest && contactSuggestions.length > 0 && (
          <div style={{
            marginTop: 6,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            padding: 4,
            maxHeight: 180,
            overflowY: 'auto',
          }}>
            {contactSuggestions.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={() => { setTo(c.evm); setShowSuggest(false); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  width: '100%', padding: '8px 10px', borderRadius: 6,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'inherit', textAlign: 'left',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseOut={e  => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>{c.evm}</span>
              </button>
            ))}
          </div>
        )}

        {to.trim() && recipientValidation.valid && (
          <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            ✓ Valid {
              recipientValidation.format === 'litho'  ? 'litho1' :
              recipientValidation.format === 'solana' ? 'Solana' :
              recipientValidation.format === 'btc'    ? 'Bitcoin' :
              recipientValidation.format === 'cosmos' ? 'Cosmos' :
              isEvmSend && evmChain                   ? evmChain.name :
              'EVM'
            } address
            {matchedContact && !isSolanaSend && !isBitcoinSend && !isEvmSend && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>· {matchedContact.name}</span>
            )}
            {recipientValidation.format === 'litho' && canonicalEvm && (
              <span style={{ color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>
                · {truncateLithoAddress(canonicalEvm, 8, 6)}
              </span>
            )}
          </div>
        )}

        {/* DNNS — resolved / resolving / not-found states for name input. */}
        {looksLikeName(to.trim()) && (
          <>
            {dnnsState === 'resolving' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Resolving {to.trim()}…
              </div>
            )}
            {dnnsState === 'idle' && dnnsResolved && (
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                ✓ Resolved {to.trim()}
                <span style={{ color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace' }}>
                  → {truncateLithoAddress(dnnsResolved, 8, 6)}
                </span>
              </div>
            )}
            {dnnsState === 'not-found' && (
              <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
                Could not resolve {to.trim()}
              </div>
            )}
          </>
        )}

        {to.trim() && !recipientValidation.valid && (!looksLikeName(to.trim()) || !isLithoSend) && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
            {recipientValidation.reason || 'Invalid address'}
          </div>
        )}

        <QrScannerModal
          open={showQr}
          onClose={() => setShowQr(false)}
          onResult={(decoded) => { setTo(decoded); setShowQr(false); }}
        />

        {recipientVerdict && recipientVerdict.risk !== 'safe' && (
          <PhishingBanner verdict={recipientVerdict} compact/>
        )}

        {/* Pre-send simulation — shows contract warnings + balance checks
            before signing. Hidden when there's nothing to surface; a
            critical issue also disables the Send button below. */}
        <SimulationPanel report={simReport} compact/>

        <div className="fee-row" style={{ marginTop: 14, fontSize: 13 }}>
          <span>Network fee</span>
          <span>{feeStr ? `≈ ${feeStr}` : '—'}</span>
        </div>
        <button
          className="btn-primary"
          style={{
            marginTop: 18,
            padding: '14px 16px',
            fontSize: 15, fontWeight: 700,
            borderRadius: 12,
          }}
          disabled={!recipientValidation.valid || !amount || recipientBlocked || !walletReady || hasCriticalIssue(simReport)}
          onClick={onSubmit}
          title={
            recipientBlocked        ? 'Recipient flagged as high-risk — sending is blocked.'
            : hasCriticalIssue(simReport) ? 'Pre-send simulation found a critical issue — sending is blocked.'
            : undefined
          }
        >
          {recipientBlocked
            ? 'Recipient blocked'
            : hasCriticalIssue(simReport)
            ? 'Issue detected — blocked'
            : usingLedger ? `Confirm on Ledger · Send ${coin}`
            : usingTrezor ? `Confirm on Trezor · Send ${coin}`
            : `Send ${coin}`}
        </button>
        {usingHardware && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
            Signing via {usingLedger ? 'Ledger' : 'Trezor'} · {(() => {
              const a = ledgerBtc?.address ?? ledgerSol?.address ?? ledgerEvm?.address
                     ?? trezorBtc?.address ?? trezorSol?.address ?? trezorEvm?.address ?? '';
              return `${a.slice(0, 8)}…${a.slice(-6)}`;
            })()}
          </div>
        )}
        {!walletReady && (
          <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6, textAlign: 'center' }}>
            Wallet locked — refresh to unlock
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * MetaMask-style Receive screen — list of networks the wallet has an
 * address on, with copy + QR per row.
 *
 * Behaviour:
 *   - Default: searchable list of networks. Each row shows network icon,
 *     name, truncated address, and copy + QR buttons.
 *   - Click QR on a row: expands to a full QR card for that network +
 *     "Copy address" CTA. Back arrow returns to the list.
 *   - EVM-flavoured chains (Ethereum, BNB, Polygon, Linea, Base, Arbitrum,
 *     etc.) all share the wallet's single 0x… address since EVM keypairs
 *     are chain-agnostic — but each row gets its own entry so the user
 *     understands which chain they're receiving on. Lithosphere Makalu
 *     gets two rows: the litho1 bech32 form AND the 0x form, since both
 *     are valid recipients on the chain.
 */
import { Copy as CopyIcon, QrCode as QrCodeIcon, ChevronLeft, Search } from 'lucide-react';
import QRCode from 'qrcode';
import { getSolanaAddress } from '../lib/solana';
import { getBitcoinAddressFromSource } from '../lib/bitcoin';
import { getCosmosAddress } from '../lib/cosmos';

interface ReceiveNetwork {
  id:      string;
  name:    string;
  /** Symbol used by TokenIcon for the chain logo. */
  symbol:  string;
  /** Brand color for the avatar fallback. */
  color:   string;
  /** Primary address — what the list row and the QR show by default. */
  address: string;
  /** Optional badge — shown as a small label after the name (e.g. "EVM"). */
  badge?:  string;
  /** Optional alternate address format (Lithosphere has dual addresses:
   *  the native litho1… bech32 and the same wallet's 0x EVM form). The
   *  QR view shows a primary/alt toggle when this is set. */
  altAddress?: string;
  /** Label shown in the toggle for the primary address (e.g. "Native"). */
  primaryLabel?: string;
  /** Label shown in the toggle for the alternate address (e.g. "EVM"). */
  altLabel?: string;
}

export function ReceiveModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const [view, setView]     = useState<'list' | 'qr'>('list');
  const [active, setActive] = useState<ReceiveNetwork | null>(null);
  const [search, setSearch] = useState('');
  const [qrSvg, setQrSvg]   = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAlt,  setShowAlt]  = useState(false);

  const litho = wallet?.addresses?.litho ?? '';
  const evm   = wallet?.addresses?.evm   ?? '';

  /* Derive non-EVM addresses on demand. Same code path as the dashboard
     uses to display SOL / BTC balances; safe to call repeatedly.
     Cosmos derivation is async (CosmJS does I/O-free crypto behind a
     Promise) so it lands via a separate useEffect. */
  const { btcAddr, solAddr } = useMemo(() => {
    const seedAvailable = !!wallet?.seed?.length;
    const pk = wallet?.privateKey;
    let btc = '';
    let sol = '';
    try {
      if (seedAvailable) {
        sol = getSolanaAddress(wallet!.seed.join(' '));
      }
      const source = pk
        ? { kind: 'privateKey' as const, privateKey: pk }
        : seedAvailable
          ? { kind: 'mnemonic' as const, mnemonic: wallet!.seed.join(' ') }
          : null;
      if (source) btc = getBitcoinAddressFromSource(source);
    } catch { /* derivation can fail for malformed keys — show nothing */ }
    return { btcAddr: btc, solAddr: sol };
  }, [wallet?.seed, wallet?.privateKey]);

  const [atomAddr, setAtomAddr] = useState('');
  useEffect(() => {
    let cancelled = false;
    setAtomAddr('');
    if (!wallet?.seed?.length) return;
    getCosmosAddress(wallet.seed.join(' '))
      .then(a => { if (!cancelled) setAtomAddr(a); })
      .catch(() => { /* swallow — malformed seed shows no row */ });
    return () => { cancelled = true; };
  }, [wallet?.seed]);

  /* The network list. Lithosphere has dual address formats (litho1… and
     0x) for the same keypair — each chain row carries both and the QR
     view exposes a toggle. Esha asked us to surface Makalu and Kamet as
     SEPARATE selectable rows (MetaMask / Trust Wallet pattern) so users
     explicitly pick which Lithosphere chain they're receiving on —
     even though the address is identical on both. Non-Lithosphere
     networks (Bitcoin / Solana / Cosmos) each get one row. */
  const networks: ReceiveNetwork[] = useMemo(() => {
    const out: ReceiveNetwork[] = [];
    if (litho || evm) {
      // Makalu — Lithosphere main chain (700777). The default for
      // most sends; users selecting Makalu here see exactly the same
      // address they'd see on Kamet, with the same litho1 / EVM
      // toggle.
      out.push({
        id:           'lithosphere-makalu',
        name:         'Lithosphere Makalu',
        symbol:       'LITHO',
        color:        '#3b7af7',
        address:      litho || evm,
        altAddress:   litho && evm ? evm : undefined,
        primaryLabel: 'Litho1',
        altLabel:     'EVM',
      });
      // Kamet — Lithosphere sister chain (900523), where DNNS lives.
      // Same keypair → same address strings as Makalu. We surface a
      // separate row anyway so users sending from a dApp on Kamet can
      // confirm explicitly which chain they expect funds on.
      out.push({
        id:           'lithosphere-kamet',
        name:         'Lithosphere Kamet',
        symbol:       'LITHO',
        color:        '#6366f1',
        address:      litho || evm,
        altAddress:   litho && evm ? evm : undefined,
        primaryLabel: 'Litho1',
        altLabel:     'EVM',
      });
    }
    if (btcAddr)  out.push({ id: 'bitcoin', name: 'Bitcoin',    symbol: 'BTC',  color: '#f7931a', address: btcAddr });
    if (solAddr)  out.push({ id: 'solana',  name: 'Solana',     symbol: 'SOL',  color: '#14f195', address: solAddr });
    if (atomAddr) out.push({ id: 'cosmos',  name: 'Cosmos Hub', symbol: 'ATOM', color: '#2e3148', address: atomAddr });
    return out;
  }, [litho, evm, btcAddr, solAddr, atomAddr]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return networks;
    return networks.filter(n => n.name.toLowerCase().includes(q) || n.symbol.toLowerCase().includes(q));
  }, [networks, search]);

  /* Generate the QR SVG whenever the active network changes. qrcode's
     toString(svg) returns an inline SVG ~1KB; we drop it into the DOM
     via dangerouslySetInnerHTML. The string is wallet-derived addresses,
     not user input, so injection risk is nil. */
  useEffect(() => {
    if (view !== 'qr' || !active) { setQrSvg(null); return; }
    const target = active.altAddress && showAlt ? active.altAddress : active.address;
    let cancelled = false;
    QRCode.toString(target, {
      type:    'svg',
      margin:  1,
      width:   220,
      color:   { dark: '#ffffff', light: '#00000000' },
    }).then(svg => { if (!cancelled) setQrSvg(svg); })
      .catch(() => { if (!cancelled) setQrSvg(null); });
    return () => { cancelled = true; };
  }, [view, active, showAlt]);

  // Reset the dual-format toggle when the active network changes, so
  // each network's QR view opens on its primary format.
  useEffect(() => { setShowAlt(false); }, [active]);

  const copy = (n: ReceiveNetwork, addressOverride?: string) => {
    const a = addressOverride ?? n.address;
    if (!a) return;
    navigator.clipboard?.writeText(a).catch(() => {});
    setCopiedId(n.id);
    setTimeout(() => setCopiedId(prev => prev === n.id ? null : prev), 1500);
  };

  /* ─── QR sub-view ───────────────────────────────────────────────────── */
  if (view === 'qr' && active) {
    const displayedAddress = active.altAddress && showAlt ? active.altAddress : active.address;
    return (
      <Modal title="Receive" onClose={onClose}>
        <div className="modal-body" style={{ padding: '4px 4px 8px' }}>
          <button
            onClick={() => setView('list')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
              padding: '6px 4px', marginBottom: 8,
            }}
          >
            <ChevronLeft size={16}/> Back
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '4px 0 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TokenIcon sym={active.symbol} color={active.color} size={32}/>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{active.name}</div>
                {active.badge && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: 1, fontWeight: 600 }}>
                    {active.badge}
                  </div>
                )}
              </div>
            </div>

            {active.altAddress && (
              <div style={{
                display: 'inline-flex',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 999, padding: 3,
              }}>
                {[
                  { key: 'primary' as const, label: active.primaryLabel ?? 'Native', isAlt: false },
                  { key: 'alt'     as const, label: active.altLabel     ?? 'Alt',    isAlt: true  },
                ].map(o => {
                  const selected = o.isAlt === showAlt;
                  return (
                    <button
                      key={o.key}
                      onClick={() => setShowAlt(o.isAlt)}
                      style={{
                        background: selected ? 'var(--bg-card)' : 'transparent',
                        border: 'none', cursor: 'pointer',
                        padding: '6px 14px', borderRadius: 999,
                        fontSize: 12, fontWeight: 600,
                        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                        transition: 'background .15s ease, color .15s ease',
                      }}
                    >{o.label}</button>
                  );
                })}
              </div>
            )}

            <div style={{
              padding: 14, background: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)', borderRadius: 14,
              color: 'var(--text-primary)',
            }}>
              {qrSvg
                ? <div dangerouslySetInnerHTML={{ __html: qrSvg }} style={{ lineHeight: 0 }}/>
                : <div style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Generating QR…</div>
              }
            </div>

            {/* Full address — tap to copy, also manually selectable. */}
            <button
              type="button"
              onClick={() => copy(active, displayedAddress)}
              title={copiedId === active.id ? 'Copied!' : 'Click to copy'}
              style={{
                fontSize: 12, color: 'var(--text-secondary)',
                fontFamily: 'Geist Mono, monospace',
                wordBreak: 'break-all', textAlign: 'center',
                padding: '10px 12px',
                background: 'var(--bg-elevated)',
                border: copiedId === active.id ? '1px solid var(--green)' : '1px solid var(--border-default)',
                borderRadius: 10, width: '100%',
                cursor: 'pointer',
                userSelect: 'text',           // allow manual select too
                WebkitUserSelect: 'text',
                transition: 'border-color .15s ease',
              }}
            >
              {displayedAddress}
            </button>

            <button className="btn-primary" style={{ width: '100%' }} onClick={() => copy(active, displayedAddress)}>
              {copiedId === active.id ? '✓ Copied' : 'Copy address'}
            </button>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5, maxWidth: 320 }}>
              Only send {
                active.symbol === 'BTC'  ? 'Bitcoin'      :
                active.symbol === 'SOL'  ? 'Solana / SPL' :
                active.symbol === 'ATOM' ? 'Cosmos Hub (ATOM)' :
                active.name
              } assets to this address.
              Sending tokens from another chain will result in lost funds.
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  /* ─── List view (default) ──────────────────────────────────────────── */
  return (
    <Modal title="Receiving address" onClose={onClose}>
      <div className="modal-body" style={{ padding: '4px 4px 8px' }}>
        <div style={{
          position: 'relative', marginBottom: 8,
        }}>
          <Search
            size={15}
            style={{
              position: 'absolute', left: 12, top: '50%',
              transform: 'translateY(-50%)', color: 'var(--text-muted)',
            }}
          />
          <input
            className="field-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search networks"
            style={{ paddingLeft: 36 }}
          />
        </div>

        <div style={{
          maxHeight: 460, overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}>
          {filtered.map(n => (
            <div
              key={n.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 8px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <TokenIcon sym={n.symbol} color={n.color} size={36}/>
              {/* Whole name+address column is a button that copies the
                  address. Keeps the dedicated icon button for visual cue
                  + a11y. The truncated address has userSelect:'text' so
                  a long-press / drag-select also works on mobile. */}
              <button
                type="button"
                onClick={() => copy(n)}
                title={copiedId === n.id ? 'Copied!' : 'Click to copy address'}
                style={{
                  flex: 1, minWidth: 0,
                  background: 'transparent', border: 'none', padding: 0,
                  textAlign: 'left', cursor: 'pointer', color: 'inherit',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{n.name}</span>
                  {n.badge && (
                    <span style={{
                      fontSize: 9, letterSpacing: 1, padding: '2px 5px',
                      background: 'var(--bg-elevated)', borderRadius: 4,
                      color: 'var(--text-secondary)', fontWeight: 600,
                    }}>{n.badge}</span>
                  )}
                </div>
                <div style={{
                  fontSize: 11,
                  color: copiedId === n.id ? 'var(--green)' : 'var(--text-muted)',
                  fontFamily: 'Geist Mono, monospace',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  transition: 'color .15s ease',
                }}>
                  {copiedId === n.id
                    ? '✓ Copied'
                    : n.address.length > 22
                      ? `${n.address.slice(0, 10)}…${n.address.slice(-8)}`
                      : n.address}
                </div>
              </button>
              <button
                aria-label={`Copy ${n.name} address`}
                title={copiedId === n.id ? 'Copied!' : 'Copy address'}
                onClick={() => copy(n)}
                style={iconRowBtn}
              >
                {copiedId === n.id
                  ? <span style={{ fontSize: 11, color: 'var(--green)' }}>✓</span>
                  : <CopyIcon size={16}/>}
              </button>
              <button
                aria-label={`Show QR for ${n.name}`}
                title="Show QR"
                onClick={() => { setActive(n); setView('qr'); }}
                style={iconRowBtn}
              >
                <QrCodeIcon size={16}/>
              </button>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No networks match "{search}".
            </div>
          )}
        </div>

        {/* Same-address note — every EVM row above resolves to the same
            0x… string because EVM accounts are chain-agnostic. The
            wallet now fetches balances on every chain in the list so
            this isn't aspirational any more, just a UX reminder that
            you don't need to keep separate keypairs per chain. */}
        {evm && (
          <div style={{
            marginTop: 10,
            padding: '10px 12px',
            background: 'var(--bg-elevated)',
            border: '1px dashed var(--border-default)',
            borderRadius: 10,
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5,
          }}>
            Lithosphere has two address formats — <strong>litho1…</strong> (native) and
            <strong> 0x…</strong> (EVM). They're the same wallet; open the QR to switch
            formats. Other chains have their own keypairs.
          </div>
        )}
      </div>
    </Modal>
  );
}

const iconRowBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-secondary)', padding: 8,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8,
};

/** Translate a raw chain / provider error into user-readable copy for the
 *  SEND failure screen. Covers the shapes ethers v6 + the Lithosphere
 *  nodes actually produce (verified against rpc.litho.ai 2026-06-12):
 *  "failed to check sender balance: … insufficient funds", "invalid chain
 *  id for signer", nonce gaps, and ethers' "could not coalesce error"
 *  wrappers. Upstream Litho services have also leaked dev shorthand like
 *  "no runners?!" — anything we can't classify gets a generic line with
 *  the raw detail kept small underneath rather than AS the headline. */
function humanizeChainError(raw?: string | null): string {
  const txt = (raw || '').trim();
  const low = txt.toLowerCase();
  if (!low) return 'Transaction couldn’t be sent. Try again in a moment.';
  if (low.includes('insufficient funds') || (low.includes('insufficient') && low.includes('balance'))) {
    return 'Insufficient LITHO to cover the amount plus gas.';
  }
  if (low.includes('invalid chain id') || low.includes('intended signer')) {
    return 'Network mismatch while signing — reload the app and retry.';
  }
  if (low.includes('nonce')) {
    return 'A previous transaction is still pending. Wait for it to confirm, then retry.';
  }
  if (low.includes('runner') || low.includes('relayer')) {
    return 'The network’s transaction executors are temporarily unavailable (upstream Lithosphere issue). Try again in a few minutes.';
  }
  if (low.includes('timeout') || low.includes('timed out') || low.includes('abort')) {
    return 'The RPC node timed out. Check your connection and retry.';
  }
  if (low.includes('rejected') || low.includes('denied')) {
    return 'Transaction cancelled.';
  }
  // Unknown — keep a short sanitized fragment for support, never the blob.
  const detail = txt.replace(/\(.*$/, '').slice(0, 80).trim();
  return detail
    ? `Transaction couldn’t be sent (${detail}). Try again in a moment.`
    : 'Transaction couldn’t be sent. Try again in a moment.';
}

type SwapStage = 'compose' | 'executing' | 'bridging' | 'settling' | 'completed' | 'failed';

/** Translate a raw bridge / DEX error string into user-readable copy.
 *  Bridge and Ignite return developer shorthand like "no runners?!",
 *  "execution reverted (0x…)", "INSUFFICIENT_FUNDS_FOR_GAS". Surfacing
 *  that verbatim teaches users nothing and looks like a crash. We map
 *  the common shapes to a concise message and fall through to a generic
 *  "couldn't complete" for anything else. */
function translateSwapError(raw?: string | null): string {
  const txt = (raw || '').trim().toLowerCase();
  if (!txt) return 'Swap couldn’t complete. Try again in a moment.';
  if (txt.includes('runner') || txt.includes('relayer')) {
    return 'No bridge relayers available right now. Try again in a few minutes.';
  }
  if (txt.includes('insufficient') && txt.includes('gas')) {
    return 'Not enough native balance to cover gas. Top up and retry.';
  }
  if (txt.includes('insufficient')) {
    return 'Insufficient balance for this swap.';
  }
  if (txt.includes('slippage') || txt.includes('price impact')) {
    return 'Price moved beyond your slippage tolerance. Raise slippage or refresh the quote.';
  }
  if (txt.includes('rejected') || txt.includes('denied') || txt.includes('user')) {
    return 'Swap cancelled.';
  }
  if (txt.includes('timeout') || txt.includes('timed out')) {
    return 'Bridge timed out. Try again shortly.';
  }
  if (txt.includes('not implemented') || txt.includes('501')) {
    return 'Bridge is temporarily unavailable. Try again later.';
  }
  return 'Swap couldn’t complete. Try again in a moment.';
}

export function SwapModal({ onClose, initialFrom }: {
  onClose: () => void;
  /** Pre-select the FROM asset (e.g. opened from a token detail screen). */
  initialFrom?: string;
}) {
  const wallet = useWallet();
  const [from, setFrom] = useState(initialFrom ?? 'LITHO');
  const [to, setTo]     = useState(initialFrom === 'LitBTC' ? 'LITHO' : 'LitBTC');
  const [amt, setAmt]   = useState('100');
  /** User-configured slippage tolerance (percent). Lets us derive the
   *  Minimum-received line from the quote and gate execution when the
   *  quote drifts more than slippage between fetch and tap. */
  const [slippagePct, setSlippagePct] = useState<number>(0.5);
  /** Tick that re-renders the "quote expires in Ns" countdown without
   *  re-fetching. Pinned to setInterval, scoped to mount. */
  const [, setExpTick] = useState(0);

  /** Best live quote across MultX (cross-chain bridge) and Ignite
   *  (same-chain DEX). `provider` records which route won so execute +
   *  status polling go to the right service. */
  const [quote, setQuote]               = useState<MultXQuote | null>(null);
  const [provider, setProvider]         = useState<'multx' | 'ignite' | null>(null);
  const [quoteError, setQuoteError]     = useState<string | null>(null);
  const [bridgeOffline, setBridgeOffline] = useState(false);

  /* Execution / status tracking — once the user clicks Swap, we POST to
     /v1/execute, then poll /v1/status/:id until the bridge resolves the
     destination tx (or errors). State transitions drive a simple progress
     panel beneath the form. */
  const [stage, setStage] = useState<SwapStage>('compose');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [sourceHash,  setSourceHash]  = useState<string | null>(null);
  const [destHash,    setDestHash]    = useState<string | null>(null);
  const [execError,   setExecError]   = useState<string | null>(null);
  // Duplicate-submission guards. `executingRef` is a sync flag that
  // short-circuits a second onSwap before React has a chance to flip
  // `stage` to 'executing' and disable the button — defends against the
  // user double-clicking faster than the render cycle. `submittedQuotes`
  // remembers which quoteIds have already been executed in this modal
  // session so a back-and-forth navigation can't fire the same quote
  // through `multxExecute` twice. A page reload generates a fresh quote
  // (the quote-fetch effect re-runs), so the in-memory dedup is enough.
  const executingRef    = useRef(false);
  const submittedQuotes = useRef<Set<string>>(new Set());

  // Fallback indicative rate from the canonical USD prices — used only when
  // the MultX endpoint isn't reachable, so the UI still has something to show.
  const priceOf = (sym: string) => TOKENS.find(t => t.sym === sym)?.priceUsd ?? 1;
  const fallbackRate = priceOf(from) / priceOf(to);
  const fallbackOut  = fallbackRate * parseFloat(amt || '0');

  /* Debounced quote fetch — route optimisation. Quote MultX and Ignite
     in parallel and keep whichever returns the larger output. MultX is
     a cross-chain bridge, Ignite a same-chain DEX; for a given pair one
     or both may quote, and we always show the user the better deal. */
  useEffect(() => {
    const trimmed = amt.trim();
    if (!trimmed || parseFloat(trimmed) <= 0 || from === to) {
      setQuote(null); setProvider(null); setQuoteError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const [multxRes, igniteRes] = await Promise.allSettled([
        multxGetQuote(from, to, trimmed),
        igniteGetQuote(from, to, trimmed),
      ]);
      if (cancelled) return;

      const candidates: Array<{ provider: 'multx' | 'ignite'; quote: MultXQuote }> = [];
      if (multxRes.status  === 'fulfilled') candidates.push({ provider: 'multx',  quote: multxRes.value });
      if (igniteRes.status === 'fulfilled') candidates.push({ provider: 'ignite', quote: igniteRes.value });

      if (candidates.length === 0) {
        // Both routes down — fall back to the indicative price-table rate.
        setQuote(null); setProvider(null);
        const bridgeDown = multxRes.status === 'rejected' && multxRes.reason instanceof MultXUnavailable;
        const dexDown    = igniteRes.status === 'rejected' && igniteRes.reason instanceof IgniteUnavailable;
        setBridgeOffline(bridgeDown && dexDown);
        setQuoteError(
          bridgeDown && dexDown ? 'Bridge + DEX offline — showing indicative rate'
          : (multxRes.status === 'rejected' ? (multxRes.reason as Error)?.message : null)
            ?? 'Quote failed',
        );
        return;
      }

      // Pick the route with the highest output amount.
      candidates.sort((a, b) => Number(b.quote.toAmount) - Number(a.quote.toAmount));
      const best = candidates[0];
      setQuote(best.quote);
      setProvider(best.provider);
      setQuoteError(null);
      setBridgeOffline(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [from, to, amt]);

  const displayedRate = quote ? quote.rate : fallbackRate;
  const displayedOut  = quote ? Number(quote.toAmount) : fallbackOut;
  const feeLine = quote ? `${quote.feeFrom} ${quote.from}` : 'Rate-only preview';
  /** Minimum received = toAmount × (1 − slippage). Drives both the UI
   *  hint and a defensive client-side check before broadcast. */
  const minReceived = quote ? displayedOut * (1 - slippagePct / 100) : 0;
  /** True when the quote has a real expiry stamped and it's already in
   *  the past. Disables the Swap button + shows "expired" indicator. */
  const quoteExpired = !!(quote?.expiresAt && quote.expiresAt > 0 && Date.now() > quote.expiresAt);
  const quoteSecsLeft = quote?.expiresAt && quote.expiresAt > Date.now()
    ? Math.max(0, Math.round((quote.expiresAt - Date.now()) / 1000))
    : 0;

  // Re-render once per second so the "expires in Ns" countdown ticks.
  useEffect(() => {
    if (!quote?.expiresAt) return;
    const id = setInterval(() => setExpTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt]);

  /* Poll the bridge / DEX status with exponential backoff. The bridge SLA
     is "minutes, not seconds" — a fixed 4s loop wastes RPC budget once
     things stall. Schedule is `bridgePollBackoffMs`: 4s → 8s → 16s → 30s
     cap. On terminal states we stop the loop and surface the result. */
  useEffect(() => {
    if (!executionId) return;
    if (stage === 'completed' || stage === 'failed') return;
    let cancelled = false;
    let attempt   = 0;
    let timer:    ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const s = provider === 'ignite'
          ? await igniteGetStatus(executionId)
          : await multxGetStatus(executionId);
        if (cancelled) return;
        if (s.sourceHash) setSourceHash(s.sourceHash);
        if ('destHash' in s && s.destHash) setDestHash(s.destHash);
        if (s.state === 'completed') { setStage('completed'); return; }
        if (s.state === 'failed') {
          setStage('failed');
          // Bridge / DEX error strings are not user-facing copy — they're
          // dev shorthand (e.g. "no runners?!", "execution reverted (0x…)").
          // Surface a clean message; the raw text is still in Sentry via
          // the API client logger for triage.
          setExecError(translateSwapError(s.error));
          return;
        }
        if (s.state === 'settling')  setStage('settling');
        else if (s.state === 'bridging') setStage('bridging');
      } catch {
        /* Network blip — don't flip to failed, just keep polling. */
      }
      if (cancelled) return;
      attempt += 1;
      timer = setTimeout(tick, bridgePollBackoffMs(attempt));
    };

    // Snappy first check, then back off.
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [executionId, stage, provider]);

  /* Kick off the bridge / DEX execution. Two operating modes:
   *
   *   1. **Wallet-broadcast mode** — when the quote response includes an
   *      `unsignedTx` field, the wallet signs + broadcasts it locally via
   *      the existing signer worker (same path eth_sendTransaction goes
   *      through), then posts the resulting source-tx hash to /execute
   *      so the bridge/DEX can pick up the polling.
   *
   *   2. **Server-side mode** — when there's no `unsignedTx`, the wallet
   *      just posts `{ quoteId, signedTx: '' }` and the upstream service
   *      builds + broadcasts the source tx itself.
   *
   *  Both providers (MultX + Ignite) negotiate which mode they're in via
   *  the quote response shape, so the wallet UI doesn't need to change
   *  when the API spec lands.
   */
  const onSwap = async () => {
    if (!quote || !provider) return;
    // Refuse to execute against an expired quote — the price moved and
    // the user almost certainly wants a fresh one. The quote-fetch
    // debounce kicks back in once they retry.
    if (quoteExpired) {
      setQuoteError('Quote expired — refresh to get a new rate.');
      setQuote(null); setProvider(null);
      return;
    }
    // Dedup guards — sync ref + per-quoteId set. Bail without surfacing
    // an error: a fast double-click should be silently coalesced, not
    // shown to the user as a "swap already in progress" toast.
    if (executingRef.current) return;
    if (submittedQuotes.current.has(quote.quoteId)) return;
    executingRef.current = true;
    submittedQuotes.current.add(quote.quoteId);

    setStage('executing');
    setExecError(null);
    try {
      // Branch on whether the quote came back with an unsignedTx the
      // wallet should broadcast itself, or whether the upstream wants
      // to run the source tx server-side.
      let signedTxHash = '';
      const unsignedTx = (quote as { unsignedTx?: {
        to: string; value?: string; data?: string;
        gas?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string;
      } }).unsignedTx;

      if (unsignedTx && wallet?.seed?.length) {
        // Wallet-broadcast mode: sign locally via the signer worker
        // (same code path eth_sendTransaction takes), then forward the
        // resulting tx hash as the `signedTx` field so the bridge/DEX
        // picks it up + starts tracking.
        const { signerSignTransaction } = await import('../lib/signer-client');
        const r = await signerSignTransaction({
          to:                   unsignedTx.to,
          value:                unsignedTx.value,
          data:                 unsignedTx.data,
          gasLimit:             unsignedTx.gas,
          maxFeePerGas:         unsignedTx.maxFeePerGas,
          maxPriorityFeePerGas: unsignedTx.maxPriorityFeePerGas,
        });
        signedTxHash = r.hash;
        setSourceHash(signedTxHash);
      }

      const exec = provider === 'ignite'
        ? await igniteExecute(quote.quoteId, signedTxHash)
        : await multxExecute(quote.quoteId, signedTxHash);
      setExecutionId(exec.executionId);
      if (!signedTxHash) setSourceHash(exec.sourceHash ?? null);
      // MultX goes pending → bridging; an Ignite DEX swap is one tx so
      // pending maps straight to a short settling wait.
      setStage(exec.state === 'pending'
        ? (provider === 'ignite' ? 'settling' : 'bridging')
        : exec.state);
    } catch (e) {
      setStage('failed');
      const offline = e instanceof MultXUnavailable || e instanceof IgniteUnavailable;
      setExecError(offline
        ? `${provider === 'ignite' ? 'Ignite DEX' : 'Bridge'} is unavailable — try again in a moment.`
        : (e as Error).message || 'Swap execute failed');
      // Failed execution: let the user retry with a *fresh* quote (the
      // quote-fetch effect will produce a new quoteId), so we don't
      // leave a "stuck" entry in submittedQuotes for the next attempt.
      submittedQuotes.current.delete(quote.quoteId);
    } finally {
      executingRef.current = false;
    }
  };

  /* ─── Status panel ─── */
  if (stage !== 'compose') {
    return (
      <Modal title="Swap" onClose={onClose}>
        <div className="modal-body" style={{ padding: '8px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '12px 0' }}>
            {stage === 'completed' ? (
              <div style={{ fontSize: 28, color: 'var(--green)' }}>✓</div>
            ) : stage === 'failed' ? (
              <div style={{ fontSize: 28, color: 'var(--red)' }}>✕</div>
            ) : (
              <div style={{ width: 36, height: 36, border: '3px solid var(--border-default)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}/>
            )}
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {stage === 'executing' && 'Submitting to bridge…'}
              {stage === 'bridging'  && 'Bridging — moving funds across chains'}
              {stage === 'settling'  && 'Settling on destination chain'}
              {stage === 'completed' && 'Swap complete'}
              {stage === 'failed'    && 'Swap failed'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', maxWidth: 280 }}>
              {amt} {from} → {displayedOut.toFixed(6)} {to}
            </div>
            {sourceHash && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', wordBreak: 'break-all', maxWidth: 320 }}>
                Source: <a href={`https://makalu.litho.ai/tx/${sourceHash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>{sourceHash}</a>
              </div>
            )}
            {destHash && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Geist Mono, monospace', wordBreak: 'break-all', maxWidth: 320 }}>
                Destination: <code>{destHash}</code>
              </div>
            )}
            {execError && (
              <div style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', maxWidth: 320 }}>{execError}</div>
            )}
          </div>
          {(stage === 'completed' || stage === 'failed') && (
            <button className="btn-primary" onClick={onClose} style={{ marginTop: 8 }}>Done</button>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Swap" onClose={onClose}>
      <div className="modal-body">
        <label className="field-label">From</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: '0 0 130px' }}>
            <TokenSelect value={from} onChange={setFrom} options={TOKEN_SYMBOLS} ariaLabel="Swap from"/>
          </div>
          <input className="field-input" value={amt} onChange={e => setAmt(e.target.value)} type="number" placeholder="0.00" style={{ flex: 1 }}/>
        </div>
        <div style={{ textAlign: 'center', margin: '10px 0' }}>
          <button className="swap-btn" onClick={() => { setFrom(to); setTo(from); }}>⇅</button>
        </div>
        <label className="field-label">To</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: '0 0 130px' }}>
            <TokenSelect value={to} onChange={setTo} options={TOKEN_SYMBOLS} ariaLabel="Swap to"/>
          </div>
          <div className="field-input" style={{ flex: 1, display: 'flex', alignItems: 'center', color: 'var(--text-primary)', fontWeight: 700, fontSize: 18 }}>
            {isFinite(displayedOut) ? displayedOut.toFixed(6) : '—'}
          </div>
        </div>
        <div className="fee-row" style={{ marginTop: 14 }}>
          <span>Rate</span>
          <span>1 {from} ≈ {displayedRate.toLocaleString('en-US', { maximumFractionDigits: 6 })} {to}</span>
        </div>

        {/* Slippage tolerance — picked from a small preset list so the
            user can't fat-finger 50%. 0.5% covers most LIT pairs; raise
            to 1% for volatile cross-chain bridges. */}
        <div className="fee-row" style={{ alignItems: 'center' }}>
          <span>Slippage</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {[0.1, 0.5, 1, 2].map(s => {
              const active = slippagePct === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSlippagePct(s)}
                  style={{
                    padding: '3px 8px', fontSize: 11, fontWeight: 700,
                    borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--blue, #3b7af7)' : 'var(--border-default)'}`,
                    background: active ? 'var(--blue, #3b7af7)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-secondary)',
                  }}
                >{s}%</button>
              );
            })}
          </span>
        </div>

        <div className="fee-row">
          <span>Minimum received</span>
          <span>
            {quote
              ? `${minReceived.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${to}`
              : '—'}
          </span>
        </div>

        <div className="fee-row">
          <span>{provider === 'ignite' ? 'DEX fee' : 'Bridge fee'}</span>
          <span>{feeLine}</span>
        </div>

        {quote?.expiresAt && (
          <div className="fee-row">
            <span>Quote</span>
            <span style={{ color: quoteExpired ? 'var(--red)' : (quoteSecsLeft < 5 ? 'var(--orange, #f59e0b)' : 'var(--text-muted)') }}>
              {quoteExpired ? 'Expired — refresh to retry' : `Expires in ${quoteSecsLeft}s`}
            </span>
          </div>
        )}
        {provider && (
          <div className="fee-row">
            <span>Route</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: provider === 'ignite' ? 'var(--green)' : 'var(--blue)',
              }}/>
              {provider === 'ignite' ? 'Ignite DEX' : 'MultX bridge'}
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· best of 2</span>
            </span>
          </div>
        )}
        {(quoteError || bridgeOffline) && (
          <div style={{ fontSize: 11, color: bridgeOffline ? 'var(--text-muted)' : 'var(--red)', marginTop: 6 }}>
            {bridgeOffline ? '⚠ ' : ''}{quoteError}
          </div>
        )}
        <button
          className="btn-primary"
          style={{ marginTop: 18 }}
          disabled={!quote || bridgeOffline || quoteExpired}
          onClick={onSwap}
          title={
            bridgeOffline ? 'Bridge offline — cannot execute'
            : quoteExpired ? 'Quote expired — wait for a new rate'
            : ''
          }
        >
          {quoteExpired ? 'Quote expired'
            : quote ? `Swap ${from} → ${to}`
            : (bridgeOffline ? 'Bridge offline' : 'Fetching quote…')}
        </button>
      </div>
    </Modal>
  );
}
