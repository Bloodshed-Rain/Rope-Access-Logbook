// __tests__/cloudMock.ts
import { CloudClient, AuthProvider } from '../src/cloud/cloudClient';
import { AuthSession } from '../src/types';

export interface MockCloudOptions {
  simulateOffline?: boolean;
  simulateQuotaExceeded?: boolean;
  failUploadFor?: (key: string, attempt: number) => boolean;
  initialSession?: AuthSession | null;
}

export interface MockCloudClient extends CloudClient {
  readonly storage: Map<string, Uint8Array>;
  setSession(session: AuthSession | null): void;
  getUploadAttempts(key: string): number;
  setOnline(online: boolean): void;
  setQuotaExceeded(exceeded: boolean): void;
  setFailUpload(fn: ((key: string, attempt: number) => boolean) | null): void;
  edgeFunctionCalls: Array<{ name: string; body: unknown }>;
}

export function createMockCloudClient(opts: MockCloudOptions = {}): MockCloudClient {
  const storage = new Map<string, Uint8Array>();
  const uploadAttempts = new Map<string, number>();
  const edgeFunctionCalls: Array<{ name: string; body: unknown }> = [];
  let session: AuthSession | null = opts.initialSession ?? null;
  let online = !opts.simulateOffline;
  let quotaExceeded = !!opts.simulateQuotaExceeded;
  let failUpload = opts.failUploadFor ?? null;
  const authListeners = new Set<(s: AuthSession | null) => void>();

  function notifyAuth() {
    for (const fn of authListeners) fn(session);
  }

  return {
    storage,
    edgeFunctionCalls,

    setSession(s) { session = s; notifyAuth(); },
    getUploadAttempts(key) { return uploadAttempts.get(key) ?? 0; },
    setOnline(o) { online = o; },
    setQuotaExceeded(q) { quotaExceeded = q; },
    setFailUpload(fn) { failUpload = fn; },

    async uploadObject(key, bytes) {
      if (!online) throw new Error('offline');
      if (quotaExceeded) throw new Error('quota_exceeded');
      const attempt = (uploadAttempts.get(key) ?? 0) + 1;
      uploadAttempts.set(key, attempt);
      if (failUpload && failUpload(key, attempt)) throw new Error('upload_failed');
      storage.set(key, bytes);
    },

    async downloadObject(key) {
      if (!online) throw new Error('offline');
      const bytes = storage.get(key);
      if (!bytes) throw new Error(`not_found:${key}`);
      return bytes;
    },

    async objectExists(key) {
      if (!online) throw new Error('offline');
      return storage.has(key);
    },

    async listPrefix(prefix) {
      if (!online) throw new Error('offline');
      return Array.from(storage.keys()).filter((k) => k.startsWith(prefix));
    },

    async deleteObject(key) {
      if (!online) throw new Error('offline');
      storage.delete(key);
    },

    async deletePrefix(prefix) {
      if (!online) throw new Error('offline');
      for (const key of Array.from(storage.keys())) {
        if (key.startsWith(prefix)) storage.delete(key);
      }
    },

    async getSession() { return session; },
    getCurrentUserId() { return session?.user_id ?? null; },

    async signInWithProvider(_provider: AuthProvider) {
      const s: AuthSession = {
        user_id: 'mock-user-' + _provider,
        email: `mock+${_provider}@example.test`,
        access_token: 'mock-access',
        refresh_token: 'mock-refresh',
        expires_at: Date.now() + 3600_000,
      };
      session = s;
      notifyAuth();
      return s;
    },

    async signInWithMagicLink(email) {
      const s: AuthSession = {
        user_id: 'mock-user-email-' + email,
        email,
        access_token: 'mock-access',
        refresh_token: 'mock-refresh',
        expires_at: Date.now() + 3600_000,
      };
      session = s;
      notifyAuth();
    },

    async signOut() {
      session = null;
      notifyAuth();
    },

    async callEdgeFunction(name, body) {
      edgeFunctionCalls.push({ name, body });
      if (name === 'delete-account') {
        const uid = session?.user_id;
        if (uid) {
          for (const key of Array.from(storage.keys())) {
            if (key.startsWith(`${uid}/`)) storage.delete(key);
          }
          session = null;
          notifyAuth();
        }
        return {} as never;
      }
      return {} as never;
    },

    onAuthStateChange(callback) {
      authListeners.add(callback);
      return () => { authListeners.delete(callback); };
    },

    async isOnline() { return online; },
  };
}
