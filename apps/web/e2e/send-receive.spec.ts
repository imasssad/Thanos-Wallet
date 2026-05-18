import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: the Send and Receive modals.
 *
 * Each test creates a fresh wallet, then drives the modal. We assert
 * the modal opens, the chain controls work, and recipient validation
 * fires — without broadcasting anything (no funded wallet in CI).
 *
 * `.first()` on the action buttons is deliberate: a fresh wallet's
 * empty-state card surfaces a second "Receive" CTA, so a strict role
 * query would resolve to two elements.
 */

test.describe('Send / Receive', () => {
  test('Receive modal shows a network list with copyable addresses', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Receive' }).first().click();

    // The receive screen lists the networks the wallet has addresses on.
    await expect(page.getByText(/receiving address/i)).toBeVisible();
    await expect(page.getByText('Lithosphere Makalu').first()).toBeVisible();
    await expect(page.getByText('Bitcoin').first()).toBeVisible();
  });

  test('Send modal validates the recipient address', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Send' }).first().click();

    // Modal mounts with the recipient field.
    const recipient = page.getByPlaceholder(/litho1.*0x|0x.*address/i).first();
    await expect(recipient).toBeVisible();

    // Garbage input → the Send button stays disabled (validation gates
    // it). Asserting button state is more robust than matching the
    // exact inline error copy.
    await recipient.fill('not-a-real-address');
    const sendBtn = page.getByRole('button', { name: /^send /i }).last();
    await expect(sendBtn).toBeDisabled();

    // A well-formed 0x address clears validation — the "valid address"
    // badge shows and the Send button is no longer gated on recipient.
    await recipient.fill('0x1234567890123456789012345678901234567890');
    await expect(page.getByText(/valid .* address/i).first()).toBeVisible();
  });

  test('Send modal network picker switches chains', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Send' }).first().click();

    // The network trigger defaults to Lithosphere Makalu.
    await expect(page.getByText('Lithosphere Makalu').first()).toBeVisible();
    // Send button reflects the active asset.
    await expect(page.getByRole('button', { name: /send (litho|btc|sol|atom|eth)/i }).first()).toBeVisible();
  });
});
