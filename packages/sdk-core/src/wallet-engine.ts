import { createStore } from 'zustand/vanilla';
import {
  evmToLitho,
  lithoToEvm,
  normaliseLithoAddress,
  detectAddressFormat,
  validateAddressForChain,
  formatAddressForChain
} from './utils/litho-address';
import { createMnemonic, deriveSolanaKeypair, walletFromMnemonic } from './utils/mnemonic';
import type {
  BitcoinSendRequest,
  IntentRequest,
  SendAssetRequest,
  SolanaSendRequest,
  TokenImportRequest,
  WalletAccount,
  WalletState
} from './types';
import type { SecureStore } from './storage/memory-store';
import { MemorySecureStore } from './storage/memory-store';
import { EvmClient } from './clients/evm-client';
import { LithicClient } from './clients/lithic-client';
import { Lep100Client } from './clients/lep100-client';
import { BitcoinClient } from './clients/bitcoin-client';
import { SolanaClient } from './clients/solana-client';
import { TransactionSimulator } from './security/simulator';
import { MultXClient } from './swaps/multx';
import { createIgniteClient, type IgniteClient } from './dex/ignite';
import { inspectWebsite } from './security/phishing';
import { BITCOIN_MAINNET, MAKALU_TESTNET, SOLANA_MAINNET } from './chains/networks';
import { TokenImporter } from './imports/token-importer';
import { IndexerClient } from './portfolio/indexer-client';
import { WalletConnectBridge } from './walletconnect/client';
import { DnnsService } from './dnns/service';
import { BridgeTracker } from './bridge/status';

export class WalletEngine {
  readonly store = createStore<WalletState>(() => ({ accounts: [], activeChainId: MAKALU_TESTNET.chainId }));
  readonly evm = new EvmClient();
  readonly lithic = new LithicClient();
  readonly lep100 = new Lep100Client(this.lithic);
  readonly bitcoin = new BitcoinClient();
  readonly solana = new SolanaClient();
  readonly simulator = new TransactionSimulator(this.evm, this.lithic);
  readonly multx = new MultXClient();
  /** Same-chain DEX. Defaults to live (https://ignite.litho.ai) — any
   *  parse/network failure throws IgniteUnavailable, which the SwapModal
   *  catches and falls back to MultX, so a half-matched API spec degrades
   *  gracefully rather than blowing up. Force the mock client (e.g. in
   *  CI or local dev with no network) by setting THANOS_IGNITE=mock. */
  readonly ignite: IgniteClient = createIgniteClient({
    kind: (typeof process !== 'undefined' && process.env?.THANOS_IGNITE === 'mock')
      ? 'mock'
      : 'live',
    live: {
      baseUrl: (typeof process !== 'undefined' &&
        (process.env?.IGNITE_API_URL || process.env?.NEXT_PUBLIC_IGNITE_API_URL)) || undefined,
    },
  });
  readonly tokenImporter = new TokenImporter();
  readonly indexer = new IndexerClient();
  readonly walletConnect = new WalletConnectBridge();
  readonly dnns = new DnnsService(this.lithic);
  readonly bridgeTracker = new BridgeTracker();

  constructor(private readonly secureStore: SecureStore = new MemorySecureStore()) {}

  private deriveAccounts(mnemonic: string): WalletAccount[] {
    const evm = walletFromMnemonic(mnemonic, 0);
    const btc = this.bitcoin.deriveAccount(mnemonic, 0, 'bitcoin-mainnet');
    const sol = deriveSolanaKeypair(mnemonic, 0);

    return [
      {
        curve: 'secp256k1',
        networkId: MAKALU_TESTNET.id,
        chainId: MAKALU_TESTNET.chainId,
        address: evm.address,
        name: 'Lithosphere Account',
        derivationPath: evm.path ?? "m/44'/60'/0'/0/0",
        publicKey: evm.publicKey
      },
      {
        curve: 'secp256k1',
        networkId: BITCOIN_MAINNET.id,
        chainId: BITCOIN_MAINNET.chainId,
        address: btc.address,
        name: 'Bitcoin Account',
        derivationPath: btc.derivationPath,
        publicKey: btc.publicKey
      },
      {
        curve: 'ed25519',
        networkId: SOLANA_MAINNET.id,
        chainId: SOLANA_MAINNET.chainId,
        address: sol.publicKey,
        name: 'Solana Account',
        derivationPath: sol.derivationPath,
        publicKey: sol.publicKey
      }
    ];
  }

  async bootstrap(): Promise<WalletState> {
    const mnemonic = await this.secureStore.get('mnemonic');
    if (!mnemonic) return this.store.getState();
    const accounts = this.deriveAccounts(mnemonic);
    const state: WalletState = {
      mnemonic,
      accounts,
      activeAccount: accounts[0],
      activeChainId: MAKALU_TESTNET.chainId,
      initializedAt: new Date().toISOString(),
      importedTokens: currentImportedTokens(),
      walletConnectSessions: this.walletConnect.listSessions()
    };
    this.store.setState(state);
    return state;
  }

  async createWallet(): Promise<WalletState> {
    const mnemonic = createMnemonic();
    await this.secureStore.set('mnemonic', mnemonic);
    return this.bootstrap();
  }

  async importWallet(mnemonic: string): Promise<WalletState> {
    await this.secureStore.set('mnemonic', mnemonic.trim());
    return this.bootstrap();
  }

  /**
   * Unlock the wallet with the user's password.
   * For BrowserSecureStore this derives the decryption key from the password.
   * Must be called before bootstrap() on returning users.
   */
  unlock(password: string): void {
    if ('unlock' in this.secureStore && typeof (this.secureStore as any).unlock === 'function') {
      (this.secureStore as any).unlock(password);
    }
  }

  async lock(): Promise<void> {
    this.store.setState({ ...this.store.getState(), mnemonic: undefined });
    if ('lock' in this.secureStore && typeof (this.secureStore as any).lock === 'function') {
      (this.secureStore as any).lock();
    }
  }

  /**
   * Change the wallet password and re-encrypt stored secrets.
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if ('changePassword' in this.secureStore && typeof (this.secureStore as any).changePassword === 'function') {
      await (this.secureStore as any).changePassword(oldPassword, newPassword, ['mnemonic']);
    }
  }

  // ─── Dual-address helpers (Lithosphere / Makalu) ──────────────────────────

  /** Convert an EVM 0x address to litho1... bech32 format */
  evmToLitho(evmAddress: string): string {
    return evmToLitho(evmAddress);
  }

  /** Convert a litho1... bech32 address to 0x EVM format */
  lithoToEvm(lithoAddress: string): string {
    return lithoToEvm(lithoAddress);
  }

  /** Return both address formats for any Lithosphere address */
  normaliseAddress(address: string): { evm: string; litho: string } {
    return normaliseLithoAddress(address);
  }

  /** Detect whether an address is 'evm', 'litho', or null */
  detectAddressFormat(address: string) {
    return detectAddressFormat(address);
  }

  /** Validate an address for a specific chain, returns { valid, format, reason } */
  validateAddress(address: string, chainId?: number) {
    const cid = chainId ?? this.store.getState().activeChainId;
    return validateAddressForChain(address, cid);
  }

  /** Format an address for display on the active chain (converts 0x → litho1 on Lithosphere) */
  formatAddress(address: string, chainId?: number): string {
    const cid = chainId ?? this.store.getState().activeChainId;
    return formatAddressForChain(address, cid);
  }

  getMnemonic(): string {
    const mnemonic = this.store.getState().mnemonic;
    if (!mnemonic) throw new Error('Wallet not initialized');
    return mnemonic;
  }

  getEvmPrivateKey(accountIndex = 0): string {
    return walletFromMnemonic(this.getMnemonic(), accountIndex).privateKey;
  }

  setActiveChain(chainId: number) {
    const current = this.store.getState();
    const activeAccount = current.accounts.find((account) => account.chainId === chainId) ?? current.activeAccount;
    this.store.setState({ ...current, activeChainId: chainId, activeAccount });
  }

  async sendAsset(request: SendAssetRequest): Promise<string> {
    return this.evm.sendAsset(this.getEvmPrivateKey(), request);
  }

  async sendBitcoin(request: BitcoinSendRequest): Promise<string> {
    return this.bitcoin.send(this.getMnemonic(), request);
  }

  async sendSolana(request: SolanaSendRequest): Promise<string> {
    return this.solana.send(this.getMnemonic(), request);
  }

  async importToken(request: TokenImportRequest) {
    const token = await this.tokenImporter.importToken(request);
    const current = this.store.getState();
    const importedTokens = [...(current.importedTokens || []), token];
    this.store.setState({ ...current, importedTokens });
    return token;
  }

  async pairWalletConnect(uri: string) {
    const accounts = this.store.getState().accounts.map((account) => account.address);
    const session = await this.walletConnect.pair({ uri, chainIds: this.store.getState().accounts.map((a) => a.chainId), accounts });
    const current = this.store.getState();
    this.store.setState({ ...current, walletConnectSessions: this.walletConnect.listSessions() });
    return session;
  }

  async resolveDnns(name: string) {
    return this.dnns.resolve(this.store.getState().activeChainId, name);
  }

  async registerDnns(name: string) {
    const account = this.store.getState().activeAccount;
    if (!account) throw new Error('Wallet not initialized');
    return this.dnns.register({ chainId: this.store.getState().activeChainId, name, owner: account.address, years: 1 });
  }

  async getPortfolio() {
    const account = this.store.getState().activeAccount;
    if (!account) throw new Error('Wallet not initialized');
    return this.indexer.getPortfolio(account.address);
  }

  async getLep100Portfolio() {
    const account = this.store.getState().activeAccount;
    if (!account) throw new Error('Wallet not initialized');
    const [tokens, activity, approvals] = await Promise.all([
      this.indexer.getLep100Tokens(this.store.getState().activeChainId),
      this.indexer.getLep100Activity(account.address),
      this.indexer.getLep100Approvals(account.address)
    ]);
    return { tokens, activity, approvals };
  }

  async queueLep100Sync(mode: 'bootstrap' | 'incremental' | 'backfill' = 'incremental') {
    return this.indexer.queueLep100Sync(this.store.getState().activeChainId, mode);
  }

  async executeIntent(intent: IntentRequest): Promise<unknown> {
    switch (intent.kind) {
      case 'contract':
        return this.lithic.callContract(intent.payload as any);
      case 'send':
        return this.sendAsset(intent.payload as any);
      case 'send-btc':
        return this.sendBitcoin(intent.payload as any);
      case 'send-sol':
        return this.sendSolana(intent.payload as any);
      case 'lep100-transfer':
        return this.lep100.transfer(intent.payload as any);
      case 'swap': {
        const payload = intent.payload as any;
        const quote = await this.multx.quote(payload);
        const execution = await this.multx.execute(quote.quoteId, payload.walletAddress);
        return { quote, execution, status: this.bridgeTracker.createPending(payload, execution.executionId) };
      }
      default:
        return {
          accepted: true,
          intentId: intent.id,
          message: 'Intent accepted by wallet execution engine.'
        };
    }
  }

  async simulateCurrentSend(request: SendAssetRequest) {
    return this.simulator.simulateSend(request);
  }

  async getLep100Balance(contractAddress: string, owner?: string) {
    const account = owner || this.store.getState().activeAccount?.address;
    if (!account) throw new Error('Wallet not initialized');
    return this.lep100.balanceOf({ chainId: this.store.getState().activeChainId, contractAddress, owner: account });
  }

  async getLep100Allowance(contractAddress: string, spender: string, owner?: string) {
    const account = owner || this.store.getState().activeAccount?.address;
    if (!account) throw new Error('Wallet not initialized');
    return this.lep100.allowance({ chainId: this.store.getState().activeChainId, contractAddress, owner: account, spender });
  }

  async sendLep100(contractAddress: string, to: string, amount: string, memo?: string) {
    return this.lep100.transfer({ chainId: this.store.getState().activeChainId, contractAddress, to, amount, memo });
  }

  async approveLep100(contractAddress: string, spender: string, amount: string) {
    return this.lep100.approve({ chainId: this.store.getState().activeChainId, contractAddress, spender, amount });
  }

  async revokeLep100(contractAddress: string, spender: string) {
    return this.lep100.approve({ chainId: this.store.getState().activeChainId, contractAddress, spender, amount: '0' });
  }

  inspectConnectedSite(hostname: string) {
    return inspectWebsite(hostname);
  }
}

function currentImportedTokens() { return []; }
