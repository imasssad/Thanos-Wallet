/**
 * A local chain with the Litho Vault contracts, for the Thanos MultiSig browser test. Hardhat
 * comes from packages/multisig/test/chain (its own npm package, outside the pnpm workspace), and
 * the contracts from the same pre-built fixture the package tests use.
 *
 * The addresses are fixed in advance (Hardhat's first account deploys them in a fixed order on a
 * fresh chain), so the web build can be given them before the chain exists.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContractFactory, JsonRpcProvider, getCreateAddress } from 'ethers';

export const MULTISIG_E2E_PORT = 18546;
export const MULTISIG_E2E_RPC = `http://127.0.0.1:${MULTISIG_E2E_PORT}`;
/** Hardhat's first default account (an address, not a key). */
const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ORDER = ['freezeGuard', 'aiGuard', 'recoveryGuard', 'implementation', 'factory', 'lens'] as const;
const at = (name: (typeof ORDER)[number]) => getCreateAddress({ from: DEPLOYER, nonce: ORDER.indexOf(name) });

/** The NEXT_PUBLIC_MULTISIG_* values the e2e build is made with. */
export const MULTISIG_E2E_ENV = {
  NEXT_PUBLIC_MULTISIG_CHAIN_ID: '31337',
  NEXT_PUBLIC_MULTISIG_RPC_URL: MULTISIG_E2E_RPC,
  NEXT_PUBLIC_MULTISIG_FACTORY: at('factory'),
  NEXT_PUBLIC_MULTISIG_LENS: at('lens'),
  NEXT_PUBLIC_MULTISIG_AI_GUARD: at('aiGuard'),
  NEXT_PUBLIC_MULTISIG_RECOVERY_GUARD: at('recoveryGuard'),
  NEXT_PUBLIC_MULTISIG_FREEZE_GUARD: at('freezeGuard'),
  NEXT_PUBLIC_MULTISIG_IMPLEMENTATION: at('implementation'),
};

const chainDir = join(__dirname, '..', '..', '..', 'packages', 'multisig', 'test', 'chain');

export async function startMultisigChain(): Promise<{ provider: JsonRpcProvider; stop: () => void }> {
  const bin = join(chainDir, 'node_modules', '.bin', 'hardhat');
  if (!existsSync(bin)) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: chainDir, stdio: 'inherit' });
  const node: ChildProcess = spawn(bin, ['node', '--config', join(chainDir, 'hardhat.config.cjs'), '--port', String(MULTISIG_E2E_PORT)], { cwd: chainDir, stdio: 'ignore' });
  const provider = new JsonRpcProvider(MULTISIG_E2E_RPC, 31337, { staticNetwork: true });
  for (let i = 0; ; i++) {
    try {
      await provider.getBlockNumber();
      break;
    } catch (e) {
      if (i > 120) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const built = JSON.parse(readFileSync(join(chainDir, '..', 'fixtures', 'litho-vault-contracts.json'), 'utf8'));
  const deployer = await provider.getSigner(0);
  const args: Record<string, string[]> = { aiGuard: [at('freezeGuard')], implementation: [at('aiGuard'), at('recoveryGuard')], factory: [at('implementation')] };
  for (const name of ORDER) {
    const c = await new ContractFactory(built[name].abi, built[name].bytecode, deployer).deploy(...(args[name] ?? []));
    await c.waitForDeployment();
    if ((await c.getAddress()) !== at(name)) throw new Error(`${name} deployed at an unexpected address: is the chain fresh?`);
  }
  return { provider, stop: () => node.kill() };
}
