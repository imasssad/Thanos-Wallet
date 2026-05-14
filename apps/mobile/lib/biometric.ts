/**
 * Biometric-unlock helper for the mobile wallet.
 *
 * UX
 *   1. First-ever unlock: user types the password. We derive the AES-256
 *      key (Argon2id) and cache it in memory.
 *   2. User enables biometric in Settings → we stash the hex-encoded key
 *      in expo-secure-store under a SEPARATE slot that requires OS
 *      authentication on read. The vault itself stays password-derived
 *      so the user can still recover with their password if the biometric
 *      data is wiped (Face ID re-enrolment, device reset, etc).
 *   3. Subsequent cold starts: if biometric is enabled, the unlock screen
 *      shows a "Use Face ID / Fingerprint" button. Tapping it fires the
 *      OS biometric prompt, then reads the protected key and uses
 *      `openVaultWithKey` to decrypt — no Argon2id re-derivation.
 *
 * Threat model trade-off
 *   The protected slot is bound to the device's biometric template.
 *   Disabling biometric in this app, or rotating the OS biometric, must
 *   invalidate the slot — we explicitly clear it on disable. We never
 *   write the *password* anywhere; only the derived key.
 */

import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const BIOMETRIC_KEY_SLOT = 'thanos_vault_biokey_v1';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export interface BiometricCapability {
  /** Hardware is present on the device (sensor or camera). */
  hasHardware: boolean;
  /** User has enrolled at least one credential. */
  isEnrolled:  boolean;
  /** Best label for the available method — drives the unlock button copy. */
  kind:        BiometricKind;
}

/** What the device can do — no prompts. Pure capability query. */
export async function getBiometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    let kind: BiometricKind = 'none';
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION))      kind = 'face';
    else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT))        kind = 'fingerprint';
    else if (types.includes(LocalAuthentication.AuthenticationType.IRIS))               kind = 'iris';
    return { hasHardware, isEnrolled, kind };
  } catch {
    return { hasHardware: false, isEnrolled: false, kind: 'none' };
  }
}

/** Human label for the unlock CTA / settings row. */
export function biometricLabel(kind: BiometricKind): string {
  return kind === 'face'        ? 'Face ID'
       : kind === 'fingerprint' ? 'Fingerprint'
       : kind === 'iris'        ? 'Iris'
       : 'Biometrics';
}

/** True if a key is stashed for biometric unlock on this device. */
export async function isBiometricUnlockEnabled(): Promise<boolean> {
  try {
    // We don't prompt — just probe presence. SecureStore's getItem with
    // `requireAuthentication` true would surface the prompt; the read
    // happens later via readProtectedKey().
    const exists = await SecureStore.getItemAsync(BIOMETRIC_KEY_SLOT);
    return !!exists;
  } catch {
    return false;
  }
}

/**
 * Stash the derived AES key behind a biometric-protected slot. Caller
 * must already have the key in memory (from createVault / openVault).
 * Returns true on success.
 */
export async function enableBiometricUnlock(derivedKey: Uint8Array): Promise<boolean> {
  try {
    // Run an explicit biometric prompt *now* so the system is allowed to
    // bind the slot to the current credential template. Without an active
    // prompt the OS will sometimes write the slot unprotected (Android).
    const auth = await LocalAuthentication.authenticateAsync({
      promptMessage:        'Enable biometric unlock',
      cancelLabel:          'Cancel',
      disableDeviceFallback: false,
    });
    if (!auth.success) return false;

    await SecureStore.setItemAsync(BIOMETRIC_KEY_SLOT, bytesToHex(derivedKey), {
      requireAuthentication:        true,
      authenticationPrompt:         'Unlock Thanos Wallet',
      keychainAccessible:           SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return true;
  } catch {
    return false;
  }
}

/** Wipe the protected slot. Always succeeds (idempotent). */
export async function disableBiometricUnlock(): Promise<void> {
  try { await SecureStore.deleteItemAsync(BIOMETRIC_KEY_SLOT); } catch {}
}

/**
 * Prompt biometric, then read + return the stashed key. Returns null on
 * cancel / failed auth / no key stashed.
 */
export async function readProtectedKey(): Promise<Uint8Array | null> {
  try {
    // SecureStore on iOS automatically presents the biometric prompt
    // when requireAuthentication was set on write. On Android we run an
    // explicit prompt first so the UX is consistent across platforms.
    const auth = await LocalAuthentication.authenticateAsync({
      promptMessage:         'Unlock Thanos Wallet',
      cancelLabel:           'Cancel',
      disableDeviceFallback: false,
    });
    if (!auth.success) return null;

    const hex = await SecureStore.getItemAsync(BIOMETRIC_KEY_SLOT, {
      requireAuthentication: true,
      authenticationPrompt:  'Unlock Thanos Wallet',
    });
    if (!hex) return null;
    return hexToBytes(hex);
  } catch {
    return null;
  }
}
