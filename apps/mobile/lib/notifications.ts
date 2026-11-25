/**
 * Push + local notifications for the mobile wallet.
 *
 * Two layers:
 *   1. LOCAL  — fired on-device immediately (e.g. "Transaction sent").
 *      Works with no server and no credentials.
 *   2. PUSH   — an Expo push token is registered with the backend so the
 *      server can notify the device of incoming funds / activity even
 *      when the app is closed. Remote DELIVERY additionally requires the
 *      project's APNs key (iOS) + FCM key (Android) configured in EAS /
 *      Expo — until those are set, registration is a no-op-safe stub and
 *      only local notifications fire.
 *
 * The opt-in flag lives in AsyncStorage so the choice survives restarts.
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { executeWcRequest } from './wc-signer';

const ENABLED_KEY = 'thanos.notifications_enabled';
/* Matches lib/auth-client.ts. The push endpoints are address-keyed and
   don't require a session. */
const API_BASE = 'https://thanos.fi/api';

/* Foreground presentation — show a banner even when the app is open. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function isNotificationsEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(ENABLED_KEY)) === '1';
}
export async function setNotificationsEnabled(on: boolean): Promise<void> {
  if (on) await AsyncStorage.setItem(ENABLED_KEY, '1');
  else await AsyncStorage.removeItem(ENABLED_KEY);
}

/** Resolve the Expo project id from app config (used to mint push tokens). */
function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * Request OS permission and return the Expo push token, or null if the
 * user declined / this is a simulator / no project id is configured.
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulators can't receive push
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const pid = projectId();
  if (!pid) return null;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    return token.data;
  } catch {
    return null;
  }
}

/** The proof message this client will sign MUST match the server's own
 *  fixed template exactly (services/api/src/lib/push-auth.ts messageFor):
 *  our lowercase address, a 32-hex nonce, an ISO-8601 expiry — nothing
 *  else. The address is format-checked first, so nothing unescaped ever
 *  reaches the RegExp source. */
function isExpectedProofMessage(message: string, address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const re = new RegExp(
    `^Thanos Wallet push notifications\\n\\nAddress: ${address.toLowerCase()}\\nNonce: [0-9a-f]{32}\\nExpires: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  );
  return re.test(message);
}

/** Fetch a proof-of-ownership nonce for `address` and sign it with the
 *  unlocked seed (THN-R1 M-01) — register/unregister require this so the
 *  backend knows the caller actually controls the address it's pushing to
 *  before storing/dropping a device token against it. Silent: this is the
 *  app proving its own wallet's address, not a dApp request, so it never
 *  shows the signing-approval sheet. Returns null on any failure (offline,
 *  locked wallet, backend not live yet) — callers treat that as "skip".
 *  Hardening-audit H-1: no seed parameter — executeWcRequest signs through
 *  lib/signer.ts's own cache (set once at unlock by App.tsx) and throws if
 *  the wallet is locked, caught below the same as any other failure.
 *
 *  Because this signs with NO approval sheet, the message is never trusted
 *  as free-form server text: it must match the fixed ownership-proof
 *  template above, with this wallet's own address embedded, or nothing is
 *  signed. Without that check, whoever controls API responses (a
 *  compromised backend, or a MITM of the API host) could feed this silent
 *  path an arbitrary string — a SIWE login challenge, a signature-derived
 *  key-generation message — and harvest a chosen-message personal_sign
 *  signature from every mobile user on app start. The server reconstructs
 *  the message from the nonceToken's own embedded fields when verifying,
 *  so a template-conforming message is exactly what it expects. */
async function signOwnershipProof(address: string): Promise<{ nonceToken: string; signature: string } | null> {
  try {
    const nonceRes = await fetch(`${API_BASE}/push/nonce?address=${encodeURIComponent(address)}`);
    if (!nonceRes.ok) return null;
    const { nonceToken, message } = await nonceRes.json() as { nonceToken: string; message: string };
    if (typeof nonceToken !== 'string' || typeof message !== 'string') return null;
    if (!isExpectedProofMessage(message, address)) return null; // never sign free-form server text
    const signature = await executeWcRequest({ request: { method: 'personal_sign', params: [message, address] } }) as string;
    return { nonceToken, signature };
  } catch {
    return null;
  }
}

/**
 * Enable push for this wallet: get a token and register it with the
 * backend against the wallet address so the server can target it.
 * Returns true when a token was obtained (local notifications work
 * regardless). Network/registration failures are swallowed.
 */
export async function registerPush(address: string): Promise<boolean> {
  const token = await getPushToken();
  if (!token) return false;
  try {
    const proof = await signOwnershipProof(address);
    if (!proof) return true; // local notifications still work; remote registration skipped
    await fetch(`${API_BASE}/push/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, address, platform: Platform.OS, ...proof }),
    });
  } catch {
    /* backend endpoint not live yet — token still valid for next try */
  }
  return true;
}

/** Tell the backend to stop pushing to this device. */
export async function unregisterPush(address: string): Promise<void> {
  try {
    const token = await getPushToken();
    const proof = token ? await signOwnershipProof(address) : null;
    if (token && proof) {
      await fetch(`${API_BASE}/push/unregister`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, address, ...proof }),
      });
    }
  } catch { /* best-effort */ }
}

/** Fire an immediate on-device notification (no server needed). */
export async function notifyLocal(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch { /* notifications may be disabled at OS level */ }
}

/** Fire a local notification ONLY if the user has notifications enabled.
 *  Convenience wrapper so activity call sites are one fire-and-forget line. */
export async function notifyIfEnabled(title: string, body: string): Promise<void> {
  try { if (await isNotificationsEnabled()) await notifyLocal(title, body); }
  catch { /* best-effort */ }
}

/** Human notification title for an incoming WalletConnect request method. */
export function wcRequestTitle(method: string): string {
  if (method === 'eth_sendTransaction' || method === 'eth_signTransaction') return 'Transaction request';
  if (method === 'personal_sign' || method === 'eth_sign'
      || method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') return 'Signature request';
  return 'Wallet request';
}
