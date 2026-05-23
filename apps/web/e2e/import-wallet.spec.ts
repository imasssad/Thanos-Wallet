import { test, expect } from '@playwright/test';

/**
 * Key-flow E2E: import an existing BIP39 mnemonic.
 *
 * Uses the canonical "abandon × 11 + about" 12-word test vector — a
 * BIP39 mnemonic with all-zero entropy. It's a public test value, not a
 * funded account; safe to paste anywhere.
 *
 * Walks: welcome → Import existing wallet → Recovery phrase →
 * paste phrase → set password → dashboard.
 */

const TEST_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test.describe('Import wallet', () => {
  test('paste-mnemonic flow lands on the dashboard', async ({ page }) => {
    await page.goto('/app');

    await page.getByRole('button', { name: 'Import existing wallet' }).click();
    await page.getByRole('button', { name: /recovery phrase/i }).click();

    const phraseField = page.getByPlaceholder(/word1 word2 word3/i);
    await phraseField.fill(TEST_PHRASE);

    // The word-counter must light up to '12 words' before Continue is enabled.
    await expect(page.getByText('12 words')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Set password.
    await page.getByPlaceholder('Password', { exact: true }).fill('import-test-pw-789');
    await page.getByPlaceholder('Confirm password').fill('import-test-pw-789');
    await page.getByRole('button', { name: /create wallet|import/i }).click();

    // Dashboard.
    await expect(page.getByRole('button', { name: 'Send' }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('Continue is disabled until the phrase is a valid length', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Import existing wallet' }).click();
    await page.getByRole('button', { name: /recovery phrase/i }).click();

    // 5-word junk — invalid length, Continue stays disabled.
    await page.getByPlaceholder(/word1 word2 word3/i).fill('one two three four five');
    const cont = page.getByRole('button', { name: 'Continue' });
    await expect(cont).toBeDisabled();

    // Filling in a valid 12-word phrase enables it.
    await page.getByPlaceholder(/word1 word2 word3/i).fill(TEST_PHRASE);
    await expect(cont).toBeEnabled();
  });
});
