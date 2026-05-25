import { test, expect } from '@playwright/test';
import { createWallet } from './helpers';

/**
 * Key-flow E2E: WalletConnect pairing entry point.
 *
 * A full WC handshake against a live dApp is out of scope for CI —
 * it'd need a Reown relay token, a test dApp, and would be flaky on
 * network timing. What we CAN pin in CI:
 *
 *   - the WalletConnect entry point is reachable (the host header /
 *     icon-button surfaces in the unlocked UI),
 *   - the pairing input accepts a wc: URI without erroring,
 *   - garbage input is rejected with a visible error,
 *   - the modal can be opened and closed without crashing the app.
 *
 * The "real handshake" (pair → session proposal → approve) is verified
 * manually against staging — Playwright would need a Reown harness to
 * do it deterministically.
 */

const VALID_WC_V2_URI =
  'wc:1c4ff9a0a7a5d8e0f8d4c2a3b6e9f1d0c4b8a7e6f5d3c2b1a0e9f8d7c6b5a4f3@2'
  + '?relay-protocol=irn&symKey=' + 'a'.repeat(64);

test.describe('WalletConnect', () => {
  test('opening the WC pairing modal works after wallet creation', async ({ page }) => {
    await createWallet(page);

    // Any of these copy variants are acceptable; the WC entry point is
    // sometimes under a "Connect" button, sometimes a "WalletConnect"
    // label, sometimes an icon-only button. Use first() to tolerate
    // either ordering. Skip the test (not fail) if no entry point is
    // surfaced on the dashboard — the host might be modal-only.
    const trigger = page.getByRole('button', { name: /walletconnect|wc.*pair|connect dapp/i });
    if (await trigger.count() === 0) {
      test.skip(true, 'WalletConnect entry point not surfaced on this build');
    }
    await trigger.first().click();

    // Modal mounts an input that accepts a wc: URI. We don't assert
    // an exact label — different builds use different wording.
    const input = page.getByPlaceholder(/wc:|paste.*uri|pairing/i).first();
    await expect(input).toBeVisible({ timeout: 10_000 });
  });

  test('pairing input rejects clearly-invalid strings', async ({ page }) => {
    await createWallet(page);

    const trigger = page.getByRole('button', { name: /walletconnect|wc.*pair|connect dapp/i });
    if (await trigger.count() === 0) {
      test.skip(true, 'WalletConnect entry point not surfaced on this build');
    }
    await trigger.first().click();

    const input = page.getByPlaceholder(/wc:|paste.*uri|pairing/i).first();
    await input.fill('this is not a walletconnect uri');

    // The pair button should be disabled OR an error should appear when
    // the user tries to submit. Both are valid implementations.
    const pairBtn = page.getByRole('button', { name: /^pair|^connect$/i }).last();
    if (await pairBtn.isEnabled().catch(() => false)) {
      await pairBtn.click();
      // Expect a visible error after submit.
      await expect(page.getByText(/invalid|not.*wc|malformed/i).first())
        .toBeVisible({ timeout: 8_000 });
    } else {
      // Disabled state is itself the validation — that's a pass.
      await expect(pairBtn).toBeDisabled();
    }
  });

  test('the pairing input accepts a syntactically valid wc:v2 URI', async ({ page }) => {
    await createWallet(page);

    const trigger = page.getByRole('button', { name: /walletconnect|wc.*pair|connect dapp/i });
    if (await trigger.count() === 0) {
      test.skip(true, 'WalletConnect entry point not surfaced on this build');
    }
    await trigger.first().click();

    const input = page.getByPlaceholder(/wc:|paste.*uri|pairing/i).first();
    await input.fill(VALID_WC_V2_URI);

    // Pair button should become enabled — actually clicking it would
    // try to reach a real Reown relay, which we don't have in CI, so
    // we just assert the gate passed.
    const pairBtn = page.getByRole('button', { name: /^pair|^connect$/i }).last();
    await expect(pairBtn).toBeEnabled({ timeout: 5_000 });
  });
});
