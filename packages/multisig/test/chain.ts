/**
 * Starts a local Hardhat chain, deploys the Litho Vault system contracts from the pre-built
 * fixture (the same order as Litho Vault's deploy script) and a test token, and hands their
 * addresses to the tests.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider } from 'ethers';
import type { GlobalSetupContext } from 'vitest/node';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MULTISIG_TEST_PORT ?? 18545);

interface Built { abi: unknown[]; bytecode: string }

export interface TestChain {
  rpcUrl: string;
  factory: string;
  lens: string;
  aiGuard: string;
  recoveryGuard: string;
  freezeGuard: string;
  implementation: string;
  token: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    chain: TestChain;
  }
}

let node: ChildProcess | null = null;

async function waitForChain(provider: JsonRpcProvider): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      await provider.getBlockNumber();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('The local chain did not start');
}

export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  // Hardhat lives in its own npm package (test/chain), outside the pnpm workspace.
  const chainDir = join(here, 'chain');
  const bin = join(chainDir, 'node_modules', '.bin', process.platform === 'win32' ? 'hardhat.cmd' : 'hardhat');
  if (!existsSync(bin)) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: chainDir, stdio: 'inherit', shell: process.platform === 'win32' });
  node = spawn(bin, ['node', '--config', join(chainDir, 'hardhat.config.cjs'), '--port', String(PORT)], { cwd: chainDir, stdio: 'ignore' });
  const rpcUrl = `http://127.0.0.1:${PORT}`;
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  await waitForChain(provider);

  const built = JSON.parse(readFileSync(join(here, 'fixtures', 'litho-vault-contracts.json'), 'utf8')) as Record<string, Built>;
  const deployer = await provider.getSigner(0);
  const deploy = async (key: string, args: string[] = []) => {
    const c = await new ContractFactory(built[key]!.abi as never, built[key]!.bytecode, deployer).deploy(...args);
    await c.waitForDeployment();
    return c.getAddress();
  };
  const freezeGuard = await deploy('freezeGuard');
  const aiGuard = await deploy('aiGuard', [freezeGuard]);
  const recoveryGuard = await deploy('recoveryGuard');
  const implementation = await deploy('implementation', [aiGuard, recoveryGuard]);
  const factory = await deploy('factory', [implementation]);
  const lens = await deploy('lens');
  const token = await deploy('token');
  provide('chain', { rpcUrl, factory, lens, aiGuard, recoveryGuard, freezeGuard, implementation, token });
}

export async function teardown(): Promise<void> {
  node?.kill();
}
