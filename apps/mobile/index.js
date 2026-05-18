// ─── POLYFILLS — must load before anything that touches crypto / URL ───────
// React Native lacks Web Crypto + a full URL implementation.
//   - react-native-get-random-values: crypto.getRandomValues — ethers needs
//     it for Wallet.createRandom() / HDNodeWallet.fromPhrase() / Mnemonic.
//   - react-native-url-polyfill: a spec URL — WalletConnect's relay client
//     parses wss:// URLs.
//   - @walletconnect/react-native-compat: TextEncoder/Decoder, Buffer, and
//     other shims WalletKit + @walletconnect/core expect.
// Order matters — the compat shim must run before WalletKit is imported.
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import '@walletconnect/react-native-compat';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
