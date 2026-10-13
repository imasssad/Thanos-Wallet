// electron-builder afterPack hook: fail the build when the packaged app would
// load the wrong ethers. The main process (signer, sign-review, dapp-browser)
// needs ethers v6, but electron-builder's node_modules collection put ethers
// 5.8.0 at node_modules/ethers while unused v5 dependencies were installed,
// and that build crashed on launch with "ethers_1.Interface is not a
// constructor". Runs for every target (dmg, mas, nsis, AppImage, dir).
const path = require('path');

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
    version = JSON.parse(loadAsar().extractFile(archive, 'node_modules/ethers/package.json').toString()).version;
  } catch (e) {
    throw new Error(`afterPack: could not read node_modules/ethers from ${archive}: ${e.message}`);
  }
  if (!/^6\./.test(version)) {
    throw new Error(`afterPack: the packaged app has ethers ${version} at node_modules/ethers, but the main process needs v6. ` +
      'A dependency that pulls in ethers v5 was probably added to apps/desktop/package.json.');
  }
  console.log(`  • afterPack: node_modules/ethers ${version}`);
};
