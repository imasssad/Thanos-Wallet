import { test, expect } from '@playwright/test';
import { Contract, JsonRpcProvider, formatEther, parseEther } from 'ethers';
import { parseAddress, toLithoAddress } from '@thanos/multisig';
import { createWallet } from './helpers';
import { startMultisigChain } from './multisig-chain';

/**
 * Thanos MultiSig end to end on a local chain with the real Litho Vault contracts: a fresh
 * wallet creates a 2-of-3 multisig, funds it, proposes a payment and executes it after a second
 * signer approves (that signer is another wallet, driven over JSON-RPC).
 */
let chain: { provider: JsonRpcProvider; stop: () => void } | null = null;

test.beforeAll(async () => {
  chain = await startMultisigChain();
});
test.afterAll(() => chain?.stop());

test('create a 2-of-3 MultiSig, propose a payment, approve and execute it', async ({ page }) => {
  test.setTimeout(240_000);
  const provider = chain!.provider;
  const funder = await provider.getSigner(0);
  const second = await provider.getSigner(1);
  const third = await provider.getSigner(2);
  const recipient = await (await provider.getSigner(3)).getAddress();
  const recipientBefore = await provider.getBalance(recipient);

  await createWallet(page);
  await page.goto('/app/multisig');
  await expect(page.getByRole('heading', { name: 'MultiSig', exact: true })).toBeVisible();
  await expect(page.getByTestId('tms-empty')).toBeVisible();

  // Create (LEP100-15 §82): network, signers (one typed as litho1, as Thanos shows addresses), threshold.
  await page.getByTestId('tms-create').click();
  await expect(page.getByTestId('tms-create-network')).toContainText('chain 31337');
  // Shown as litho1 (every address is); the 0x form is what the funding transaction needs.
  const shownMe = (await page.getByTestId('tms-me').innerText()).trim();
  expect(shownMe.startsWith('litho1')).toBe(true);
  const me = parseAddress(shownMe)!;
  await (await funder.sendTransaction({ to: me, value: parseEther('5') })).wait();
  await page.getByTestId('tms-name').fill('E2E treasury');
  await page.getByTestId('tms-signer-2').fill(await second.getAddress());
  await page.getByTestId('tms-add-signer').click();
  await page.getByTestId('tms-signer-3').fill(toLithoAddress(await third.getAddress()));
  await expect(page.getByTestId('tms-signer-3-hint')).toHaveText(`EVM: ${await third.getAddress()}`);
  await page.getByTestId('tms-threshold').selectOption('2');
  await page.getByTestId('tms-deploy').click();

  await expect(page.getByTestId('tms-vault-name')).toHaveText('E2E treasury', { timeout: 60_000 });
  const vault = (await page.getByTestId('tms-vault-address-evm').innerText()).trim();
  await expect(page.getByTestId('tms-vault-address-litho')).toHaveText(toLithoAddress(vault));
  await expect(page.getByTestId('tms-signers')).toContainText('2 of 3 must approve');

  // Fund it and propose sending 1.25 LITHO.
  await (await funder.sendTransaction({ to: vault, value: parseEther('3') })).wait();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByTestId('tms-balances')).toContainText('3.0');
  await page.getByTestId('tms-new-transfer').click();
  await page.getByTestId('tms-amount').fill('1.25');
  await page.getByTestId('tms-recipient').fill(recipient);
  await page.getByTestId('tms-review-btn').click();
  await expect(page.getByTestId('tms-draft-review')).toContainText('succeeded in simulation', { timeout: 30_000 });
  await page.getByTestId('tms-propose').click();

  // The proposal screen (LEP100-15 §83): every field, in order; the proposer has approved.
  await expect(page.getByTestId('tms-state')).toHaveText('Needs approvals', { timeout: 60_000 });
  const fields = await page.getByTestId('tms-review-fields').locator('[data-testid^="tms-field-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(fields).toEqual([
    'tms-field-action', 'tms-field-asset', 'tms-field-amount', 'tms-field-recipient', 'tms-field-network', 'tms-field-fee',
    'tms-field-contract', 'tms-field-function', 'tms-field-calldata', 'tms-field-simulation', 'tms-field-approvals',
    'tms-field-required', 'tms-field-ai', 'tms-field-warnings', 'tms-field-expiration', 'tms-field-tx',
  ]);
  await expect(page.getByTestId('tms-field-amount')).toContainText('1.25 LITHO');
  await expect(page.getByTestId('tms-field-required')).toContainText('1 of 2');
  await expect(page.getByTestId('tms-approve')).toHaveCount(0);

  // The second signer approves from their own wallet.
  await (await new Contract(vault, ['function approve(uint256)'], second).getFunction('approve')(1n)).wait();
  await page.getByTestId('tms-back').click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByTestId('tms-proposal-1').click();
  await expect(page.getByTestId('tms-state')).toHaveText('Ready to execute', { timeout: 30_000 });
  await page.getByTestId('tms-execute').click();
  await expect(page.getByTestId('tms-state')).toHaveText('Executed', { timeout: 60_000 });
  await expect(page.getByTestId('tms-field-tx')).toContainText('0x');
  expect(formatEther((await provider.getBalance(recipient)) - recipientBefore)).toBe('1.25');
});
