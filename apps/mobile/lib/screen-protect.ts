/**
 * Screen-capture protection — wrap any screen that renders the user's
 * seed phrase, private key, or another secret with this hook.
 *
 * Android: engages FLAG_SECURE on the underlying Activity — screenshots,
 *          screen recordings, and Recents-thumbnails return a black frame
 *          for as long as the protection is active.
 * iOS:     starts capture detection (no API to actually *prevent* a
 *          screenshot on iOS) so we can at least warn the user via the
 *          `addScreenshotListener` callback if they try.
 *
 * Both calls are idempotent: multiple components asking for protection
 * stack via expo-screen-capture's internal refcount.
 */
import { useEffect } from 'react';
import { Alert } from 'react-native';
import {
  preventScreenCaptureAsync,
  allowScreenCaptureAsync,
  addScreenshotListener,
} from 'expo-screen-capture';

export function useScreenProtect(active = true): void {
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let sub: { remove: () => void } | null = null;

    (async () => {
      try {
        await preventScreenCaptureAsync();
        if (!mounted) {
          await allowScreenCaptureAsync().catch(() => {});
          return;
        }
        // iOS-only: detect that a screenshot was nonetheless taken
        // (iOS has no API to prevent the action itself) and warn the
        // user so they can rotate their seed or be aware of the leak.
        sub = addScreenshotListener(() => {
          Alert.alert(
            'Screenshot detected',
            'Your screen contains sensitive recovery information. '
            + 'If a screenshot was saved, delete it immediately — anyone '
            + 'with that image can drain your wallet.',
          );
        });
      } catch {
        /* expo-screen-capture not available (web build, old Expo) — silent fallback */
      }
    })();

    return () => {
      mounted = false;
      sub?.remove();
      allowScreenCaptureAsync().catch(() => {});
    };
  }, [active]);
}
