// CRYPTO POLYFILLS — must be imported BEFORE anything that uses crypto.getRandomValues
// React Native doesn't have Web Crypto API by default. ethers needs it for
// Wallet.createRandom(), HDNodeWallet.fromPhrase(), Mnemonic.fromPhrase(), etc.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
