import { registerRootComponent } from 'expo';
import App from './App';

// Bypasses Expo's default AppEntry.js — it uses ../../App resolution
// which breaks under pnpm's symlink structure.
registerRootComponent(App);
