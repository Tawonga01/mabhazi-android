import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { LeadDraftStore } from './lead-draft-store';
import { ActualDraftStore } from './actual-draft-store';
import { RoutePlaceDraftStore } from './route-place-draft-store';
import type { DraftStorage } from './secure-draft-store';

// Web recovery is session memory only, deliberately never browser plaintext storage.
const memory = new Map<string, string>();
const storage: DraftStorage = Platform.OS === 'web' ? {
  get: async key => memory.get(key) ?? null,
  set: async (key, value) => { memory.set(key, value); },
  remove: async key => { memory.delete(key); },
} : {
  get: SecureStore.getItemAsync,
  set: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: SecureStore.deleteItemAsync,
};

const routes = new LeadDraftStore(storage);
export const actualDrafts = new ActualDraftStore(storage);
export const placeDrafts = new RoutePlaceDraftStore(storage);
// Every existing logout/session-erasure/deletion path also clears journey drafts.
export const leadDrafts = {
  read: routes.read.bind(routes), write: routes.write.bind(routes), remove: routes.remove.bind(routes),
  clear: async () => { const results = await Promise.allSettled([routes.clear(), actualDrafts.clear(), placeDrafts.clear()]); const failed = results.find(r => r.status === "rejected"); if (failed?.status === "rejected") throw failed.reason; },
};
