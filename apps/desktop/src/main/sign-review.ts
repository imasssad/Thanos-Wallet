/**
 * Signing-request review — main-process twin of
 * packages/sdk-core/src/security/sign-review.ts (see that file for the full
 * rationale). The main process is compiled on its own (rootDir src/main,
 * CommonJS) and can't load the workspace package's TypeScript source, so it
 * carries this copy for the in-app browser's approval dialog. Keep the two
 * identical below this header — packages/sdk-core/src/__tests__/
 * sign-review.test.ts runs its whole suite against both.
 */
import { formatEther, getAddress, Interface, isHexString, toUtf8String } from 'ethers';

export type SignRisk = 'safe' | 'caution' | 'review' | 'block';

export interface SignReviewRow {
  label: string;
  value: string;
  tone?: 'danger' | 'warn';
}

export interface SignReview {
  /** Plain-language headline for the sheet. */
  title: string;
  /** Decoded details, in display order. */
  rows: SignReviewRow[];
  /** What to be careful about, most severe first. */
  warnings: string[];
  risk: SignRisk;
  /** Set when risk is 'block': why the wallet won't sign this. */
  blockReason: string | null;
  /** Set when the request is for a chain other than the one the wallet is
   *  on: the chain it needs. It stays blocked on the current chain; a sheet
   *  can offer to switch the wallet to this chain and review it again. */
  requiredChainId?: number;
}

export interface SignReviewInput {
  /** JSON-RPC method, e.g. eth_signTypedData_v4. */
  method: string;
  /** The request's params array, as the dApp sent it. */
  params: unknown;
  /** The chain the wallet signs for / broadcasts on, if known. */
  activeChainId?: number;
  /** The wallet account the request will be signed with, if known. */
  account?: string;
}

/* ── Known-bad addresses (drainer post-mortems; lower-case) ─────────── */
const SCAM_ADDRESSES: ReadonlySet<string> = new Set([
  '0x000000000035b5e5ad9019092c665357240f594e',
  '0x412f10aad96fd78da6736387e2c84931ac20313f',
  '0xdead000000000000000000000000000000000000',
]);

export function isKnownScamAddress(address: string): boolean {
  return SCAM_ADDRESSES.has(String(address).trim().toLowerCase());
}

/** Send-screen check for a resolved EVM recipient: the zero address (burns
 *  the funds) or a known scam address. A reason string means: don't send. */
export function checkRecipient(address: string): string | null {
  const a = String(address ?? '').trim().toLowerCase();
  if (a === '0x0000000000000000000000000000000000000000') {
    return 'That is the zero address — anything sent there is destroyed for good.';
  }
  if (isKnownScamAddress(a)) return 'That address is on the wallet\'s scam-address list.';
  return null;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const RANK: Record<SignRisk, number> = { safe: 0, caution: 1, review: 2, block: 3 };

class Review {
  rows: SignReviewRow[] = [];
  warnings: string[] = [];
  risk: SignRisk = 'safe';
  blockReason: string | null = null;
  requiredChainId: number | undefined = undefined;
  constructor(public title: string) {}
  row(label: string, value: string, tone?: SignReviewRow['tone']) { this.rows.push(tone ? { label, value, tone } : { label, value }); }
  warn(text: string, risk: SignRisk) {
    this.warnings.push(text);
    if (RANK[risk] > RANK[this.risk]) this.risk = risk;
  }
  block(reason: string) {
    if (!this.blockReason) this.blockReason = reason;
    this.warnings.unshift(reason);
    this.risk = 'block';
  }
  done(): SignReview {
    return {
      title: this.title, rows: this.rows, warnings: this.warnings, risk: this.risk, blockReason: this.blockReason,
      ...(this.requiredChainId !== undefined ? { requiredChainId: this.requiredChainId } : {}),
    };
  }
}

/* ── small formatters ─────────────────────────────────────────────── */

function toBig(v: unknown): bigint | null {
  try {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? BigInt(v) : null;
    if (typeof v === 'string' && v.trim() !== '') return BigInt(v.trim());
  } catch { /* not an integer */ }
  return null;
}

function addr(v: unknown): string {
  if (typeof v !== 'string') return String(v ?? '—');
  try { return getAddress(v); } catch { return v; }
}

function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function groupDigits(n: bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Base-unit amount, or "Unlimited" at/above `unlimitedAt`. */
function amount(v: unknown, unlimitedAt: bigint): { text: string; unlimited: boolean } {
  const n = toBig(v);
  if (n === null) return { text: String(v ?? '—'), unlimited: false };
  if (n >= unlimitedAt) return { text: 'Unlimited', unlimited: true };
  return { text: `${groupDigits(n)} (base units)`, unlimited: false };
}

const UNLIMITED_256 = 1n << 240n;
const UNLIMITED_160 = 1n << 150n;

/** Unix seconds → date text. `zeroMeans` says what 0 means for this field. */
function when(v: unknown, zeroMeans: string): string {
  const n = toBig(v);
  if (n === null) return String(v ?? '—');
  if (n === 0n) return zeroMeans;
  if (n >= 100_000_000_000n) return 'Never';
  return new Date(Number(n) * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

/** null = absent; NaN = present but unreadable. Decimal or 0x-hex. */
function parseChainId(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = toBig(v);
  return n === null ? Number.NaN : Number(n);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function checkParty(r: Review, label: string, v: unknown) {
  const a = addr(v);
  const scam = typeof v === 'string' && isKnownScamAddress(v);
  r.row(label, a, scam ? 'danger' : undefined);
  if (scam) r.block(`${label} ${a} is on the wallet's scam-address list.`);
}

/* ── entry point ──────────────────────────────────────────────────── */

export function reviewSigningRequest(input: SignReviewInput): SignReview {
  const params = Array.isArray(input.params) ? (input.params as unknown[]) : [input.params];
  switch (input.method) {
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData_v3':
    case 'eth_signTypedData':
      return reviewTypedData(params, input);
    case 'eth_sendTransaction':
    case 'eth_signTransaction':
      return reviewTransaction(params[0], input);
    case 'personal_sign':
      return reviewMessage(params[0], params[1], input, false);
    case 'eth_sign':
      return reviewMessage(params[1], params[0], input, true);
    default:
      return new Review(input.method).done();
  }
}

/* ── messages ─────────────────────────────────────────────────────── */

function reviewMessage(raw: unknown, forAccount: unknown, input: SignReviewInput, legacy: boolean): SignReview {
  const r = new Review('Sign a message');
  accountCheck(r, forAccount, input.account);
  let text = typeof raw === 'string' ? raw : String(raw ?? '');
  let opaque = false;
  if (isHexString(text)) {
    if (text.length === 66) opaque = true;
    else {
      try {
        const decoded = toUtf8String(text);
        // Control characters (or U+FFFD from bytes that aren't UTF-8) mean the
        // hex was binary, not text — the match is the point of this regex.
        // eslint-disable-next-line no-control-regex
        if (!/[\u0000-\u0008\u000e-\u001f�]/.test(decoded)) text = decoded; else opaque = true;
      } catch { opaque = true; }
    }
  }
  r.row('Message', text.length > 600 ? `${text.slice(0, 600)}…` : text);
  if (legacy) r.warn('eth_sign is a legacy method; modern dApps use personal_sign. Only continue if you expected this.', 'review');
  if (opaque) r.warn('This is an unreadable value (a hash or binary), not text. Only sign it if you know exactly what it authorises.', 'review');
  return r.done();
}

function accountCheck(r: Review, requested: unknown, account: string | undefined) {
  if (!account || typeof requested !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(requested)) return;
  if (!sameAddress(requested, account)) {
    r.block(`The request is for account ${addr(requested)}, not the one this wallet is using (${addr(account)}).`);
  }
}

/* ── EIP-712 ──────────────────────────────────────────────────────── */

interface Typed {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

function parseTyped(raw: unknown): Typed | null {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  const o = obj(v);
  if (!o) return null;
  const domain = obj(o.domain), types = obj(o.types), message = obj(o.message);
  if (!domain || !types || !message || typeof o.primaryType !== 'string') return null;
  return { domain, types, primaryType: o.primaryType, message };
}

function reviewTypedData(params: unknown[], input: SignReviewInput): SignReview {
  // v3/v4: [account, typedData]; some dApps swap them.
  const [a, b] = params;
  const typed = parseTyped(b) ?? parseTyped(a);
  const forAccount = parseTyped(b) ? a : b;
  if (!typed) {
    const r = new Review('Sign typed data');
    r.block('The typed data in this request is malformed, so the wallet cannot show what it would sign.');
    return r.done();
  }
  const r = new Review('Sign typed data');
  accountCheck(r, forAccount, input.account);

  const d = typed.domain;
  const chainId = parseChainId(d.chainId);
  if (chainId !== null && Number.isNaN(chainId)) {
    r.block('The signature\'s chainId is unreadable.');
  } else if (chainId !== null && input.activeChainId !== undefined && chainId !== input.activeChainId) {
    r.block(`This signature is for chain ${chainId}, but the wallet is on chain ${input.activeChainId}. A signature for another chain can be used there, so switch the wallet to chain ${chainId} to sign it.`);
    r.requiredChainId = chainId;
  }

  const pt = typed.primaryType;
  const m = typed.message;
  if (pt === 'Permit' && 'spender' in m && 'value' in m) permit2612(r, typed);
  else if (pt === 'Permit' && 'spender' in m && 'allowed' in m) permitDai(r, typed);
  else if (pt === 'PermitSingle' || pt === 'PermitBatch') permit2Allowance(r, typed);
  else if (/^Permit(Batch)?(Witness)?TransferFrom$/.test(pt)) permit2Transfer(r, typed);
  else if (pt === 'OrderComponents' || pt === 'BulkOrder') seaport(r, typed, input.account);
  else generic(r, typed);

  if (chainId === null && r.risk !== 'safe') {
    r.warn('The signature names no chain, so it is valid on every chain.', 'caution');
  }
  if (typeof d.name === 'string' || typeof d.verifyingContract === 'string') {
    r.row('Signed for', [typeof d.name === 'string' ? d.name : null, typeof d.verifyingContract === 'string' ? addr(d.verifyingContract) : null].filter(Boolean).join(' · '));
  }
  if (chainId !== null && !Number.isNaN(chainId)) r.row('Chain', String(chainId));
  return r.done();
}

function permit2612(r: Review, t: Typed) {
  const m = t.message;
  const amt = amount(m.value, UNLIMITED_256);
  r.title = `Permit: let ${addr(m.spender)} spend your ${tokenName(t)}`;
  r.row('Token', tokenLabel(t));
  checkParty(r, 'Spender', m.spender);
  r.row('Amount', amt.text, amt.unlimited ? 'danger' : undefined);
  r.row('Valid until', when(m.deadline, 'Already expired'));
  approvalWarning(r, amt.unlimited);
}

function permitDai(r: Review, t: Typed) {
  const m = t.message;
  const allowed = m.allowed === true || m.allowed === 'true';
  r.title = allowed ? `Permit: let ${addr(m.spender)} spend all your ${tokenName(t)}` : `Permit: revoke ${addr(m.spender)}`;
  r.row('Token', tokenLabel(t));
  checkParty(r, 'Spender', m.spender);
  r.row('Amount', allowed ? 'Unlimited' : 'None (revoke)', allowed ? 'danger' : undefined);
  r.row('Valid until', when(m.expiry, 'Never'));
  if (allowed) approvalWarning(r, true);
}

function permit2Allowance(r: Review, t: Typed) {
  const m = t.message;
  const details = Array.isArray(m.details) ? m.details : [m.details];
  r.title = `Permit2: let ${addr(m.spender)} spend your tokens`;
  checkParty(r, 'Spender', m.spender);
  let unlimited = false;
  details.forEach((raw, i) => {
    const det = obj(raw) ?? {};
    const amt = amount(det.amount, UNLIMITED_160);
    unlimited = unlimited || amt.unlimited;
    const n = details.length > 1 ? ` ${i + 1}` : '';
    checkParty(r, `Token${n}`, det.token);
    r.row(`Amount${n}`, amt.text, amt.unlimited ? 'danger' : undefined);
    r.row(`Allowance expires${n}`, when(det.expiration, 'End of the block it is used in'));
  });
  r.row('Signature valid until', when(m.sigDeadline, 'Already expired'));
  approvalWarning(r, unlimited);
}

function permit2Transfer(r: Review, t: Typed) {
  const m = t.message;
  const permitted = Array.isArray(m.permitted) ? m.permitted : [m.permitted];
  r.title = `Permit2: let ${addr(m.spender)} take tokens from your wallet`;
  checkParty(r, 'Spender', m.spender);
  permitted.forEach((raw, i) => {
    const p = obj(raw) ?? {};
    const amt = amount(p.amount, UNLIMITED_256);
    const n = permitted.length > 1 ? ` ${i + 1}` : '';
    checkParty(r, `Token${n}`, p.token);
    r.row(`Amount${n}`, amt.text, amt.unlimited ? 'danger' : undefined);
  });
  r.row('Valid until', when(m.deadline, 'Already expired'));
  if ('witness' in m) r.row('Also signs', 'an order attached to this transfer (witness)');
  r.warn('Signing lets the spender move these tokens out of your wallet in one step, with no further prompt.', 'review');
}

function approvalWarning(r: Review, unlimited: boolean) {
  r.warn(
    unlimited
      ? 'This grants an UNLIMITED allowance. The spender can take all of this token, now or later, without asking again; nothing appears on-chain until they use it.'
      : 'Signing lets the spender move this token without asking again; nothing appears on-chain until they use it.',
    unlimited ? 'review' : 'caution',
  );
}

function tokenName(t: Typed): string {
  return typeof t.domain.name === 'string' && t.domain.name ? t.domain.name : 'tokens';
}
function tokenLabel(t: Typed): string {
  const c = typeof t.domain.verifyingContract === 'string' ? addr(t.domain.verifyingContract) : null;
  return [typeof t.domain.name === 'string' ? t.domain.name : null, c].filter(Boolean).join(' · ') || '—';
}

/* Seaport: what the offerer gives (offer) and what goes back to them. */
const SEAPORT_ITEM = ['native coin', 'ERC-20', 'NFT (ERC-721)', 'NFT (ERC-1155)', 'NFT (ERC-721, any matching)', 'NFT (ERC-1155, any matching)'];

function seaportItem(raw: unknown): string {
  const it = obj(raw) ?? {};
  const kind = SEAPORT_ITEM[Number(it.itemType)] ?? `item type ${String(it.itemType)}`;
  const amt = toBig(it.startAmount ?? it.endAmount);
  const token = typeof it.token === 'string' && !sameAddress(it.token, ZERO_ADDRESS) ? ` ${addr(it.token)}` : '';
  const id = Number(it.itemType) >= 2 && it.identifierOrCriteria !== undefined ? ` #${String(it.identifierOrCriteria)}` : '';
  const qty = amt !== null && !(Number(it.itemType) === 2) ? ` × ${groupDigits(amt)}` : '';
  return `${kind}${token}${id}${qty}`;
}

function seaport(r: Review, t: Typed, account: string | undefined) {
  const orders: Record<string, unknown>[] = [];
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else { const o = obj(v); if (o && Array.isArray(o.offer)) orders.push(o); }
  };
  if (t.primaryType === 'BulkOrder') collect(t.message.tree); else orders.push(t.message);
  r.title = orders.length > 1 ? `Seaport: sign ${orders.length} orders` : 'Seaport: sign an order';
  if (!orders.length) { r.block('This Seaport bulk order contains no readable orders.'); return; }
  orders.forEach((o, i) => {
    const n = orders.length > 1 ? ` (order ${i + 1})` : '';
    const offerer = o.offerer;
    const give = (o.offer as unknown[]).map(seaportItem);
    const consideration = Array.isArray(o.consideration) ? (o.consideration as unknown[]) : [];
    const back = consideration.filter((c) => sameAddress(obj(c)?.recipient, offerer));
    const others = consideration.filter((c) => !sameAddress(obj(c)?.recipient, offerer));
    r.row(`You give${n}`, give.join('; ') || 'nothing');
    r.row(`You get${n}`, back.map(seaportItem).join('; ') || 'NOTHING', back.length ? undefined : 'danger');
    others.forEach((c) => checkParty(r, `Also paid to${n}`, obj(c)?.recipient));
    if (account && typeof offerer === 'string' && !sameAddress(offerer, account)) {
      r.warn(`The order's offerer is ${addr(offerer)}, not your account.`, 'review');
    }
    const paysNothing = back.every((c) => (toBig(obj(c)?.startAmount) ?? 0n) === 0n && (toBig(obj(c)?.endAmount) ?? 0n) === 0n);
    if (give.length && paysNothing) {
      r.block('This order gives your assets away and pays you nothing — the classic NFT-drainer "listing".');
    }
  });
  r.warn('A signed Seaport order can be filled by anyone until it expires or is cancelled on-chain.', 'caution');
}

function generic(r: Review, t: Typed) {
  r.title = `Sign ${t.primaryType}`;
  const flat = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'string') return /^0x[0-9a-fA-F]{40}$/.test(v) ? addr(v) : v.length > 140 ? `${v.slice(0, 140)}…` : v;
    if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
    const s = JSON.stringify(v);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  };
  for (const [k, v] of Object.entries(t.message).slice(0, 12)) {
    if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) checkParty(r, k, v);
    else r.row(k, flat(v));
  }
  const keys = Object.keys(t.message).map((k) => k.toLowerCase());
  if (keys.some((k) => ['spender', 'operator', 'approved', 'allowance', 'delegate', 'delegatee'].includes(k))) {
    r.warn('The data names a spender / operator / delegate. Make sure you meant to give that address rights.', 'caution');
  }
}

/* ── transactions ─────────────────────────────────────────────────── */

const TX_ABI = new Interface([
  'function approve(address spender, uint256 amount)',
  'function increaseAllowance(address spender, uint256 addedValue)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
]);
const PERMIT2_ABI = new Interface(['function approve(address token, address spender, uint160 amount, uint48 expiration)']);
const PERMIT2_APPROVE = PERMIT2_ABI.getFunction('approve')!.selector;

function reviewTransaction(raw: unknown, input: SignReviewInput): SignReview {
  const tx = obj(raw) ?? {};
  const r = new Review('Send a transaction');
  accountCheck(r, tx.from, input.account);
  const txChain = parseChainId(tx.chainId);
  if (txChain !== null && !Number.isNaN(txChain) && input.activeChainId !== undefined && txChain !== input.activeChainId) {
    r.block(`The dApp built this transaction for chain ${txChain}, but the wallet is on chain ${input.activeChainId}.`);
    r.requiredChainId = txChain;
  }
  const to = tx.to;
  const data = typeof tx.data === 'string' ? tx.data : typeof tx.input === 'string' ? tx.input : '0x';
  const value = toBig(tx.value) ?? 0n;

  if (typeof to !== 'string' || !to) {
    r.title = 'Deploy a contract';
    r.warn('This creates a new contract from your account.', 'review');
  } else {
    checkParty(r, data.length > 2 ? 'Contract' : 'To', to);
  }
  if (value > 0n) r.row('Value', `${formatEther(value)} (native coin)`);

  if (data.length > 2) {
    const selector = data.slice(0, 10).toLowerCase();
    let call: ReturnType<Interface['parseTransaction']> = null;
    try { call = selector === PERMIT2_APPROVE ? PERMIT2_ABI.parseTransaction({ data }) : TX_ABI.parseTransaction({ data }); } catch { call = null; }
    if (!call) {
      r.row('Function', `unrecognised (${selector})`);
      r.warn('This calls a contract function the wallet can\'t decode. Only continue if you trust the dApp.', 'caution');
    } else {
      decodeCall(r, call.name, call.args, selector === PERMIT2_APPROVE, input.account);
    }
  } else if (typeof to === 'string') {
    r.title = value > 0n ? `Send ${formatEther(value)} to ${addr(to)}` : `Send a transaction to ${addr(to)}`;
  }
  if (value > 0n && data.length > 2) r.warn('This sends coins AND calls a contract. Check the value.', 'caution');
  return r.done();
}

function decodeCall(r: Review, name: string, args: ReadonlyArray<unknown>, permit2: boolean, account: string | undefined) {
  r.row('Function', permit2 ? 'Permit2 approve' : name);
  if (permit2) {
    const [token, spender, amt, expiration] = args;
    const a = amount(amt, UNLIMITED_160);
    r.title = `Permit2: let ${addr(spender)} spend your tokens`;
    checkParty(r, 'Token', token);
    checkParty(r, 'Spender', spender);
    r.row('Amount', a.text, a.unlimited ? 'danger' : undefined);
    r.row('Allowance expires', when(expiration, 'End of the block it is used in'));
    approvalWarning(r, a.unlimited);
    return;
  }
  switch (name) {
    case 'approve':
    case 'increaseAllowance': {
      const [spender, amt] = args;
      const a = amount(amt, UNLIMITED_256);
      const revoke = toBig(amt) === 0n && name === 'approve';
      r.title = revoke ? `Revoke ${addr(spender)}'s allowance` : `Approve ${addr(spender)} to spend this token`;
      checkParty(r, 'Spender', spender);
      r.row('Amount', revoke ? '0 (revoke)' : a.text, a.unlimited ? 'danger' : undefined);
      if (!revoke) approvalWarning(r, a.unlimited);
      return;
    }
    case 'setApprovalForAll': {
      const [operator, approved] = args;
      checkParty(r, 'Operator', operator);
      if (approved === true) {
        r.title = `Give ${addr(operator)} control of ALL your NFTs in this collection`;
        r.row('Access', 'Every NFT in the collection, now and later', 'danger');
        r.warn('setApprovalForAll lets the operator transfer every NFT you hold in this collection, without asking again.', 'review');
      } else {
        r.title = `Revoke ${addr(operator)}'s access to this collection`;
      }
      return;
    }
    case 'transfer': {
      const [to, amt] = args;
      r.title = `Transfer tokens to ${addr(to)}`;
      checkParty(r, 'Recipient', to);
      r.row('Amount', amount(amt, UNLIMITED_256).text);
      r.warn('The dApp is asking to send your tokens. Check the recipient.', 'caution');
      return;
    }
    case 'transferFrom':
    case 'safeTransferFrom': {
      const [from, to, v] = args;
      r.title = `Transfer from ${addr(from)} to ${addr(to)}`;
      checkParty(r, 'From', from);
      checkParty(r, 'Recipient', to);
      // transferFrom shares its selector between ERC-20 (amount) and ERC-721 (token ID).
      r.row(name === 'safeTransferFrom' ? 'Token ID' : 'Amount / token ID', name === 'safeTransferFrom' ? String(v) : amount(v, UNLIMITED_256).text);
      r.warn(account && sameAddress(from, account)
        ? 'This moves your asset to the recipient. Check it.'
        : 'This moves an asset from another address. Make sure you expected it.', 'caution');
      return;
    }
    default:
      r.warn('Contract call. Only continue if you trust the dApp.', 'caution');
  }
}
