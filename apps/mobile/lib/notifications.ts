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
    await fetch(`${API_BASE}/push/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, address, platform: Platform.OS }),
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
    if (token) {
      await fetch(`${API_BASE}/push/unregister`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, address }),
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
