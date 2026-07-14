/**
 * Native entry point.
 *
 * Keep the application import inside a real try/catch.  A static
 * `import App from './App'` is evaluated before any code in this file, so an
 * exception in App's large dependency graph used to terminate Hermes before
 * the React error boundary could mount.  Store builds then appeared to open
 * and immediately close with no useful error on screen.
 */
const React = require('react');
const { Pressable, ScrollView, StatusBar, Text, View } = require('react-native');
const { registerRootComponent } = require('expo');

let App;
let bootstrapError = null;

try {
  // Polyfill order matters for ethers and WalletConnect.  Keeping these inside
  // the guarded bootstrap also makes a missing/incompatible shim diagnosable.
  require('react-native-get-random-values');
  require('react-native-url-polyfill/auto');
  require('@walletconnect/react-native-compat');

  App = require('./App').default;
  if (!App) throw new Error('The application root component was not exported.');
} catch (error) {
  bootstrapError = error instanceof Error ? error : new Error(String(error));
  // Android logcat and Play Console pre-launch reports retain this marker.
  console.error('[THANOS_BOOTSTRAP_FATAL]', bootstrapError);
}

function BootstrapCrashScreen() {
  const message = bootstrapError?.message || String(bootstrapError || 'Unknown startup error');
  const stack = bootstrapError?.stack
    ? `\n\n${bootstrapError.stack.split('\n').slice(0, 14).join('\n')}`
    : '';

  return React.createElement(
    View,
    {
      style: {
        flex: 1,
        backgroundColor: '#0a0e17',
        justifyContent: 'center',
        padding: 28,
      },
    },
    React.createElement(StatusBar, { barStyle: 'light-content', backgroundColor: '#0a0e17' }),
    React.createElement(
      Text,
      { style: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12 } },
      "Couldn't start Thanos Wallet",
    ),
    React.createElement(
      Text,
      { style: { color: '#9aa3b2', fontSize: 13, lineHeight: 19, marginBottom: 18 } },
      'Your wallet data is safe. Please screenshot the diagnostic below and send it to support.',
    ),
    React.createElement(
      ScrollView,
      { style: { maxHeight: 300 } },
      React.createElement(
        Text,
        { selectable: true, style: { color: '#f87171', fontFamily: 'monospace', fontSize: 11, lineHeight: 16 } },
        `${message}${stack}`,
      ),
    ),
  );
}

/**
 * Catches RUNTIME render errors from anywhere in the app (the bootstrap
 * try/catch above only covers import-time failures). Without a boundary, an
 * uncaught render error unmounts the whole tree and leaves a bare black screen
 * — impossible to diagnose on a device with no Mac attached. This turns that
 * into a readable, screenshot-able diagnostic with a recovery action.
 */
class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error, info) {
    console.error('[THANOS_RUNTIME_FATAL]', error, info && info.componentStack);
  }

  render() {
    const err = this.state.error;
    if (!err) return this.props.children;
    const message = err.message || String(err);
    const stack = err.stack ? `\n\n${err.stack.split('\n').slice(0, 16).join('\n')}` : '';
    return React.createElement(
      View,
      { style: { flex: 1, backgroundColor: '#0a0e17', justifyContent: 'center', padding: 28 } },
      React.createElement(StatusBar, { barStyle: 'light-content', backgroundColor: '#0a0e17' }),
      React.createElement(
        Text,
        { style: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 12 } },
        'Something went wrong',
      ),
      React.createElement(
        Text,
        { style: { color: '#9aa3b2', fontSize: 13, lineHeight: 19, marginBottom: 18 } },
        'Your wallet data is safe. Screenshot the diagnostic below and send it to support, then tap Try again.',
      ),
      React.createElement(
        ScrollView,
        { style: { maxHeight: 280 } },
        React.createElement(
          Text,
          { selectable: true, style: { color: '#f87171', fontFamily: 'monospace', fontSize: 11, lineHeight: 16 } },
          `${message}${stack}`,
        ),
      ),
      React.createElement(
        Pressable,
        {
          onPress: () => this.setState({ error: null }),
          style: { marginTop: 20, backgroundColor: '#3b7af7', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
        },
        React.createElement(Text, { style: { color: '#fff', fontSize: 15, fontWeight: '700' } }, 'Try again'),
      ),
    );
  }
}

function Root() {
  if (bootstrapError) return React.createElement(BootstrapCrashScreen);
  return React.createElement(RootErrorBoundary, null, React.createElement(App));
}

registerRootComponent(Root);
