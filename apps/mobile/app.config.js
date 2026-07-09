/**
 * Dynamic config layer over the static app.json.
 *
 * app.json is the base and keeps R8/ProGuard minification OFF — required so
 * the sideload/test APK (eas profile "production-apk" / "preview") builds
 * reliably (aggressive R8 was failing the Gradle phase).
 *
 * ONLY for the Play Store bundle (eas profile "production" → .aab) do we
 * re-enable ProGuard + resource shrinking for a smaller, obfuscated binary.
 * We deliberately do NOT re-add the previous `buildTypes.release` override
 * that pulled in proguard-android-OPTIMIZE.txt — that aggressive variant was
 * the likely cause of the failure; Expo's standard proguard is conservative.
 *
 * EAS sets process.env.EAS_BUILD_PROFILE during a build. When it's unset
 * (local dev, `expo config`, or any non-store profile) we return app.json
 * unchanged, so the APK/test path can never regress.
 *
 * NOTE: store minification here is best-effort and unverified until the
 * first `production` (.aab) build runs. If that Gradle build fails, grab the
 * "Run gradlew" log and we add the precise -keep rule(s).
 */
module.exports = ({ config }) => {
  if (process.env.EAS_BUILD_PROFILE !== 'production') {
    return config; // APK / preview / local — leave app.json as-is (minify off)
  }

  const plugins = (config.plugins || []).map((p) => {
    if (Array.isArray(p) && p[0] === 'expo-build-properties') {
      const opts = p[1] || {};
      return [
        'expo-build-properties',
        {
          ...opts,
          android: {
            ...(opts.android || {}),
            enableProguardInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            // First production .aab (build cbf4c52b) failed minifyReleaseWithR8
            // with exactly one missing class: java.awt.Component, referenced by
            // JNA's desktop-only Native.getWindowHandle0. AWT doesn't exist on
            // Android and that path never executes there — silence it.
            extraProguardRules: '-dontwarn java.awt.**',
          },
        },
      ];
    }
    return p;
  });

  return { ...config, plugins };
};
