/**
 * Screen-capture protection — wrap any screen that renders the user's
 * seed phrase, private key, or another secret with this hook.
 *
 * Android: engages FLAG_SECURE on the underlying Activity — screenshots,
 *          screen recordings, and Recents-thumbnails return a black frame
 *          for as long as the protection is active, WITHOUT affecting the
 *          live on-screen content.
 * iOS:     we deliberately do NOT call preventScreenCaptureAsync(). On iOS
 *          that API installs a secure recording-obfuscation layer that, on
 *          iOS 26 / expo-screen-capture 7.2, blanks the LIVE screen and
 *          swallows touches on the protected steps — turning the recovery-
 *          phrase display into a black screen and the phrase-import field
 *          into an untappable control. iOS has no API to actually prevent a
 *          screenshot regardless, so we rely solely on addScreenshotListener
 *          to warn the user after the fact. (Re-enable prevention on iOS only
 *          once expo-screen-capture ships a fix that doesn't obscure the live
 *          view.)
 *
 * The Android prevent/allow calls are idempotent: multiple components asking
 * for protection stack via expo-screen-capture's internal refcount.
 */
import { useEffect } from 'react';
import { Alert, Platform } from 'react-native';
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
        // FLAG_SECURE is safe (and effective) only on Android. See file header
        // for why iOS prevention is intentionally skipped.
        if (Platform.OS === 'android') {
          await preventScreenCaptureAsync();
          if (!mounted) {
            await allowScreenCaptureAsync().catch(() => {});
            return;
          }
        } else if (!mounted) {
          return;
        }

        // Both platforms: warn the user if a screenshot of sensitive material
        // is taken (iOS can't block the action itself — this is the mitigation).
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
      if (Platform.OS === 'android') allowScreenCaptureAsync().catch(() => {});
    };
  }, [active]);
}
