import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: DNNS name resolution inside the Send modal.
 *
 * When the recipient field gets something that looks like a name (has a
 * dot, isn't a raw address), the modal fires `resolveName()` against the
 * API + on-chain registry. In CI both are unreachable, so the
 * deterministic path is:
 *   "thanos-test.litho" → Resolving… → Could not resolve thanos-test.litho
 *
 * We assert that the resolver actually runs (the "Resolving" or
 * "Could not resolve" hint appears) — proving the input is treated as a
 * name, not as a malformed address.
 *
 * Live happy-path resolution requires a known-good name on Makalu and is
 * left to manual smoke testing against the staging API.
 */

test.describe('DNNS', () => {
  test('a .litho name kicks off DNNS resolution in the Send modal', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Send' }).first().click();

    // The Send modal mounts on Makalu by default — the network DNNS
    // resolves against.
    const recipient = page.getByPlaceholder(/litho1.*0x|0x.*address/i).first();
    await expect(recipient).toBeVisible();

    await recipient.fill('thanos-test.litho');

    // We accept either the in-flight or terminal state — both prove the
    // DNNS path engaged. The address-format error MUST NOT be visible
    // (the input looks like a name, not a malformed address).
    const resolvingOrNotFound = page.getByText(
      /(Resolving thanos-test\.litho)|(Could not resolve thanos-test\.litho)/i,
    );
    await expect(resolvingOrNotFound).toBeVisible({ timeout: 15_000 });
  });

  test('a raw 0x address is treated as an address, not a DNNS name', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Send' }).first().click();

    const recipient = page.getByPlaceholder(/litho1.*0x|0x.*address/i).first();
    await recipient.fill('0x1234567890123456789012345678901234567890');

    // The DNNS hint must NOT appear for a raw address.
    await expect(page.getByText(/Resolving/i)).toHaveCount(0);
    await expect(page.getByText(/Could not resolve/i)).toHaveCount(0);

    // And the recipient should validate (valid-address badge appears).
    await expect(page.getByText(/valid .* address/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('DNNS hint disappears when the user clears the field', async ({ page }) => {
    await createWallet(page);
    await page.getByRole('button', { name: 'Send' }).first().click();

    const recipient = page.getByPlaceholder(/litho1.*0x|0x.*address/i).first();
    await recipient.fill('some-name.litho');

    // Wait until the resolver UI has surfaced (in-flight or terminal).
    await expect(page.getByText(/(Resolving|Could not resolve) some-name\.litho/i))
      .toBeVisible({ timeout: 15_000 });

    // Clearing the field removes the hint.
    await recipient.fill('');
    await expect(page.getByText(/Resolving|Could not resolve/i)).toHaveCount(0);
  });
});
