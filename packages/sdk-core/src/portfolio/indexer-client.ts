import type {
  Lep100ActivityItem,
  Lep100ApprovalRecord,
  Lep100SyncJob,
  Lep100TokenListResponse,
  PortfolioSnapshot
} from '../types';

/**
 * Typed client for services/indexer — balances, LEP100 token lists,
 * activity and approvals derived from the indexer's on-chain log sync.
 *
 * The indexer is reverse-proxied at `/indexer` in production (nginx),
 * which is the default base URL. A non-browser client (where a relative
 * path won't resolve) passes an absolute URL to the constructor.
 */
export class IndexerClient {
  private readonly baseUrl: string;

  constructor(baseUrl = '/indexer') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
      ...init
    });
    if (!response.ok) throw new Error(`Indexer request failed: ${response.status}`);
    return response.json() as Promise<T>;
  }

  /** Full portfolio snapshot (native + LEP100 balances + activity). */
  async getPortfolio(walletAddress: string): Promise<PortfolioSnapshot> {
    return this.json(`/portfolio/${encodeURIComponent(walletAddress)}`);
  }

  /** Recent on-chain activity. */
  async getActivity(walletAddress: string) {
    return this.json(`/activity/${encodeURIComponent(walletAddress)}`);
  }

  /** LEP100 token list for a chain. */
  async getLep100Tokens(chainId: number): Promise<Lep100TokenListResponse> {
    return this.json(`/lep100/tokens?chainId=${chainId}`);
  }

  /** LEP100 balances for a wallet — for the post-import discovery flow. */
  async getLep100Balances(walletAddress: string): Promise<{ items: unknown[] }> {
    return this.json(`/lep100/balances/${encodeURIComponent(walletAddress)}`);
  }

  /** LEP100 transfer / approval activity for a wallet. */
  async getLep100Activity(
    walletAddress: string,
  ): Promise<{ walletAddress: string; items: Lep100ActivityItem[] }> {
    return this.json(`/lep100/activity/${encodeURIComponent(walletAddress)}`);
  }

  /** Live LEP100 approvals for a wallet — drives the Permissions view. */
  async getLep100Approvals(
    walletAddress: string,
  ): Promise<{ walletAddress: string; items: Lep100ApprovalRecord[] }> {
    return this.json(`/lep100/approvals/${encodeURIComponent(walletAddress)}`);
  }

  /** Queue an indexer sync job for a chain. */
  async queueLep100Sync(
    chainId: number,
    mode: Lep100SyncJob['mode'] = 'incremental',
  ): Promise<{ job: Lep100SyncJob }> {
    return this.json('/lep100/sync', {
      method: 'POST',
      body: JSON.stringify({ chainId, mode })
    });
  }

  /** Liveness probe — for a "Connected / Offline" badge. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.json('/health');
      return true;
    } catch {
      return false;
    }
  }
}
