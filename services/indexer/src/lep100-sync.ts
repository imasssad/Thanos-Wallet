// LEP-100 sync stubs — full implementation deferred to Day 4 when sdk-core
// imports are wired into the Docker build context.

const now = () => new Date().toISOString();

export interface ResolvedMakaluToken {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
}

export function getMakaluSeedTokenList() {
  return { tokens: [] as ResolvedMakaluToken[], generatedAt: now() };
}

export function buildSeedActivity(_address: string) {
  return { activity: [], generatedAt: now() };
}

export function seededApprovals(_address: string) {
  return { approvals: [], generatedAt: now() };
}

export async function runMakaluSync(_job: any) {
  return { ok: true, processed: 0, generatedAt: now() };
}
