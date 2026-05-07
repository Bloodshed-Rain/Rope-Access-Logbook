// __tests__/cloudMock.ts
import { CloudClient, AuthProvider } from '../src/cloud/cloudClient';
import {
  AuthSession,
  GearCatalogEntry,
  SupervisorConnection,
  SignRequest,
  SupervisorDirectoryEntry,
} from '../src/types';

function maskCert(cert: string): string {
  if (cert.length <= 4) return cert;
  return cert.slice(0, 2) + '-***' + cert.slice(-2);
}

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
  // --- New for supervisor accounts ---
  readonly connections: Map<string, SupervisorConnection>;
  readonly requests: Map<string, SignRequest>;
  readonly directory: Map<string, SupervisorDirectoryEntry>;
  /** Test-only: set another user's directory entry directly (simulating a different session). */
  setDirectoryEntry(entry: SupervisorDirectoryEntry): void;
  /** Test-only: switch the active session. Used by round-trip tests that act as tech then supervisor. */
  actAs(session: AuthSession): void;
  /** Test-only: seed catalog rows. */
  setGearCatalog(items: GearCatalogEntry[]): void;
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

  // --- Supervisor accounts in-memory tables ---
  type MockConnRow = SupervisorConnection;
  type MockReqRow = SignRequest;

  const connections = new Map<string, MockConnRow>();
  const requests = new Map<string, MockReqRow>();
  const directory = new Map<string, SupervisorDirectoryEntry>();
  const gearCatalog: GearCatalogEntry[] = [];
  const connListeners = new Set<(r: SupervisorConnection) => void>();
  const reqListeners = new Set<(r: SignRequest) => void>();

  function requireAuth(): string {
    if (!session) throw new Error('not_authenticated');
    return session.user_id;
  }

  function genId(): string {
    return `mock_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  let monotonicMs = Date.now();
  function nowIso(): string {
    const now = Date.now();
    monotonicMs = Math.max(monotonicMs + 1, now);
    return new Date(monotonicMs).toISOString();
  }

  function fireConn(row: MockConnRow) {
    for (const fn of connListeners) fn({ ...row });
  }
  function fireReq(row: MockReqRow) {
    for (const fn of reqListeners) fn({ ...row });
  }

  function withinCooldown(row: MockConnRow): boolean {
    if (row.status !== 'declined' || !row.declined_at) return false;
    const declined = Date.parse(row.declined_at);
    return (Date.now() - declined) < 30 * 24 * 60 * 60 * 1000;
  }

  // Internal upload that bypasses the need for `this` binding, so that
  // `sendSignRequest` / `signRequest` can push bytes into storage without
  // depending on the returned object's own method dispatch.
  async function uploadObjectInternal(key: string, bytes: Uint8Array): Promise<void> {
    if (!online) throw new Error('offline');
    if (quotaExceeded) throw new Error('quota_exceeded');
    const attempt = (uploadAttempts.get(key) ?? 0) + 1;
    uploadAttempts.set(key, attempt);
    if (failUpload && failUpload(key, attempt)) throw new Error('upload_failed');
    storage.set(key, bytes);
  }

  return {
    storage,
    edgeFunctionCalls,
    connections,
    requests,
    directory,

    setSession(s) { session = s; notifyAuth(); },
    getUploadAttempts(key) { return uploadAttempts.get(key) ?? 0; },
    setOnline(o) { online = o; },
    setQuotaExceeded(q) { quotaExceeded = q; },
    setFailUpload(fn) { failUpload = fn; },
    setDirectoryEntry(entry) { directory.set(entry.user_id, { ...entry }); },
    actAs(s: AuthSession) { session = s; notifyAuth(); },

    async uploadObject(key, bytes) {
      return uploadObjectInternal(key, bytes);
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

    async exchangeAuthCode(code: string) {
      const s: AuthSession = {
        user_id: 'mock-user-code-' + code,
        email: 'mock@example.test',
        access_token: 'mock-access',
        refresh_token: 'mock-refresh',
        expires_at: Date.now() + 3600_000,
      };
      session = s;
      notifyAuth();
      return s;
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
          // Flip in-flight sign requests to terminal states
          for (const [id, r] of requests.entries()) {
            if (r.tech_user_id === uid && r.status === 'pending') {
              requests.set(id, { ...r, status: 'withdrawn', updated_at: nowIso() });
            }
            if (r.supervisor_user_id === uid && r.status === 'pending') {
              requests.set(id, { ...r, status: 'declined', decline_reason: 'Supervisor account deleted', updated_at: nowIso() });
            }
          }
          // Clean up sign-request storage assets
          for (const [id, r] of requests.entries()) {
            if (r.tech_user_id === uid || r.supervisor_user_id === uid) {
              const prefix = `sign-requests/${id}/`;
              for (const key of Array.from(storage.keys())) {
                if (key.startsWith(prefix)) storage.delete(key);
              }
            }
          }
          // Delete supervisor directory entry
          directory.delete(uid);
          // Delete logbook-backups storage
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

    // --- Supervisor connections ---
    async listSupervisorConnections(sinceUpdatedAt) {
      const uid = requireAuth();
      return [...connections.values()]
        .filter(r => r.tech_user_id === uid || r.supervisor_user_id === uid)
        .filter(r => !sinceUpdatedAt || r.updated_at > sinceUpdatedAt)
        .map(r => ({ ...r }));
    },

    async inviteSupervisorByEmail(email) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const id = genId();
      const row: MockConnRow = {
        id,
        tech_user_id: uid,
        supervisor_user_id: null,
        status: 'pending',
        invited_email: email.toLowerCase(),
        supervisor_display_name: null,
        declined_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      connections.set(id, row);
      edgeFunctionCalls.push({ name: 'invite-supervisor', body: { email } });
      fireConn(row);
      return { ...row };
    },

    async inviteSupervisorByUserId(supervisorUserId, invitedEmail) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      if (supervisorUserId === uid) throw new Error('cannot_invite_self');
      for (const r of connections.values()) {
        if (r.tech_user_id === uid && r.supervisor_user_id === supervisorUserId && withinCooldown(r)) {
          throw new Error('cooldown_active');
        }
      }
      const id = genId();
      const row: MockConnRow = {
        id,
        tech_user_id: uid,
        supervisor_user_id: supervisorUserId,
        status: 'pending',
        invited_email: invitedEmail.toLowerCase(),
        supervisor_display_name: null,
        declined_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      connections.set(id, row);
      fireConn(row);
      return { ...row };
    },

    async respondToConnection(id, accept) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const row = connections.get(id);
      if (!row) throw new Error('not_found');
      if (row.supervisor_user_id !== uid) throw new Error('forbidden');
      if (row.status !== 'pending') throw new Error('invalid_state');
      const dir = directory.get(uid);
      const updated: MockConnRow = {
        ...row,
        status: accept ? 'accepted' : 'declined',
        supervisor_display_name: accept ? (dir?.display_name ?? row.supervisor_display_name) : row.supervisor_display_name,
        declined_at: accept ? null : nowIso(),
        updated_at: nowIso(),
      };
      connections.set(id, updated);
      fireConn(updated);
      return { ...updated };
    },

    async revokeConnection(id) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const row = connections.get(id);
      if (!row) throw new Error('not_found');
      if (row.tech_user_id !== uid && row.supervisor_user_id !== uid) throw new Error('forbidden');
      const updated: MockConnRow = { ...row, status: 'revoked', updated_at: nowIso() };
      connections.set(id, updated);
      fireConn(updated);
      return { ...updated };
    },

    async reinviteDeclinedConnection(id) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const row = connections.get(id);
      if (!row) throw new Error('not_found');
      if (row.tech_user_id !== uid) throw new Error('forbidden');
      if (row.status !== 'declined') throw new Error('invalid_state');
      if (withinCooldown(row)) throw new Error('cooldown_active');
      const updated: MockConnRow = { ...row, status: 'pending', declined_at: null, updated_at: nowIso() };
      connections.set(id, updated);
      fireConn(updated);
      return { ...updated };
    },

    subscribeConnections(cb) {
      connListeners.add(cb);
      return () => { connListeners.delete(cb); };
    },

    // --- Directory + search ---
    async upsertSupervisorDirectory(entry) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      directory.set(uid, { user_id: uid, ...entry, updated_at: nowIso() });
    },

    async deleteSupervisorDirectory() {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      directory.delete(uid);
    },

    async searchSupervisors(kind, query) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const rows = [...directory.values()].filter(d => d.visible && d.user_id !== uid);
      const q = query.trim();
      if (kind === 'sprat_id') {
        return rows
          .filter(d => d.sprat_cert_number === q)
          .slice(0, 10)
          .map(d => ({
            user_id: d.user_id,
            display_name: d.display_name,
            sprat_cert_number: d.sprat_cert_number,
            sprat_cert_number_is_masked: false,
          }));
      }
      if (kind === 'name') {
        if (q.length < 3) return [];
        const lower = q.toLowerCase();
        return rows
          .filter(d => d.display_name.toLowerCase().startsWith(lower))
          .slice(0, 10)
          .map(d => ({
            user_id: d.user_id,
            display_name: d.display_name,
            sprat_cert_number: maskCert(d.sprat_cert_number),
            sprat_cert_number_is_masked: true,
          }));
      }
      // email search: not supported in directory (invite flow goes via inviteSupervisorByEmail)
      return [];
    },

    // --- Sign requests ---
    async listSignRequests(sinceUpdatedAt) {
      const uid = requireAuth();
      return [...requests.values()]
        .filter(r => r.tech_user_id === uid || r.supervisor_user_id === uid)
        .filter(r => !sinceUpdatedAt || r.updated_at > sinceUpdatedAt)
        .map(r => ({ ...r }));
    },

    async sendSignRequest(input) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const conn = connections.get(input.connection_id);
      if (!conn || conn.tech_user_id !== uid || conn.status !== 'accepted') {
        throw new Error('connection_not_accepted');
      }
      for (const asset of input.asset_uploads) {
        await uploadObjectInternal(asset.key, asset.bytes);
      }
      const id = genId();
      const row: MockReqRow = {
        id,
        tech_user_id: uid,
        supervisor_user_id: input.supervisor_user_id,
        connection_id: input.connection_id,
        entry_payload: input.entry_payload as SignRequest['entry_payload'],
        assets_manifest: input.assets_manifest as SignRequest['assets_manifest'],
        status: 'pending',
        decline_reason: null,
        signature_png_path: null,
        supervisor_name_snapshot: null,
        supervisor_cert_number_snapshot: null,
        entry_hash: null,
        hash_version: null,
        signed_device_id: null,
        signed_gps_lat: null,
        signed_gps_lon: null,
        created_at: nowIso(),
        expires_at: input.expires_at,
        signed_at: null,
        updated_at: nowIso(),
      };
      requests.set(id, row);
      fireReq(row);
      return { ...row };
    },

    async signRequest(input) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const row = requests.get(input.request_id);
      if (!row) throw new Error('not_found');
      if (row.supervisor_user_id !== uid) throw new Error('forbidden');
      if (row.status !== 'pending') throw new Error('request_not_pending');
      const pngKey = `sign-requests/${row.id}/sig.png`;
      await uploadObjectInternal(pngKey, input.png_bytes);
      const updated: MockReqRow = {
        ...row,
        status: 'signed',
        signature_png_path: pngKey,
        supervisor_name_snapshot: input.supervisor_name,
        supervisor_cert_number_snapshot: input.supervisor_cert_number,
        entry_hash: input.entry_hash,
        hash_version: input.hash_version,
        signed_device_id: input.signed_device_id,
        signed_gps_lat: input.signed_gps_lat ?? null,
        signed_gps_lon: input.signed_gps_lon ?? null,
        signed_at: nowIso(),
        updated_at: nowIso(),
      };
      requests.set(row.id, updated);
      fireReq(updated);
      return { ...updated };
    },

    async declineRequest(id, reason) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const row = requests.get(id);
      if (!row) throw new Error('not_found');
      if (row.supervisor_user_id !== uid) throw new Error('forbidden');
      if (row.status !== 'pending') throw new Error('request_not_pending');
      const updated: MockReqRow = { ...row, status: 'declined', decline_reason: reason, updated_at: nowIso() };
      requests.set(id, updated);
      fireReq(updated);
      return { ...updated };
    },

    async withdrawRequest(id) {
      if (!online) throw new Error('offline');
      const uid = requireAuth();
      const row = requests.get(id);
      if (!row) throw new Error('not_found');
      if (row.tech_user_id !== uid) throw new Error('forbidden');
      if (row.status !== 'pending') throw new Error('request_not_pending');
      const updated: MockReqRow = { ...row, status: 'withdrawn', updated_at: nowIso() };
      requests.set(id, updated);
      fireReq(updated);
      return { ...updated };
    },

    subscribeSignRequests(cb) {
      reqListeners.add(cb);
      return () => { reqListeners.delete(cb); };
    },

    async downloadSignRequestAsset(bucketKey) {
      if (!online) throw new Error('offline');
      const fullKey = `sign-requests/${bucketKey}`;
      const bytes = storage.get(fullKey);
      if (!bytes) throw new Error(`not_found:${fullKey}`);
      return bytes;
    },

    async cleanupRequestAssets(requestId) {
      if (!online) throw new Error('offline');
      const prefix = `sign-requests/${requestId}/`;
      for (const key of Array.from(storage.keys())) {
        if (key.startsWith(prefix)) storage.delete(key);
      }
    },

    async registerPushToken(token) {
      if (!online) throw new Error('offline');
      // mock success
    },

    async unregisterPushToken() {
      if (!online) throw new Error('offline');
      // mock success
    },

    async notifySignRequest() {
      // No-op in tests: real push dispatch is exercised via manual QA only.
    },

    async listGearCatalog() {
      if (!online) throw new Error('offline');
      return gearCatalog.map((r) => ({ ...r }));
    },

    setGearCatalog(items: GearCatalogEntry[]) {
      gearCatalog.length = 0;
      gearCatalog.push(...items.map((r) => ({ ...r })));
    },
  };
}
