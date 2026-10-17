/**
 * Thanos MultiSig's data and actions, on top of the Litho Vault SDK. The chain is the source of
 * truth: every screen reads it fresh, and the indexer (when configured) only helps find vaults
 * and pass signatures between signers.
 */
import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  toBeHex,
  zeroPadValue,
  type ContractTransactionReceipt,
  type ContractTransactionResponse,
} from 'ethers';
import {
  LithoVault,
  NATIVE_TOKEN,
  ProposalState,
  Registry,
  SignerType,
  VaultFactory,
  addSignature,
  callBuilders,
  decodeCalls,
  describeError,
  ecosystemFor,
  emptyBundle,
  isHumanSigner,
  mergeBundles,
  parseAddress,
  parseAmount,
  parseBundle,
  proposalIdFromReceipt,
  randomSalt,
  reviewDraft,
  reviewFields,
  reviewProposal,
  serializeBundle,
  approvalSigners,
  validateVaultConfig,
  verifyBundle,
  type Address,
  type Call,
  type ProposalDetails,
  type ReviewField,
  type SignatureBundle,
  type SignerInfo,
  type TokenInfo,
  type TransactionReview,
  type VaultSnapshot,
} from '@litho-vault/sdk';
import { BridgeSigner, type WalletBridge } from './bridge';
import type { MultisigNetwork } from './config';
import { SavedVaults, browserStore, defaultName, type KeyValueStore, type SavedVault } from './store';

export interface VaultSummary {
  address: Address;
  name: string;
  balance: bigint;
  threshold: bigint;
  signers: SignerInfo[];
  /** The wallet's account is one of the human signers. */
  isSigner: boolean;
  /** Open proposals the wallet's account has not approved yet. */
  needsMyApproval: number;
  readyToExecute: number;
  open: number;
  frozen: boolean;
}

export interface ProposalView {
  review: TransactionReview;
  details: ProposalDetails;
  /** The LEP100-15 review fields, in the order every platform shows them. */
  fields: ReviewField[];
  /** Off-chain approvals collected through the indexer relay that are valid right now. */
  relayed: SignatureBundle | null;
  relayedValid: number;
}

export interface TransferInput {
  /** NATIVE_TOKEN for LITHO, or a token from tokens(). */
  asset: TokenInfo;
  amount: string;
  recipient: string;
}

export interface CreateMultisigInput {
  /** Other signers' addresses (litho1… or 0x…). The wallet's account is always the first signer. */
  others: string[];
  threshold: number;
}

export interface ProposalLine {
  id: bigint;
  state: ProposalState;
  /** "Send 1.5 LITHO to litho1…", plus "and 2 more calls" for batches. */
  summary: string;
  approvals: number;
  required: number;
  /** Whether the wallet's account has approved (null: it is not a signer). */
  myApproval: boolean | null;
  createdAt: bigint;
}

export interface AssetBalance {
  token: TokenInfo;
  amount: bigint;
}

const ERC20 = ['function balanceOf(address) view returns (uint256)'];
const EXECUTED_TOPIC = new Interface(['event ProposalExecuted(uint256 indexed proposalId, address indexed executor)']).getEvent('ProposalExecuted')!.topicHash;

const OPEN_STATES: readonly ProposalState[] = [ProposalState.PENDING, ProposalState.QUEUED, ProposalState.READY];
/** Blocks per log query when scanning the factory's creation events. */
const SCAN_CHUNK = 5_000;
/** At most this many blocks per discover() call; the cursor picks up from there next time. */
const SCAN_BUDGET = 200_000;

export class MultisigClient {
  readonly provider: JsonRpcProvider;
  readonly registry: Registry;
  readonly saved: SavedVaults;
  private readonly signer: BridgeSigner | null;
  private readonly fetcher: typeof fetch;

  constructor(
    readonly network: MultisigNetwork,
    readonly bridge: WalletBridge | null,
    options: { store?: KeyValueStore; fetch?: typeof fetch } = {},
  ) {
    this.provider = new JsonRpcProvider(network.readRpcUrl, network.chain.id, { staticNetwork: true });
    this.registry = new Registry(this.provider);
    for (const token of ecosystemFor(network.chain.id).tokens) this.registry.addToken(token);
    const c = network.chain.contracts;
    if (c?.factory) this.registry.label(c.factory, 'Litho Vault factory', 'system');
    if (c?.aiGuard) this.registry.label(c.aiGuard, 'Litho Vault AI guard', 'system');
    if (c?.recoveryGuard) this.registry.label(c.recoveryGuard, 'Litho Vault recovery guard', 'system');
    if (c?.freezeGuard) this.registry.label(c.freezeGuard, 'Litho Vault freeze guard', 'system');
    this.saved = new SavedVaults(options.store ?? browserStore, network.chain.id);
    this.fetcher = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.signer = bridge ? new BridgeSigner(bridge, network.chain.id, network.sendRpcUrl, this.provider) : null;
  }

  /** Litho Vault is deployed on this network. */
  get available(): boolean {
    return this.network.factory !== null;
  }

  get account(): Address | null {
    return this.bridge ? (getAddress(this.bridge.address) as Address) : null;
  }

  /** LITHO plus the verified tokens on this chain. */
  tokens(): TokenInfo[] {
    return [NATIVE_TOKEN, ...ecosystemFor(this.network.chain.id).tokens];
  }

  vault(address: string): LithoVault {
    const v = new LithoVault(address, { provider: this.provider });
    return this.signer ? v.withSigner(this.signer) : v;
  }

  private factory(): VaultFactory {
    if (!this.network.factory) throw new Error(`Thanos MultiSig is not available on ${this.network.chain.name} yet`);
    const f = new VaultFactory(this.network.factory, this.provider);
    return this.signer ? f.withSigner(this.signer) : f;
  }

  // -------------------------------------------------------------------------------------------
  // Finding and listing multisigs
  // -------------------------------------------------------------------------------------------

  /**
   * Multisigs the account signs for: from the indexer when configured, otherwise from the
   * factory's creation events (vaults it was a first signer of; added later, add it by address).
   * Never throws: finding is best-effort, the saved list always works.
   */
  async discover(account: string): Promise<Address[]> {
    if (!this.available) return [];
    const me = getAddress(account) as Address;
    if (this.network.indexerUrl) {
      try {
        const res = await this.fetcher(`${this.network.indexerUrl}/v1/signers/${me}/vaults`, { headers: { accept: 'application/json' } });
        if (res.ok) {
          const body = (await res.json()) as { vaults?: { address?: string }[] };
          return [...new Set((body.vaults ?? []).map((v) => parseAddress(String(v.address ?? ''))).filter((a): a is Address => !!a))];
        }
      } catch {
        /* fall through to the event scan */
      }
    }
    try {
      const cursor = await this.saved.scanCursor(me);
      const latest = await this.provider.getBlockNumber();
      const from = Math.max(cursor.block + 1, this.network.deployBlock);
      const to = Math.min(latest, from + SCAN_BUDGET - 1);
      const found = new Set(cursor.found);
      if (from <= to) {
        const created = await this.factory().createdVaults(from, to, SCAN_CHUNK);
        for (const e of created) if (e.signers.some((s) => s.address === me)) found.add(e.account);
        await this.saved.setScanCursor(me, to, [...found]);
      }
      return [...found];
    } catch {
      return [];
    }
  }

  /** Saved multisigs plus the ones found for the account, with what needs attention. */
  async summaries(account: string | null): Promise<VaultSummary[]> {
    if (!this.available) return [];
    if (account) {
      const known = new Set((await this.saved.list()).map((v) => v.address));
      for (const address of await this.discover(account)) {
        if (!known.has(address) && (await this.isVault(address))) await this.saved.add(address);
      }
    }
    const saved = await this.saved.list();
    const out = await Promise.all(saved.map((v) => this.summary(v, account).catch(() => null)));
    return out.filter((s): s is VaultSummary => s !== null);
  }

  async summary(saved: SavedVault, account: string | null): Promise<VaultSummary> {
    const vault = this.vault(saved.address);
    const [snapshot, open] = await Promise.all([vault.snapshot(), vault.openProposals({ maxScan: 100 })]);
    const me = account?.toLowerCase();
    const isSigner = !!me && snapshot.signers.some((s) => s.address.toLowerCase() === me && isHumanSigner(s.type));
    return {
      address: saved.address,
      name: saved.name,
      balance: snapshot.balance,
      threshold: snapshot.threshold,
      signers: snapshot.signers,
      isSigner,
      needsMyApproval: isSigner ? open.filter((p) => p.approvals.some((a) => a.signer.toLowerCase() === me && !a.approved)).length : 0,
      readyToExecute: open.filter((p) => p.state === ProposalState.READY).length,
      open: open.length,
      frozen: snapshot.freeze.frozen,
    };
  }

  async isVault(address: string): Promise<boolean> {
    if (!this.available) return false;
    const a = parseAddress(address);
    if (!a) return false;
    try {
      return await this.factory().isAccount(a);
    } catch {
      return false;
    }
  }

  /** Adds a multisig by address after checking it is a Litho Vault from this network's factory. */
  async addExisting(address: string, name?: string): Promise<SavedVault> {
    const a = parseAddress(address);
    if (!a) throw new Error('Enter a valid address (litho1… or 0x…)');
    if (!(await this.isVault(a))) throw new Error(`No Litho Vault multisig at this address on ${this.network.chain.name}`);
    return this.saved.add(a, name);
  }

  async nameOf(address: string): Promise<string> {
    const a = parseAddress(address);
    return (await this.saved.list()).find((v) => v.address === a)?.name ?? defaultName(a ?? address);
  }

  snapshot(address: string): Promise<VaultSnapshot> {
    return this.vault(address).snapshot();
  }

  /** LITHO and every verified token the multisig holds. */
  async balances(address: string): Promise<AssetBalance[]> {
    const a = parseAddress(address);
    if (!a) throw new Error('Invalid multisig address');
    const tokens = ecosystemFor(this.network.chain.id).tokens;
    const [native, ...held] = await Promise.all([
      this.provider.getBalance(a),
      ...tokens.map((t) => new Contract(t.address, ERC20, this.provider).getFunction('balanceOf')(a).then(BigInt).catch(() => 0n)),
    ]);
    return [{ token: NATIVE_TOKEN, amount: native }, ...tokens.map((token, i) => ({ token, amount: held[i]! })).filter((b) => b.amount > 0n)];
  }

  /** The transaction that executed a proposal: recorded when this wallet sent it, else from the indexer or the chain's logs. */
  async executionTx(address: string, id: bigint): Promise<string | null> {
    const a = parseAddress(address);
    if (!a) return null;
    const local = await this.saved.executionTx(a, id);
    if (local) return local;
    if (this.network.indexerUrl) {
      try {
        const res = await this.fetcher(`${this.network.indexerUrl}/v1/vaults/${a}/proposals/${id}`);
        if (res.ok) {
          const tx = ((await res.json()) as { proposal?: { executed_tx?: string } }).proposal?.executed_tx;
          if (tx && /^0x[0-9a-fA-F]{64}$/.test(tx)) return tx;
        }
      } catch {
        /* try the chain */
      }
    }
    try {
      const logs = await this.provider.getLogs({ address: a, topics: [EXECUTED_TOPIC, zeroPadValue(toBeHex(id), 32)], fromBlock: this.network.deployBlock, toBlock: 'latest' });
      return logs[0]?.transactionHash ?? null;
    } catch {
      return null;
    }
  }

  /** Open proposals and recent closed ones as one-line summaries, newest first. */
  async proposalLines(address: string, recent = 10): Promise<{ open: ProposalLine[]; closed: ProposalLine[] }> {
    const { open, closed } = await this.proposals(address, recent);
    const me = this.account?.toLowerCase();
    const line = async (d: ProposalDetails): Promise<ProposalLine> => {
      const decoded = await decodeCalls(d.calls, { vault: getAddress(address) as Address, registry: this.registry, chainId: this.network.chain.id }).catch(() => []);
      const first = decoded[0]?.summary ?? `${d.calls.length} call${d.calls.length === 1 ? '' : 's'}`;
      const more = decoded.length > 1 ? ` and ${decoded.length - 1} more call${decoded.length === 2 ? '' : 's'}` : '';
      const mine = d.approvals.find((a) => a.signer.toLowerCase() === me);
      return {
        id: d.proposal.id,
        state: d.state,
        summary: `${first}${more}`,
        approvals: Number(d.status.humanApprovals + d.status.agentApprovals),
        required: Number(d.status.requiredApprovals),
        myApproval: mine ? mine.approved : null,
        createdAt: d.proposal.createdAt,
      };
    };
    return { open: await Promise.all(open.map(line)), closed: await Promise.all(closed.map(line)) };
  }

  /** Open proposals and the most recent closed ones, newest first. */
  async proposals(address: string, recent = 10): Promise<{ open: ProposalDetails[]; closed: ProposalDetails[] }> {
    const vault = this.vault(address);
    const [open, latest] = await Promise.all([vault.openProposals(), vault.listProposals({ limit: recent + 10 })]);
    const openIds = new Set(open.map((p) => p.proposal.id));
    return { open, closed: latest.filter((p) => !openIds.has(p.proposal.id) && !OPEN_STATES.includes(p.state)).slice(0, recent) };
  }

  // -------------------------------------------------------------------------------------------
  // Reviewing
  // -------------------------------------------------------------------------------------------

  async proposal(address: string, id: bigint): Promise<ProposalView> {
    const vault = this.vault(address);
    const snapshot = await vault.snapshot();
    const { review, details } = await reviewProposal(vault, id, { registry: this.registry, from: this.account ?? undefined, snapshot });
    const relayed = await this.relayedSignatures(snapshot, details).catch(() => null);
    let relayedValid = 0;
    if (relayed) {
      const check = await verifyBundle(this.provider, relayed, this.identity(snapshot, details), approvalSigners(snapshot.signers));
      relayedValid = check.valid.filter((s) => !details.approvals.find((a) => a.signer === s.signer)?.approved).length;
    }
    return { review, details, fields: reviewFields(review), relayed, relayedValid };
  }

  /** The calls for sending LITHO or a token from the multisig. */
  transferCalls(input: TransferInput): Call[] {
    const recipient = parseAddress(input.recipient);
    if (!recipient) throw new Error('Enter a valid recipient (litho1… or 0x…)');
    const amount = parseAmount(input.amount, input.asset.decimals);
    if (amount <= 0n) throw new Error('Enter an amount above zero');
    return [input.asset.address === NATIVE_TOKEN.address ? callBuilders.native(recipient, amount) : callBuilders.tokenTransfer(input.asset.address, recipient, amount)];
  }

  async reviewDraft(address: string, calls: readonly Call[]): Promise<{ review: TransactionReview; fields: ReviewField[] }> {
    const review = await reviewDraft(this.vault(address), calls, { registry: this.registry, from: this.account ?? undefined });
    return { review, fields: reviewFields(review) };
  }

  // -------------------------------------------------------------------------------------------
  // Acting (each waits for the transaction to be mined and throws a readable error if it fails)
  // -------------------------------------------------------------------------------------------

  private async mined(send: Promise<ContractTransactionResponse>): Promise<ContractTransactionReceipt> {
    let receipt: ContractTransactionReceipt | null;
    try {
      receipt = await (await send).wait();
    } catch (e) {
      throw new Error(describeError(e));
    }
    if (!receipt || receipt.status !== 1) throw new Error('The transaction failed on chain');
    return receipt;
  }

  /** Proposes the calls (the proposer's approval is recorded with it). Returns the new proposal's ID. */
  async propose(address: string, calls: readonly Call[]): Promise<{ id: bigint; hash: string }> {
    const receipt = await this.mined(this.vault(address).propose(calls));
    return { id: proposalIdFromReceipt(receipt), hash: receipt.hash };
  }

  async approve(address: string, id: bigint): Promise<string> {
    return (await this.mined(this.vault(address).approve(id))).hash;
  }

  async revoke(address: string, id: bigint): Promise<string> {
    return (await this.mined(this.vault(address).revoke(id))).hash;
  }

  /** Executes a ready proposal; with relayed off-chain approvals when the on-chain ones are not enough. */
  async execute(address: string, id: bigint, view?: ProposalView): Promise<string> {
    const vault = this.vault(address);
    if (view && view.details.state !== ProposalState.READY && view.relayed && view.relayedValid > 0) {
      const snapshot = await vault.snapshot();
      const check = await verifyBundle(this.provider, view.relayed, this.identity(snapshot, view.details), approvalSigners(snapshot.signers));
      const hash = (await this.mined(vault.executeWithSignatures(id, check.valid))).hash;
      await this.saved.setExecutionTx(vault.address, id, hash);
      return hash;
    }
    const hash = (await this.mined(vault.execute(id))).hash;
    await this.saved.setExecutionTx(vault.address, id, hash);
    return hash;
  }

  /** Cancels a proposal; only its proposer can do this directly. */
  async cancel(address: string, id: bigint): Promise<string> {
    return (await this.mined(this.vault(address).cancel(id))).hash;
  }

  /**
   * Approves without gas: signs the approval (EIP-712) and shares it through the indexer relay,
   * where the other signers' wallets pick it up. Needs an indexer.
   */
  async signAndShare(address: string, id: bigint): Promise<void> {
    if (!this.network.indexerUrl) throw new Error('Approving without gas needs the MultiSig indexer');
    const vault = this.vault(address);
    const [snapshot, details, signature] = await Promise.all([vault.snapshot(), vault.proposalDetails(id), vault.signApproval(id)]);
    const bundle = addSignature(emptyBundle(this.identity(snapshot, details)), signature);
    const res = await this.fetcher(`${this.network.indexerUrl}/v1/signatures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serializeBundle(bundle),
    });
    if (!res.ok) throw new Error(`The indexer did not accept the signature (${res.status})`);
  }

  private identity(snapshot: VaultSnapshot, details: ProposalDetails) {
    return { chainId: snapshot.chainId, vault: snapshot.address, proposalId: details.proposal.id, configEpoch: details.proposal.configEpoch, digest: details.digest };
  }

  private async relayedSignatures(snapshot: VaultSnapshot, details: ProposalDetails): Promise<SignatureBundle | null> {
    if (!this.network.indexerUrl || !OPEN_STATES.includes(details.state)) return null;
    const res = await this.fetcher(`${this.network.indexerUrl}/v1/vaults/${snapshot.address}/proposals/${details.proposal.id}/signatures`);
    if (!res.ok) return null;
    return mergeBundles(emptyBundle(this.identity(snapshot, details)), parseBundle(await res.text()));
  }

  // -------------------------------------------------------------------------------------------
  // Creating
  // -------------------------------------------------------------------------------------------

  /** The signer list and settings a new multisig gets, with any problems in them. */
  draftMultisig(input: CreateMultisigInput): { config: { signers: SignerInfo[]; threshold: bigint; minHumanApprovals: bigint; salt: `0x${string}` }; errors: string[] } {
    const me = this.account;
    const signers: SignerInfo[] = [];
    const errors: string[] = [];
    if (me) signers.push({ address: me, type: SignerType.KEY });
    for (const raw of input.others.map((o) => o.trim()).filter(Boolean)) {
      const a = parseAddress(raw);
      if (!a) {
        errors.push(`${raw} is not a valid address`);
        continue;
      }
      signers.push({ address: a, type: SignerType.KEY });
    }
    const config = { signers, threshold: BigInt(input.threshold), minHumanApprovals: BigInt(Math.max(1, input.threshold)), salt: randomSalt() as `0x${string}` };
    return { config, errors: [...errors, ...validateVaultConfig(config)] };
  }

  async predictAddress(config: ReturnType<MultisigClient['draftMultisig']>['config']): Promise<Address> {
    if (!this.account) throw new Error('Unlock the wallet first');
    return this.factory().predictAddress(this.account, config);
  }

  /** Deploys the multisig and adds it to the list under `name`. */
  async create(config: ReturnType<MultisigClient['draftMultisig']>['config'], name: string): Promise<{ address: Address; hash: string }> {
    const receipt = await this.mined(this.factory().create(config));
    const created = VaultFactory.createdFromReceipt(receipt);
    await this.saved.add(created.account, name);
    return { address: created.account, hash: receipt.hash };
  }
}

export { describeError };
