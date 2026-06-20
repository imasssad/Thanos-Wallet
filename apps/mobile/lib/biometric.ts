/**
 * Biometric-unlock helper for the mobile wallet.
 *
 * UX
 *   1. First-ever unlock: user types the password. We derive the AES-256
 *      key (Argon2id) and cache it in memory.
 *   2. User enables biometric in Settings → we run ONE OS biometric prompt
 *      (`authenticateAsync`) to confirm the enrolled credential, then stash
 *      the hex-encoded key in expo-secure-store, device-only. The vault
 *      itself stays password-derived so the user can still recover with
 *      their password if the biometric data is wiped (re-enrolment, reset).
 *   3. Subsequent cold starts: if biometric is enabled, the unlock screen
 *      shows a "Use Face ID / Fingerprint" button. Tapping it fires ONE OS
 *      biometric prompt, then reads the stashed key and uses
 *      `openVaultWithKey` to decrypt — no Argon2id re-derivation.
 *
 * Why an explicit gate instead of SecureStore `requireAuthentication`
 *   The earlier build did BOTH an `authenticateAsync` prompt AND a
 *   SecureStore read with `requireAuthentication: true` — which on Android
 *   shows its OWN biometric prompt. The result was a confusing double
 *   prompt whose second leg silently failed on many devices ("biometrics
 *   don't work"). We now use a single `authenticateAsync` as the gate and
 *   store the key device-only (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`): readable
 *   only by this app, only while the phone is unlocked, never in a backup.
 *
 * Threat model
 *   The cached key is a convenience layer over a password-derived vault —
 *   the wallet is always recoverable with the password alone. Disabling
 *   biometric, or resetting the wallet, clears the slot. We never write the
 *   *password* anywhere; only the derived key.
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

/** Why enabling biometric failed — lets the UI show a precise message. */
export type BiometricFailReason =
  | 'no_hardware'    // device has no fingerprint/face sensor
  | 'not_enrolled'   // sensor exists but the user hasn't enrolled a credential
  | 'cancelled'      // user dismissed the OS prompt
  | 'lockout'        // too many failed attempts — OS temporarily disabled it
  | 'auth_failed'    // biometric not recognised
  | 'storage_failed';// SecureStore write failed (usually: no device screen-lock set)

export interface BiometricResult { ok: boolean; reason?: BiometricFailReason }

/** Map expo-local-authentication's error codes to our reasons. */
function mapAuthError(err?: string): BiometricFailReason {
  if (err === 'user_cancel' || err === 'app_cancel' || err === 'system_cancel' || err === 'user_fallback') return 'cancelled';
  if (err === 'lockout' || err === 'lockout_permanent') return 'lockout';
  if (err === 'not_enrolled') return 'not_enrolled';
  if (err === 'not_available' || err === 'no_hardware') return 'no_hardware';
  return 'auth_failed';
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
 * Stash the derived AES key behind biometric unlock. Caller must already
 * have the key in memory (from createVault / openVault). One OS prompt,
 * then a device-only SecureStore write. Returns a structured result so the
 * UI can explain *why* it failed instead of a generic "could not enable".
 */
export async function enableBiometricUnlock(derivedKey: Uint8Array): Promise<BiometricResult> {
  const cap = await getBiometricCapability();
  if (!cap.hasHardware) return { ok: false, reason: 'no_hardware' };
  if (!cap.isEnrolled)  return { ok: false, reason: 'not_enrolled' };

  // Single OS prompt — confirms the user owns the enrolled biometric right
  // now. (On iOS a SecureStore write wouldn't prompt at all, so doing it
  // here gives a consistent confirmation across platforms.)
  const auth = await LocalAuthentication.authenticateAsync({
    promptMessage:         `Confirm to enable ${biometricLabel(cap.kind)} unlock`,
    cancelLabel:           'Cancel',
    disableDeviceFallback: false,
  });
  if (!auth.success) return { ok: false, reason: mapAuthError(auth.error) };

  try {
    // Device-only: only this app can read it, only while the phone is
    // unlocked, and it never leaves the device in a backup. We deliberately
    // DON'T set requireAuthentication — that double-prompts on Android and
    // fails on many devices. The explicit prompt above is the gate.
    await SecureStore.setItemAsync(BIOMETRIC_KEY_SLOT, bytesToHex(derivedKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'storage_failed' };
  }
}

/** Wipe the protected slot. Always succeeds (idempotent). */
export async function disableBiometricUnlock(): Promise<void> {
  try { await SecureStore.deleteItemAsync(BIOMETRIC_KEY_SLOT); } catch {}
}

/**
 * Prompt biometric once, then read + return the stashed key. Returns null
 * on cancel / failed auth / no key stashed. Single prompt — the gate is the
 * `authenticateAsync` call; the SecureStore read is plain device-only.
 */
export async function readProtectedKey(): Promise<Uint8Array | null> {
  try {
    const cap = await getBiometricCapability();
    if (!cap.hasHardware || !cap.isEnrolled) return null;

    const auth = await LocalAuthentication.authenticateAsync({
      promptMessage:         'Unlock Thanos Wallet',
      cancelLabel:           'Cancel',
      disableDeviceFallback: false,
    });
    if (!auth.success) return null;

    const hex = await SecureStore.getItemAsync(BIOMETRIC_KEY_SLOT);
    if (!hex) return null;
    return hexToBytes(hex);
  } catch {
    return null;
  }
}
