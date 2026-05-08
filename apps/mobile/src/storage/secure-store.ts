import * as SecureStore from 'expo-secure-store';
import type { SecureStore as SecureStoreInterface } from '@thanos/sdk-core';

export class MobileSecureStore implements SecureStoreInterface {
  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  }

  async remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }
}
