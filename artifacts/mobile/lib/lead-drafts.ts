import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { LeadDraftStore } from './lead-draft-store';

// Web recovery is session memory only, deliberately never browser plaintext storage.
const memory = new Map<string, string>();
export const leadDrafts = new LeadDraftStore(Platform.OS === 'web' ? {
  get: async key => memory.get(key) ?? null,
  set: async (key, value) => { memory.set(key, value); },
  remove: async key => { memory.delete(key); },
} : {
  get: SecureStore.getItemAsync,
  set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: SecureStore.deleteItemAsync,
});
