import TrezorConnect from '@trezor/connect-web';

export class TrezorAdapter {
  init(manifest: { email: string; appUrl: string; appName?: string }) {
    TrezorConnect.init({
      lazyLoad: true,
      manifest: { appName: 'Thanos Wallet', ...manifest }
    });
  }

  // Return types widened to `unknown` so the inferred TrezorConnect
  // Response signature doesn't leak the .pnpm-mangled @trezor/connect
  // path into consumers' .d.ts files (TS2742 "not portable" error).
  async getEthereumAddress(path = `m/44'/60'/0'/0/0`): Promise<unknown> {
    return TrezorConnect.ethereumGetAddress({ path, showOnTrezor: false });
  }

  async getBitcoinAddress(path = `m/84'/0'/0'/0/0`): Promise<unknown> {
    return TrezorConnect.getAddress({ path, coin: 'btc', showOnTrezor: false });
  }
}
