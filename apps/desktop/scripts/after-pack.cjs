// electron-builder afterPack hook: fail the build when the packaged app would
// load the wrong ethers. The main process (signer, sign-review, dapp-browser)
// needs ethers v6, but electron-builder's node_modules collection put ethers
// 5.8.0 at node_modules/ethers while unused v5 dependencies were installed,
// and that build crashed on launch with "ethers_1.Interface is not a
// constructor". Runs for every target (dmg, mas, nsis, AppImage, dir).
//
// Also flips Electron's build-time fuses (THN-04b): electron-builder 25.1.8
// has no native `electronFuses` config (verified — no @electron/fuses
// reference anywhere in the installed app-builder-lib/electron-builder
// trees), so this hook calls flipFuses() directly on the packaged binary.
// Without this, a packaged release still ships Node's RunAsNode /
// NODE_OPTIONS / --inspect entry points live, letting anyone who can set an
// env var or pass a flag to the signed executable re-enter it as plain
// Node — full access to the unlocked seed and signer IPC, outside any of
// the renderer/IPC sandboxing above.
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

/** @electron/asar ships with electron-builder (via app-builder-lib); pnpm
 *  doesn't hoist it, so resolve it through that chain. */
function loadAsar() {
  const dirOf = (pkg, from) => path.dirname(require.resolve(`${pkg}/package.json`, { paths: [from] }));
  const lib = dirOf('app-builder-lib', dirOf('electron-builder', __dirname));
  return require(require.resolve('@electron/asar', { paths: [lib] }));
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources = electronPlatformName === 'darwin' || electronPlatformName === 'mas'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  const archive = path.join(resources, 'app.asar');
  let version;
  try {
    // path.join, not a '/' literal: @electron/asar splits the in-archive path
    // on path.sep, so on Windows 'node_modules/ethers/package.json' is never
    // found and every Windows build failed here.
    const entry = path.join('node_modules', 'ethers', 'package.json');
    version = JSON.parse(loadAsar().extractFile(archive, entry).toString()).version;
  } catch (e) {
    throw new Error(`afterPack: could not read node_modules/ethers from ${archive}: ${e.message}`);
  }
  if (!/^6\./.test(version)) {
    throw new Error(`afterPack: the packaged app has ethers ${version} at node_modules/ethers, but the main process needs v6. ` +
      'A dependency that pulls in ethers v5 was probably added to apps/desktop/package.json.');
  }
  console.log(`  • afterPack: node_modules/ethers ${version}`);

  // electronPlatformName is electron-builder's own name for the target
  // ('darwin' | 'mas' | 'win32' | 'linux'), not Node's process.platform.
  // flipFuses() accepts the .app bundle itself on macOS and resolves the
  // real binary inside Contents/MacOS/ on its own; win32/linux need the
  // actual executable path.
  const binaryPath = electronPlatformName === 'darwin' || electronPlatformName === 'mas'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
    : electronPlatformName === 'win32'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.exe`)
      // linux's packaged binary is named from `executableName`
      // (lowercased product name by default), not productFilename.
      : path.join(appOutDir, packager.executableName);
  await flipFuses(binaryPath, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin' || electronPlatformName === 'mas',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log(`  • afterPack: fuses flipped on ${binaryPath}`);
};
