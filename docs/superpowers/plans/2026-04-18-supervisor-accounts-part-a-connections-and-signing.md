# Supervisor Accounts & Remote Signing — Implementation Plan (Part A: Connections + Signing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the end-to-end remote-signing feature per the design spec. By the final task the app supports: enabling supervisor capability, adding a supervisor via email / SPRAT ID / name, accepting connections, sending an entry for remote signature, the supervisor signing on their own device, and the signed signature landing on the tech's logbook. This plan is the client-demo milestone.

**Architecture:** Single account type with optional supervisor capability. Supabase Postgres (new) holds `supervisor_connections`, `sign_requests`, `supervisor_directory`; a new Storage bucket `sign-requests` holds per-request assets. The existing CloudClient interface is extended; the in-memory mock simulates both tables with realtime callbacks. Two new service-layer modules (`supervisorConnectionsService`, `signRequestsService`) sit on top. UI adds `InboxScreen`, `SignRequestDetailScreen`, `SupervisorSearchScreen` and extends `ProfileScreen`, `EntryFormScreen`, `EntryDetailScreen`, `LogbookScreen`, `RootNavigator`. Offline: reads from SQLite cache; writes fail fast with banner.

**Tech Stack:** Expo SDK (existing), expo-sqlite (existing), `@supabase/supabase-js` (existing, extended with Postgres client calls + realtime channels), better-sqlite3 for tests (existing), React Query hooks (existing pattern), `react-native-signature-canvas` (existing).

**Spec:** `docs/superpowers/specs/2026-04-18-supervisor-accounts-design.md`.

**What's NOT in this plan (deferred to Part B):**
- Edge Functions (`invite-supervisor`, `search-supervisors`, `cleanup-request-assets`). Part A uses direct Supabase client calls where possible and defers rate-limit/invite-email plumbing. The mock simulates these.
- `pg_cron` expiration + retention jobs. Expiration is exercised in tests by manually advancing the mock clock.
- `delete-account` cascade extension.
- Comprehensive anti-scraping (the 10-result cap is in; the 20-searches-per-day rate limit is deferred).

**Demo checkpoints inside this plan:**
- **After Task 19** — connection flow works end-to-end against the mock + manual QA with dev Supabase. User can invite, accept, decline, see cooldown.
- **After Task 35** — full remote sign flow works end-to-end. This is the client-demo point.

---

## File Structure

**New files (this plan):**

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260418_supervisor_accounts.sql` | Postgres schema (3 tables, RLS, signup trigger, partial unique indexes). Applied via `supabase db push`. |
| `src/services/supervisorConnectionsService.ts` | Service: invite/accept/decline/revoke, directory search, cooldown check, sync from server + cache. |
| `src/services/signRequestsService.ts` | Service: send/withdraw/sign/decline, `applyIncomingSignature`, sync from server + cache. |
| `src/hooks/useSupervisorConnections.ts` | React Query hook wrapping `supervisorConnectionsService`. |
| `src/hooks/useSupervisorSearch.ts` | Imperative search hook (returns `{ results, search }` for tabbed UI). |
| `src/hooks/useSignRequests.ts` | React Query hook wrapping `signRequestsService`. |
| `src/screens/InboxScreen.tsx` | Supervisor bottom-tab screen: pending connections, pending requests, sign history. |
| `src/screens/SignRequestDetailScreen.tsx` | Supervisor read-only entry view + sign/decline/close toolbar + inline signature canvas. |
| `src/screens/SupervisorSearchScreen.tsx` | Tech tabbed search: Email / SPRAT ID / Name. |
| `src/components/SupervisorsSection.tsx` | Profile subsection: capability toggle, cert number, directory visibility, connections list, "Add supervisor" button. |
| `__tests__/services/supervisorConnectionsService.test.ts` | Unit tests. |
| `__tests__/services/signRequestsService.test.ts` | Unit tests. |
| `__tests__/services/applyIncomingSignature.test.ts` | Unit tests for the catch-up path. |
| `__tests__/services/fullRemoteSignFlow.test.ts` | Integration-shaped unit test: two mock sessions, full round trip. |

**Modified files (this plan):**

| Path | Change |
|---|---|
| `src/types.ts` | Add `SupervisorConnection`, `SignRequest`, `SupervisorDirectoryEntry`, `SupervisorSearchKind`, `SupervisorSearchResult`, extended `Profile`, extended `EntryRow` / `Entry`. |
| `src/db/schema.ts` | Add new columns + two cache tables to canonical `SCHEMA_SQL`. |
| `src/db/migrations.ts` | Add idempotent ALTERs for new columns; create cache tables idempotently. |
| `src/cloud/cloudClient.ts` | Extend `CloudClient` interface with 14 new methods (see Task 3). |
| `src/cloud/supabaseClient.ts` | Implement new methods against Supabase (postgrest + realtime). |
| `__tests__/cloudMock.ts` | In-memory Postgres simulation with RLS filtering, status-transition guards, realtime callbacks. |
| `src/services/profileService.ts` | Add supervisor-capability fields and `enableSupervisorCapability` / `disableSupervisorCapability`. |
| `src/services/entriesService.ts` | `updateEntry` and `deleteEntry` throw when `pending_sign_request_id` is set. |
| `src/screens/ProfileScreen.tsx` | Mount `SupervisorsSection` above cloud section. |
| `src/screens/EntryFormScreen.tsx` | Add "Send for signature" action + supervisor picker; replace actions with "Awaiting [supervisor]" banner when locked. |
| `src/screens/EntryDetailScreen.tsx` | Pending/declined/expired banners. |
| `src/screens/LogbookScreen.tsx` | Row chip reflecting pending/declined/expired sign-request state. |
| `src/navigation/RootNavigator.tsx` | Conditional Inbox tab (when `supervisor_capability_enabled`); new stack screens `SignRequestDetail`, `SupervisorSearch`. |
| `App.tsx` | On `AppState` → `active`, trigger supervisor-accounts sync catch-up. |

---

## Phase 1 — Data model foundation (SQLite + types)

### Task 1: Extend types in `src/types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the new type declarations**

Append to `src/types.ts` (after the existing interfaces, before the `HashFn` type alias):

```ts
// --- Supervisor accounts ---

export type SupervisorConnectionStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export interface SupervisorConnection {
  id: string;
  tech_user_id: string;
  supervisor_user_id: string | null;   // null until email-invited supervisor signs up
  status: SupervisorConnectionStatus;
  invited_email: string;
  supervisor_display_name: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SignRequestStatus = 'pending' | 'signed' | 'declined' | 'withdrawn' | 'expired';

export interface SignRequestAssetManifestEntry {
  sha256: string;
  size_bytes: number;
}

export interface SignRequest {
  id: string;
  tech_user_id: string;
  supervisor_user_id: string;
  connection_id: string;
  entry_payload: Entry;                  // frozen snapshot
  assets_manifest: Record<string, SignRequestAssetManifestEntry>;
  status: SignRequestStatus;
  decline_reason: string | null;
  signature_png_path: string | null;     // storage key, set when signed
  supervisor_name_snapshot: string | null;
  supervisor_cert_number_snapshot: string | null;
  entry_hash: string | null;
  hash_version: number | null;
  signed_device_id: string | null;
  signed_gps_lat: number | null;
  signed_gps_lon: number | null;
  created_at: string;
  expires_at: string;
  signed_at: string | null;
  updated_at: string;
}

export interface SupervisorDirectoryEntry {
  user_id: string;
  display_name: string;
  sprat_cert_number: string;
  visible: boolean;
  updated_at: string;
}

export type SupervisorSearchKind = 'email' | 'sprat_id' | 'name';

export interface SupervisorSearchResult {
  user_id: string;
  display_name: string;
  sprat_cert_number: string;             // masked on name search, full on sprat_id search
  sprat_cert_number_is_masked: boolean;
}
```

Extend `Profile`:

```ts
export interface Profile {
  // ... existing fields ...
  supervisor_capability_enabled: boolean;
  supervisor_cert_number: string | null;
  supervisor_directory_visible: boolean;
}
```

Extend `Entry` and `EntryRow`:

```ts
export interface Entry {
  // ... existing fields ...
  pending_sign_request_id: string | null;
}

export interface EntryRow {
  // ... existing fields ...
  pending_sign_request_id: string | null;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors from downstream code not yet updated (services, hooks, screens). OK — each downstream task fixes its own call sites. Any error MENTIONING `supervisor_capability_enabled`, `pending_sign_request_id`, or the new interfaces is expected; unrelated errors are bugs.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): supervisor accounts interfaces"
```

---

### Task 2: SQLite schema + migrations for the new columns and cache tables

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrations.ts`
- Test: `__tests__/db/migrationsSupervisor.test.ts` (new)

- [ ] **Step 1: Add new columns and cache tables to the canonical schema**

Edit `src/db/schema.ts`. Extend `profile` with three columns and `entries` with one, then append two new `CREATE TABLE IF NOT EXISTS` statements.

Replace the existing `profile` table block with:

```sql
CREATE TABLE IF NOT EXISTS profile (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  sprat_id TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('I', 'II', 'III')),
  cert_expires_on TEXT NOT NULL,
  default_employer TEXT NOT NULL DEFAULT '',
  sprat_card_photo_path TEXT,
  last_backup_at TEXT,
  photos_in_backup INTEGER NOT NULL DEFAULT 0,
  last_cloud_backup_at TEXT,
  last_uploaded_backup_id TEXT,
  supervisor_capability_enabled INTEGER NOT NULL DEFAULT 0,
  supervisor_cert_number TEXT,
  supervisor_directory_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add `pending_sign_request_id TEXT` to the `entries` table (after `amendment_reason`).

Add, after the existing index block:

```sql
CREATE TABLE IF NOT EXISTS supervisor_connections_cache (
  id TEXT PRIMARY KEY,
  tech_user_id TEXT NOT NULL,
  supervisor_user_id TEXT,
  status TEXT NOT NULL,
  invited_email TEXT NOT NULL,
  supervisor_display_name TEXT,
  declined_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_requests_cache (
  id TEXT PRIMARY KEY,
  tech_user_id TEXT NOT NULL,
  supervisor_user_id TEXT NOT NULL,
  entry_id TEXT,
  status TEXT NOT NULL,
  decline_reason TEXT,
  signed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entries_pending_sign_request ON entries(pending_sign_request_id);
CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_status ON sign_requests_cache(status);
CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_entry ON sign_requests_cache(entry_id);
```

- [ ] **Step 2: Add idempotent ALTERs to `migrations.ts`**

Extend `runSchemaMigrations` in `src/db/migrations.ts` (after the existing ALTERs):

```ts
if (!(await hasColumn(db, 'profile', 'supervisor_capability_enabled'))) {
  await db.exec('ALTER TABLE profile ADD COLUMN supervisor_capability_enabled INTEGER NOT NULL DEFAULT 0');
}
if (!(await hasColumn(db, 'profile', 'supervisor_cert_number'))) {
  await db.exec('ALTER TABLE profile ADD COLUMN supervisor_cert_number TEXT');
}
if (!(await hasColumn(db, 'profile', 'supervisor_directory_visible'))) {
  await db.exec('ALTER TABLE profile ADD COLUMN supervisor_directory_visible INTEGER NOT NULL DEFAULT 1');
}
if (!(await hasColumn(db, 'entries', 'pending_sign_request_id'))) {
  await db.exec('ALTER TABLE entries ADD COLUMN pending_sign_request_id TEXT');
}

// Cache tables — idempotent create
await db.exec(`
  CREATE TABLE IF NOT EXISTS supervisor_connections_cache (
    id TEXT PRIMARY KEY,
    tech_user_id TEXT NOT NULL,
    supervisor_user_id TEXT,
    status TEXT NOT NULL,
    invited_email TEXT NOT NULL,
    supervisor_display_name TEXT,
    declined_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
await db.exec(`
  CREATE TABLE IF NOT EXISTS sign_requests_cache (
    id TEXT PRIMARY KEY,
    tech_user_id TEXT NOT NULL,
    supervisor_user_id TEXT NOT NULL,
    entry_id TEXT,
    status TEXT NOT NULL,
    decline_reason TEXT,
    signed_at TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_pending_sign_request ON entries(pending_sign_request_id);`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_status ON sign_requests_cache(status);`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_entry ON sign_requests_cache(entry_id);`);
```

- [ ] **Step 3: Write migration test**

Create `__tests__/db/migrationsSupervisor.test.ts`:

```ts
import { createTestClient, createLegacyTestClient } from '../setup';
import { runSchemaMigrations } from '../../src/db/migrations';

describe('supervisor-accounts migrations', () => {
  test('adds new profile columns on legacy DB', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>("PRAGMA table_info(profile)");
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'supervisor_capability_enabled',
      'supervisor_cert_number',
      'supervisor_directory_visible',
    ]));
  });

  test('adds pending_sign_request_id to entries on legacy DB', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>("PRAGMA table_info(entries)");
    expect(cols.map(c => c.name)).toContain('pending_sign_request_id');
  });

  test('creates supervisor_connections_cache and sign_requests_cache', async () => {
    const db = await createTestClient();
    const tables = await db.getAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const names = tables.map(t => t.name);
    expect(names).toContain('supervisor_connections_cache');
    expect(names).toContain('sign_requests_cache');
  });

  test('migrations are idempotent', async () => {
    const db = await createTestClient();
    // createTestClient already ran once; run again should not throw
    await runSchemaMigrations(db);
    await runSchemaMigrations(db);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx jest __tests__/db/migrationsSupervisor.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Run the full suite to ensure no regressions**

Run: `npx jest`
Expected: existing tests still pass; 4 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts __tests__/db/migrationsSupervisor.test.ts
git commit -m "feat(db): schema for supervisor accounts and sign requests"
```

---

## Phase 2 — CloudClient interface + mock

### Task 3: Extend `CloudClient` interface

**Files:**
- Modify: `src/cloud/cloudClient.ts`

- [ ] **Step 1: Append the new interface surface**

Append to `src/cloud/cloudClient.ts`:

```ts
import {
  SupervisorConnection,
  SignRequest,
  SupervisorSearchKind,
  SupervisorSearchResult,
} from '../types';

export interface SignRequestSignInput {
  request_id: string;
  png_bytes: Uint8Array;
  supervisor_name: string;
  supervisor_cert_number: string;
  entry_hash: string;
  hash_version: number;
  signed_device_id: string;
  signed_gps_lat?: number;
  signed_gps_lon?: number;
}

export interface SendSignRequestInput {
  connection_id: string;
  supervisor_user_id: string;
  entry_payload: unknown;           // Entry — serialized as jsonb
  assets_manifest: unknown;         // Record<string, {sha256,size_bytes}>
  asset_uploads: Array<{ key: string; bytes: Uint8Array }>;   // uploaded before the row insert
  expires_at: string;               // ISO, typically now + 30d
}

export interface SupervisorDirectoryUpsert {
  display_name: string;
  sprat_cert_number: string;
  visible: boolean;
}

export interface CloudClient {
  // ... existing methods ...

  // Supervisor connections
  listSupervisorConnections(sinceUpdatedAt?: string): Promise<SupervisorConnection[]>;
  inviteSupervisorByEmail(email: string): Promise<SupervisorConnection>;
  inviteSupervisorByUserId(supervisorUserId: string, invitedEmail: string): Promise<SupervisorConnection>;
  respondToConnection(id: string, accept: boolean): Promise<SupervisorConnection>;
  revokeConnection(id: string): Promise<SupervisorConnection>;
  reinviteDeclinedConnection(id: string): Promise<SupervisorConnection>;
  subscribeConnections(callback: (row: SupervisorConnection) => void): () => void;

  // Directory + search
  upsertSupervisorDirectory(entry: SupervisorDirectoryUpsert): Promise<void>;
  deleteSupervisorDirectory(): Promise<void>;
  searchSupervisors(kind: SupervisorSearchKind, query: string): Promise<SupervisorSearchResult[]>;

  // Sign requests
  listSignRequests(sinceUpdatedAt?: string): Promise<SignRequest[]>;
  sendSignRequest(input: SendSignRequestInput): Promise<SignRequest>;
  signRequest(input: SignRequestSignInput): Promise<SignRequest>;
  declineRequest(id: string, reason: string): Promise<SignRequest>;
  withdrawRequest(id: string): Promise<SignRequest>;
  subscribeSignRequests(callback: (row: SignRequest) => void): () => void;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors come from `supabaseClient.ts` and `__tests__/cloudMock.ts` — both fail to implement new methods. Fixed in Tasks 4 and 5.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/cloudClient.ts
git commit -m "feat(cloud): extend CloudClient for supervisor accounts"
```

---

### Task 4: Extend the mock CloudClient with in-memory Postgres

**Files:**
- Modify: `__tests__/cloudMock.ts`

- [ ] **Step 1: Add in-memory tables and helpers**

Inside `createMockCloudClient` in `__tests__/cloudMock.ts`, before the `return { ... }` block, add:

```ts
// --- Supervisor accounts in-memory tables ---
interface MockConnRow extends SupervisorConnection {}
interface MockReqRow extends SignRequest {}
interface MockDirRow {
  user_id: string;
  display_name: string;
  sprat_cert_number: string;
  visible: boolean;
  updated_at: string;
}

const connections = new Map<string, MockConnRow>();
const requests = new Map<string, MockReqRow>();
const directory = new Map<string, MockDirRow>();
const connListeners = new Set<(r: SupervisorConnection) => void>();
const reqListeners = new Set<(r: SignRequest) => void>();

function requireAuth(): string {
  if (!session) throw new Error('not_authenticated');
  return session.user_id;
}

function genId(): string {
  // deterministic-ish; tests can rely on ordering
  return `mock_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function fireConn(row: MockConnRow) {
  for (const fn of connListeners) fn({ ...row });
}
function fireReq(row: MockReqRow) {
  for (const fn of reqListeners) fn({ ...row });
}

// Cooldown helper
function withinCooldown(row: MockConnRow): boolean {
  if (row.status !== 'declined' || !row.declined_at) return false;
  const declined = Date.parse(row.declined_at);
  return (Date.now() - declined) < 30 * 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 2: Implement connection methods**

Add to the returned object:

```ts
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
  // Look up directory by a side channel: in the mock, we key by email via a parallel map
  // maintained in the session setup. For this simple mock we assume email-based invites
  // always produce a connection with null supervisor_user_id (unregistered path).
  // Registered lookups go through inviteSupervisorByUserId after a search.
  const id = genId();
  const row: MockConnRow = {
    id, tech_user_id: uid, supervisor_user_id: null, status: 'pending',
    invited_email: email.toLowerCase(), supervisor_display_name: null,
    declined_at: null, created_at: nowIso(), updated_at: nowIso(),
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
  // Enforce cooldown via existing row lookup
  for (const r of connections.values()) {
    if (r.tech_user_id === uid && r.supervisor_user_id === supervisorUserId && withinCooldown(r)) {
      throw new Error('cooldown_active');
    }
  }
  const id = genId();
  const row: MockConnRow = {
    id, tech_user_id: uid, supervisor_user_id: supervisorUserId, status: 'pending',
    invited_email: invitedEmail.toLowerCase(), supervisor_display_name: null,
    declined_at: null, created_at: nowIso(), updated_at: nowIso(),
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
  return () => connListeners.delete(cb);
},
```

- [ ] **Step 3: Implement directory + search**

```ts
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
        user_id: d.user_id, display_name: d.display_name,
        sprat_cert_number: d.sprat_cert_number, sprat_cert_number_is_masked: false,
      }));
  }
  if (kind === 'name') {
    if (q.length < 3) return [];
    const lower = q.toLowerCase();
    return rows
      .filter(d => d.display_name.toLowerCase().startsWith(lower))
      .slice(0, 10)
      .map(d => ({
        user_id: d.user_id, display_name: d.display_name,
        sprat_cert_number: maskCert(d.sprat_cert_number), sprat_cert_number_is_masked: true,
      }));
  }
  // email search: not supported in directory (invite flow goes via inviteSupervisorByEmail)
  return [];
},
```

Add a helper at module scope (above `createMockCloudClient`):

```ts
function maskCert(cert: string): string {
  if (cert.length <= 4) return cert;
  return cert.slice(0, 2) + '-***' + cert.slice(-2);
}
```

- [ ] **Step 4: Implement sign-request methods**

```ts
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
  // Verify accepted connection
  const conn = connections.get(input.connection_id);
  if (!conn || conn.tech_user_id !== uid || conn.status !== 'accepted') {
    throw new Error('connection_not_accepted');
  }
  // Upload assets via uploadObject so they land in mock storage
  for (const asset of input.asset_uploads) {
    await this.uploadObject(asset.key, asset.bytes);
  }
  const id = genId();
  const row: MockReqRow = {
    id,
    tech_user_id: uid,
    supervisor_user_id: input.supervisor_user_id,
    connection_id: input.connection_id,
    entry_payload: input.entry_payload as any,
    assets_manifest: input.assets_manifest as any,
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
  // Upload PNG
  const pngKey = `sign-requests/${row.id}/sig.png`;
  await this.uploadObject(pngKey, input.png_bytes);
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
  return () => reqListeners.delete(cb);
},
```

- [ ] **Step 5: Expose a couple of test-only hooks on the mock**

Extend `MockCloudClient` interface with:

```ts
export interface MockCloudClient extends CloudClient {
  // ... existing ...
  readonly connections: Map<string, SupervisorConnection>;
  readonly requests: Map<string, SignRequest>;
  readonly directory: Map<string, SupervisorDirectoryEntry>;
  // Test-only: set another user's directory entry directly (simulating they've
  // already enabled supervisor capability in a different session).
  setDirectoryEntry(entry: SupervisorDirectoryEntry): void;
  // Test-only: set another user's session before running an action as them.
  // Used by full-round-trip tests.
  actAs(session: AuthSession): void;
}
```

Expose in the return:

```ts
connections,
requests,
directory,
setDirectoryEntry(entry) { directory.set(entry.user_id, { ...entry }); },
actAs(s) { session = s; notifyAuth(); },
```

- [ ] **Step 6: Type-check and run existing tests**

Run: `npx tsc --noEmit && npx jest`
Expected: all existing tests still pass (new methods are additive). Type errors possible in `supabaseClient.ts` which we handle next.

- [ ] **Step 7: Commit**

```bash
git add __tests__/cloudMock.ts src/cloud/cloudClient.ts
git commit -m "feat(cloud): in-memory mock for supervisor accounts"
```

---

### Task 5: Stub `supabaseClient.ts` implementations (no-op / throw)

**Files:**
- Modify: `src/cloud/supabaseClient.ts`

For Part A, the Supabase implementation can be stubbed (throw `not_implemented`) so typechecking passes. The mock covers all unit tests; real Supabase implementation is filled in at the end of this plan (Task 36). This avoids having to maintain two parallel implementations during the early tasks.

- [ ] **Step 1: Add stubs for all new CloudClient methods**

In `src/cloud/supabaseClient.ts`, inside `createSupabaseCloudClient()`'s returned object:

```ts
async listSupervisorConnections() { throw new Error('not_implemented'); },
async inviteSupervisorByEmail() { throw new Error('not_implemented'); },
async inviteSupervisorByUserId() { throw new Error('not_implemented'); },
async respondToConnection() { throw new Error('not_implemented'); },
async revokeConnection() { throw new Error('not_implemented'); },
async reinviteDeclinedConnection() { throw new Error('not_implemented'); },
subscribeConnections() { return () => {}; },
async upsertSupervisorDirectory() { throw new Error('not_implemented'); },
async deleteSupervisorDirectory() { throw new Error('not_implemented'); },
async searchSupervisors() { throw new Error('not_implemented'); },
async listSignRequests() { throw new Error('not_implemented'); },
async sendSignRequest() { throw new Error('not_implemented'); },
async signRequest() { throw new Error('not_implemented'); },
async declineRequest() { throw new Error('not_implemented'); },
async withdrawRequest() { throw new Error('not_implemented'); },
subscribeSignRequests() { return () => {}; },
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/supabaseClient.ts
git commit -m "chore(cloud): stub supabase impl of supervisor-accounts methods"
```

---

## Phase 3 — Connection service + directory + profile wiring

### Task 6: `supervisorConnectionsService.ts` scaffolding + test file

**Files:**
- Create: `src/services/supervisorConnectionsService.ts`
- Create: `__tests__/services/supervisorConnectionsService.test.ts`

- [ ] **Step 1: Create the service file with all signatures**

Create `src/services/supervisorConnectionsService.ts`:

```ts
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import {
  SupervisorConnection,
  SupervisorSearchKind,
  SupervisorSearchResult,
} from '../types';

type Clock = () => string;

export function createSupervisorConnectionsService(
  db: DbClient,
  cloud: CloudClient,
  clock: Clock = () => new Date().toISOString(),
) {
  async function cacheRow(row: SupervisorConnection): Promise<void> {
    await db.run(
      `INSERT OR REPLACE INTO supervisor_connections_cache
         (id, tech_user_id, supervisor_user_id, status, invited_email,
          supervisor_display_name, declined_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        row.id, row.tech_user_id, row.supervisor_user_id, row.status,
        row.invited_email, row.supervisor_display_name, row.declined_at,
        row.created_at, row.updated_at,
      ],
    );
  }

  async function getLastSyncedAt(): Promise<string | undefined> {
    const r = await db.get<{ max: string | null }>(
      'SELECT MAX(updated_at) as max FROM supervisor_connections_cache',
    );
    return r?.max ?? undefined;
  }

  return {
    async sync(): Promise<void> {
      const since = await getLastSyncedAt();
      const rows = await cloud.listSupervisorConnections(since);
      for (const r of rows) await cacheRow(r);
    },

    async listCached(): Promise<SupervisorConnection[]> {
      const rows = await db.getAll<SupervisorConnection>(
        'SELECT * FROM supervisor_connections_cache ORDER BY created_at DESC',
      );
      return rows;
    },

    async inviteByEmail(email: string): Promise<SupervisorConnection> {
      const row = await cloud.inviteSupervisorByEmail(email);
      await cacheRow(row);
      return row;
    },

    async inviteByDirectoryResult(result: SupervisorSearchResult, invitedEmail: string): Promise<SupervisorConnection> {
      const row = await cloud.inviteSupervisorByUserId(result.user_id, invitedEmail);
      await cacheRow(row);
      return row;
    },

    async accept(id: string): Promise<SupervisorConnection> {
      const row = await cloud.respondToConnection(id, true);
      await cacheRow(row);
      return row;
    },

    async decline(id: string): Promise<SupervisorConnection> {
      const row = await cloud.respondToConnection(id, false);
      await cacheRow(row);
      return row;
    },

    async revoke(id: string): Promise<SupervisorConnection> {
      const row = await cloud.revokeConnection(id);
      await cacheRow(row);
      return row;
    },

    async reinvite(id: string): Promise<SupervisorConnection> {
      const row = await cloud.reinviteDeclinedConnection(id);
      await cacheRow(row);
      return row;
    },

    async search(kind: SupervisorSearchKind, query: string): Promise<SupervisorSearchResult[]> {
      return cloud.searchSupervisors(kind, query);
    },
  };
}
```

- [ ] **Step 2: Create the test file with setup boilerplate**

Create `__tests__/services/supervisorConnectionsService.test.ts`:

```ts
import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createSupervisorConnectionsService } from '../../src/services/supervisorConnectionsService';
import { AuthSession } from '../../src/types';

const techSession: AuthSession = { user_id: 'tech-1', email: 'tech@example.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };
const supSession: AuthSession = { user_id: 'sup-1', email: 'sup@example.com', access_token: 't2', refresh_token: 'r2', expires_at: Date.now() + 3600_000 };

async function setup() {
  const db = await createTestClient();
  const cloud = createMockCloudClient({ initialSession: techSession });
  const service = createSupervisorConnectionsService(db, cloud);
  return { db, cloud, service };
}

test('placeholder — scaffolding only', async () => {
  const { service } = await setup();
  expect(await service.listCached()).toEqual([]);
});
```

- [ ] **Step 3: Run test**

Run: `npx jest __tests__/services/supervisorConnectionsService.test.ts`
Expected: 1 passes.

- [ ] **Step 4: Commit**

```bash
git add src/services/supervisorConnectionsService.ts __tests__/services/supervisorConnectionsService.test.ts
git commit -m "feat(service): scaffolding for supervisorConnectionsService"
```

---

### Task 7: Test + verify `inviteByEmail`, sync, and cache behavior

**Files:**
- Modify: `__tests__/services/supervisorConnectionsService.test.ts`

- [ ] **Step 1: Replace the placeholder with real tests**

Replace the placeholder test block with:

```ts
test('inviteByEmail creates a pending row, caches it, and surfaces via listCached', async () => {
  const { service, cloud } = await setup();
  const row = await service.inviteByEmail('newboss@example.com');
  expect(row.status).toBe('pending');
  expect(row.supervisor_user_id).toBeNull();
  expect(row.invited_email).toBe('newboss@example.com');
  expect(cloud.edgeFunctionCalls).toContainEqual({ name: 'invite-supervisor', body: { email: 'newboss@example.com' } });
  const cached = await service.listCached();
  expect(cached).toHaveLength(1);
  expect(cached[0].id).toBe(row.id);
});

test('sync pulls rows from the cloud into the local cache', async () => {
  const { service, cloud } = await setup();
  // Seed a second row directly in the mock, as if another device had inserted it.
  cloud.connections.set('remote-1', {
    id: 'remote-1', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-1',
    status: 'accepted', invited_email: 'boss@example.com',
    supervisor_display_name: 'Boss', declined_at: null,
    created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
  });
  await service.sync();
  const cached = await service.listCached();
  expect(cached.map(c => c.id)).toContain('remote-1');
});

test('accept flips status to accepted', async () => {
  const { service, cloud } = await setup();
  // Supervisor invites themselves first from tech side (we still simulate as tech)
  cloud.connections.set('c1', {
    id: 'c1', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'pending', invited_email: 'sup@example.com', supervisor_display_name: null,
    declined_at: null, created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
  });
  cloud.setDirectoryEntry({
    user_id: supSession.user_id, display_name: 'Sup Name',
    sprat_cert_number: 'L3-00001', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  cloud.actAs(supSession);
  const row = await service.accept('c1');
  expect(row.status).toBe('accepted');
  expect(row.supervisor_display_name).toBe('Sup Name');
});

test('decline sets declined_at', async () => {
  const { service, cloud } = await setup();
  cloud.connections.set('c2', {
    id: 'c2', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'pending', invited_email: 'sup@example.com', supervisor_display_name: null,
    declined_at: null, created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
  });
  cloud.actAs(supSession);
  const row = await service.decline('c2');
  expect(row.status).toBe('declined');
  expect(row.declined_at).toBeTruthy();
});
```

- [ ] **Step 2: Run**

Run: `npx jest __tests__/services/supervisorConnectionsService.test.ts`
Expected: 4 pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/supervisorConnectionsService.test.ts
git commit -m "test(service): invite, sync, accept, decline"
```

---

### Task 8: Test + verify `search`, cooldown, and reinvite

**Files:**
- Modify: `__tests__/services/supervisorConnectionsService.test.ts`

- [ ] **Step 1: Append tests**

Append to the test file:

```ts
test('search by SPRAT ID returns unmasked cert', async () => {
  const { service, cloud } = await setup();
  cloud.setDirectoryEntry({
    user_id: 'other-sup', display_name: 'Jim Target',
    sprat_cert_number: 'L3-12345', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  const results = await service.search('sprat_id', 'L3-12345');
  expect(results).toHaveLength(1);
  expect(results[0].sprat_cert_number).toBe('L3-12345');
  expect(results[0].sprat_cert_number_is_masked).toBe(false);
});

test('search by name returns masked cert when >= 3 chars prefix', async () => {
  const { service, cloud } = await setup();
  cloud.setDirectoryEntry({
    user_id: 'sup-a', display_name: 'Alicia Ford',
    sprat_cert_number: 'L3-99999', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  const results = await service.search('name', 'ali');
  expect(results).toHaveLength(1);
  expect(results[0].sprat_cert_number_is_masked).toBe(true);
  expect(results[0].sprat_cert_number).toBe('L3-***99');
});

test('search by name returns empty with < 3 chars', async () => {
  const { service, cloud } = await setup();
  cloud.setDirectoryEntry({
    user_id: 'sup-a', display_name: 'Alicia',
    sprat_cert_number: 'L3-99999', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  expect(await service.search('name', 'al')).toEqual([]);
});

test('cannot reinvite within 30-day cooldown; can after', async () => {
  const { service, cloud } = await setup();
  // Seed a declined row dated 10 days ago
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600_000).toISOString();
  cloud.connections.set('c3', {
    id: 'c3', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-2',
    status: 'declined', invited_email: 'sup2@example.com',
    supervisor_display_name: null, declined_at: tenDaysAgo,
    created_at: tenDaysAgo, updated_at: tenDaysAgo,
  });
  await expect(service.reinvite('c3')).rejects.toThrow('cooldown_active');

  // Seed another declined row dated 31 days ago — should succeed
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 3600_000).toISOString();
  cloud.connections.set('c4', {
    id: 'c4', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-3',
    status: 'declined', invited_email: 'sup3@example.com',
    supervisor_display_name: null, declined_at: thirtyOneDaysAgo,
    created_at: thirtyOneDaysAgo, updated_at: thirtyOneDaysAgo,
  });
  const reinvited = await service.reinvite('c4');
  expect(reinvited.status).toBe('pending');
  expect(reinvited.declined_at).toBeNull();
});
```

- [ ] **Step 2: Run**

Run: `npx jest __tests__/services/supervisorConnectionsService.test.ts`
Expected: 8 pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/supervisorConnectionsService.test.ts
git commit -m "test(service): search and cooldown enforcement"
```

---

### Task 9: Extend `profileService.ts` with supervisor capability

**Files:**
- Modify: `src/services/profileService.ts`

- [ ] **Step 1: Open `src/services/profileService.ts` and extend the factory with two methods**

Add to the returned object:

```ts
async enableSupervisorCapability(certNumber: string, displayName: string, directoryVisible: boolean, cloud: CloudClient): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `UPDATE profile SET supervisor_capability_enabled = 1,
                         supervisor_cert_number = ?,
                         supervisor_directory_visible = ?,
                         updated_at = ? WHERE id = ?`,
    [certNumber, directoryVisible ? 1 : 0, now, PROFILE_SINGLETON_ID],
  );
  if (directoryVisible) {
    await cloud.upsertSupervisorDirectory({
      display_name: displayName,
      sprat_cert_number: certNumber,
      visible: true,
    });
  }
},

async disableSupervisorCapability(pendingRequestCount: number, cloud: CloudClient): Promise<void> {
  if (pendingRequestCount > 0) throw new Error('pending_requests_exist');
  const now = new Date().toISOString();
  await db.run(
    `UPDATE profile SET supervisor_capability_enabled = 0,
                         updated_at = ? WHERE id = ?`,
    [now, PROFILE_SINGLETON_ID],
  );
  await cloud.deleteSupervisorDirectory();
},
```

Import `CloudClient`:

```ts
import { CloudClient } from '../cloud/cloudClient';
```

(`PROFILE_SINGLETON_ID` is the existing constant in profileService; if it's called something else, use the existing idiom for profile-row lookups in this file.)

- [ ] **Step 2: Update `getProfile` SELECT to return the three new columns**

Look for the existing `getProfile` / `getAll` SQL. If it's `SELECT * FROM profile`, nothing to change. If it enumerates columns, add `supervisor_capability_enabled`, `supervisor_cert_number`, `supervisor_directory_visible`.

- [ ] **Step 3: Map INTEGER → boolean in the read path**

Wherever the profile row is returned to the domain `Profile` type, convert `supervisor_capability_enabled` and `supervisor_directory_visible` from `0|1` to boolean. Example:

```ts
return {
  ...row,
  supervisor_capability_enabled: !!row.supervisor_capability_enabled,
  supervisor_directory_visible: !!row.supervisor_directory_visible,
  photos_in_backup: !!row.photos_in_backup,   // if existing code didn't already do this, align
};
```

- [ ] **Step 4: Quick smoke test — add to existing profileService test file**

Append a test to `__tests__/services/profileService.test.ts`:

```ts
test('enable/disable supervisor capability updates profile and calls directory upsert/delete', async () => {
  const { service, db } = await setupProfile();   // existing helper in that file
  const cloud = createMockCloudClient({ initialSession: { user_id: 'u', email: 'e', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 } });
  await service.enableSupervisorCapability('L3-11111', 'Name', true, cloud);
  const p = await service.getProfile();
  expect(p?.supervisor_capability_enabled).toBe(true);
  expect(cloud.directory.get('u')?.sprat_cert_number).toBe('L3-11111');

  await service.disableSupervisorCapability(0, cloud);
  const p2 = await service.getProfile();
  expect(p2?.supervisor_capability_enabled).toBe(false);
  expect(cloud.directory.has('u')).toBe(false);
});

test('disable is blocked when pending requests exist', async () => {
  const { service } = await setupProfile();
  const cloud = createMockCloudClient({ initialSession: { user_id: 'u', email: 'e', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 } });
  await expect(service.disableSupervisorCapability(1, cloud)).rejects.toThrow('pending_requests_exist');
});
```

(If `setupProfile` doesn't exist, inline the setup similarly to other service tests.)

- [ ] **Step 5: Run**

Run: `npx jest __tests__/services/profileService.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/profileService.ts __tests__/services/profileService.test.ts
git commit -m "feat(profile): enable/disable supervisor capability"
```

---

### Task 10: Hooks — `useSupervisorConnections`, `useSupervisorSearch`

**Files:**
- Create: `src/hooks/useSupervisorConnections.ts`
- Create: `src/hooks/useSupervisorSearch.ts`

- [ ] **Step 1: Create `useSupervisorConnections.ts`**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSupervisorConnectionsService } from '../services/supervisorConnectionsService';
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { SupervisorSearchResult } from '../types';

export interface UseSupervisorConnectionsDeps {
  db: DbClient;
  cloud: CloudClient;
}

const KEY = ['supervisor_connections'];

export function useSupervisorConnections({ db, cloud }: UseSupervisorConnectionsDeps) {
  const qc = useQueryClient();
  const service = createSupervisorConnectionsService(db, cloud);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      await service.sync();
      return service.listCached();
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });

  const inviteByEmail = useMutation({
    mutationFn: (email: string) => service.inviteByEmail(email),
    onSuccess: invalidate,
  });

  const inviteByDirectoryResult = useMutation({
    mutationFn: (args: { result: SupervisorSearchResult; invitedEmail: string }) =>
      service.inviteByDirectoryResult(args.result, args.invitedEmail),
    onSuccess: invalidate,
  });

  const accept = useMutation({ mutationFn: (id: string) => service.accept(id), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: (id: string) => service.decline(id), onSuccess: invalidate });
  const revoke = useMutation({ mutationFn: (id: string) => service.revoke(id), onSuccess: invalidate });
  const reinvite = useMutation({ mutationFn: (id: string) => service.reinvite(id), onSuccess: invalidate });

  return { query, inviteByEmail, inviteByDirectoryResult, accept, decline, revoke, reinvite };
}
```

- [ ] **Step 2: Create `useSupervisorSearch.ts`**

```ts
import { useCallback, useState } from 'react';
import { SupervisorSearchKind, SupervisorSearchResult } from '../types';
import { CloudClient } from '../cloud/cloudClient';

export function useSupervisorSearch(cloud: CloudClient) {
  const [results, setResults] = useState<SupervisorSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (kind: SupervisorSearchKind, query: string) => {
    setIsSearching(true);
    setError(null);
    try {
      const r = await cloud.searchSupervisors(kind, query);
      setResults(r);
    } catch (e: any) {
      setError(e.message);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [cloud]);

  return { results, search, isSearching, error };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSupervisorConnections.ts src/hooks/useSupervisorSearch.ts
git commit -m "feat(hooks): supervisor connections + search"
```

---

### Task 11: `SupervisorsSection` component

**Files:**
- Create: `src/components/SupervisorsSection.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React, { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Button, Input, ListRow, Banner, Badge } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createProfileService } from '../services/profileService';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SupervisorsSection() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: profile } = useProfile();
  const db = getClient();
  const cloud = createSupabaseCloudClient();
  const profileService = createProfileService(db);
  const conns = useSupervisorConnections({ db, cloud });

  const [showToggleForm, setShowToggleForm] = useState(false);
  const [certInput, setCertInput] = useState('');

  if (!profile) return null;
  const capabilityOn = profile.supervisor_capability_enabled;

  const connections = conns.query.data ?? [];
  const pendingIncoming = connections.filter(c =>
    c.supervisor_user_id === profile.id && c.status === 'pending');    // TODO: tech user_id lookup, handled inline
  const accepted = connections.filter(c =>
    c.tech_user_id === profile.id && c.status === 'accepted');
  const pendingOutgoing = connections.filter(c =>
    c.tech_user_id === profile.id && c.status === 'pending');

  const toggleCapability = async (on: boolean) => {
    if (on) {
      setShowToggleForm(true);
    } else {
      try {
        const pending = pendingIncoming.length;
        await profileService.disableSupervisorCapability(pending, cloud);
        conns.query.refetch();
      } catch (e: any) {
        if (e.message === 'pending_requests_exist') {
          Alert.alert('Resolve pending requests', `You have ${pendingIncoming.length} pending sign request(s). Decline or sign them before turning off supervising.`);
        } else {
          Alert.alert('Could not disable', e.message);
        }
      }
    }
  };

  const confirmEnable = async () => {
    if (!certInput.trim()) return;
    try {
      await profileService.enableSupervisorCapability(
        certInput.trim(),
        profile.full_name,
        true,
        cloud,
      );
      setShowToggleForm(false);
      setCertInput('');
      conns.query.refetch();
    } catch (e: any) {
      Alert.alert('Could not enable', e.message);
    }
  };

  return (
    <Card>
      <Text style={[typography.h2, { color: colors.textPrimary, marginBottom: spacing.sm }]}>Supervisors</Text>

      <ListRow
        title="I supervise others"
        subtitle={capabilityOn ? 'Enabled' : 'Off'}
        trailing={
          <Button
            title={capabilityOn ? 'Turn off' : 'Turn on'}
            variant={capabilityOn ? 'ghost' : 'primary'}
            onPress={() => toggleCapability(!capabilityOn)}
          />
        }
      />

      {showToggleForm && (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Input
            label="SPRAT Level III cert number"
            value={certInput}
            onChangeText={setCertInput}
            placeholder="L3-XXXXX"
            autoCapitalize="characters"
          />
          <Button title="Enable supervising" onPress={confirmEnable} disabled={!certInput.trim()} />
          <Button title="Cancel" variant="ghost" onPress={() => { setShowToggleForm(false); setCertInput(''); }} />
        </View>
      )}

      <View style={{ height: spacing.base }} />

      <Text style={[typography.bodyBold, { color: colors.textPrimary, marginBottom: spacing.xs }]}>My supervisors</Text>

      {accepted.length === 0 && (
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>No supervisors added yet.</Text>
      )}

      {accepted.map(c => (
        <ListRow
          key={c.id}
          title={c.supervisor_display_name ?? c.invited_email}
          subtitle="Accepted"
          trailing={
            <Button title="Remove" variant="ghost" onPress={async () => {
              await conns.revoke.mutateAsync(c.id);
            }} />
          }
        />
      ))}

      {pendingOutgoing.length > 0 && (
        <>
          <View style={{ height: spacing.sm }} />
          <Text style={[typography.bodyBold, { color: colors.textPrimary, marginBottom: spacing.xs }]}>Pending invites</Text>
          {pendingOutgoing.map(c => (
            <ListRow
              key={c.id}
              title={c.invited_email}
              subtitle={c.supervisor_user_id ? 'Waiting for accept' : 'Waiting for signup'}
              trailing={<Badge variant="pending">Pending</Badge>}
            />
          ))}
        </>
      )}

      <View style={{ height: spacing.sm }} />
      <Button title="Add supervisor" onPress={() => navigation.navigate('SupervisorSearch')} />
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only for missing `SupervisorSearch` route — fixed in Task 13. Other errors if `Badge` does not accept `variant='pending'` — either add the variant to the Badge primitive at this point (one-line enum extension) or use an existing variant.

- [ ] **Step 3: Commit**

```bash
git add src/components/SupervisorsSection.tsx
git commit -m "feat(ui): SupervisorsSection for profile"
```

---

### Task 12: `SupervisorSearchScreen`

**Files:**
- Create: `src/screens/SupervisorSearchScreen.tsx`

- [ ] **Step 1: Write the screen**

```tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, Input, Card, Chip, ListRow, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSupervisorSearch } from '../hooks/useSupervisorSearch';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { SupervisorSearchKind, SupervisorSearchResult } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SupervisorSearchScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const db = getClient();
  const cloud = createSupabaseCloudClient();
  const search = useSupervisorSearch(cloud);
  const conns = useSupervisorConnections({ db, cloud });
  const [tab, setTab] = useState<SupervisorSearchKind>('email');
  const [query, setQuery] = useState('');

  const runSearch = async () => {
    if (tab === 'email') {
      if (!query.trim()) return;
      try {
        await conns.inviteByEmail.mutateAsync(query.trim());
        Alert.alert('Invite sent', `An invite was sent to ${query.trim()}.`);
        navigation.goBack();
      } catch (e: any) {
        Alert.alert('Could not invite', e.message);
      }
    } else {
      await search.search(tab, query.trim());
    }
  };

  const sendRequest = async (result: SupervisorSearchResult) => {
    try {
      await conns.inviteByDirectoryResult.mutateAsync({
        result,
        invitedEmail: '',   // will be filled by server once supervisor accepts
      });
      Alert.alert('Request sent', `A connection request was sent to ${result.display_name}.`);
      navigation.goBack();
    } catch (e: any) {
      if (e.message === 'cooldown_active') {
        Alert.alert('Cooldown active', 'You declined (or were declined by) this supervisor recently. Try again in a few weeks.');
      } else {
        Alert.alert('Could not send', e.message);
      }
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Add supervisor</Text>

        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <Chip label="Email" active={tab === 'email'} onPress={() => { setTab('email'); setQuery(''); search.search('email', ''); }} />
          <Chip label="SPRAT ID" active={tab === 'sprat_id'} onPress={() => { setTab('sprat_id'); setQuery(''); }} />
          <Chip label="Name" active={tab === 'name'} onPress={() => { setTab('name'); setQuery(''); }} />
        </View>

        <Input
          label={tab === 'email' ? 'Supervisor email' : tab === 'sprat_id' ? 'SPRAT cert number' : 'Name (3+ chars)'}
          value={query}
          onChangeText={(v) => { setQuery(v); if (tab === 'name' && v.trim().length >= 3) search.search('name', v.trim()); }}
          autoCapitalize={tab === 'sprat_id' ? 'characters' : 'none'}
          keyboardType={tab === 'email' ? 'email-address' : 'default'}
        />

        <Button
          title={tab === 'email' ? 'Send invite' : 'Search'}
          onPress={runSearch}
          disabled={!query.trim() || (tab === 'name' && query.trim().length < 3)}
        />

        {search.error && <Banner variant="warning" message={search.error} />}

        {tab !== 'email' && search.results.map(r => (
          <Card key={r.user_id}>
            <ListRow
              title={r.display_name}
              subtitle={r.sprat_cert_number}
              trailing={<Button title="Send request" onPress={() => sendRequest(r)} />}
            />
          </Card>
        ))}

        {tab !== 'email' && !search.isSearching && search.results.length === 0 && query.trim() && (
          <Banner variant="info" message="No supervisors found. Try the Email tab to invite by email." />
        )}
      </ScrollView>
    </Screen>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors on route reference (Task 13 fixes).

- [ ] **Step 3: Commit**

```bash
git add src/screens/SupervisorSearchScreen.tsx
git commit -m "feat(ui): SupervisorSearchScreen with email/id/name tabs"
```

---

### Task 13: Wire `SupervisorSearch` into `RootNavigator`

**Files:**
- Modify: `src/navigation/RootNavigator.tsx`

- [ ] **Step 1: Add to the param list and stack**

Add to `RootStackParamList`:
```ts
SupervisorSearch: undefined;
```

Register the screen inside the same stack that has Auth/Signature (non-tab stack group):

```tsx
<Stack.Screen
  name="SupervisorSearch"
  component={SupervisorSearchScreen}
  options={{ headerShown: true, title: 'Add supervisor' }}
/>
```

Import at the top:
```ts
import { SupervisorSearchScreen } from '../screens/SupervisorSearchScreen';
```

- [ ] **Step 2: Run type-check + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/navigation/RootNavigator.tsx
git commit -m "feat(nav): wire SupervisorSearch screen"
```

---

### Task 14: Mount `SupervisorsSection` in `ProfileScreen`

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`

- [ ] **Step 1: Import and mount**

In `ProfileScreen.tsx`, add near the other imports:
```ts
import { SupervisorsSection } from '../components/SupervisorsSection';
```

Inside the scroll view, add `<SupervisorsSection />` above the existing `<ProfileCloudSection />`.

- [ ] **Step 2: Manual smoke (start the dev server)**

Run: `npx expo start`
Expected: app launches; Profile shows a "Supervisors" card above the cloud card; tapping "Turn on" prompts for cert number; tapping "Add supervisor" navigates to the search screen.

Note: tests for UI are not added here — these screens are thin wrappers over tested services and hooks.

- [ ] **Step 3: Commit**

```bash
git add src/screens/ProfileScreen.tsx
git commit -m "feat(ui): mount SupervisorsSection in ProfileScreen"
```

---

### Task 15: `InboxScreen` (read-only for now; will gain sign actions later)

**Files:**
- Create: `src/screens/InboxScreen.tsx`

- [ ] **Step 1: Write the screen**

```tsx
import React from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Card, ListRow, Button, EmptyState } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function InboxScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: profile } = useProfile();
  const db = getClient();
  const cloud = createSupabaseCloudClient();
  const conns = useSupervisorConnections({ db, cloud });

  if (!profile) return null;

  const incoming = (conns.query.data ?? []).filter(c =>
    c.supervisor_user_id === profile.id && c.status === 'pending',
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Inbox</Text>

        <Text style={[typography.h2, { color: colors.textPrimary }]}>Connection requests</Text>
        {incoming.length === 0 && (
          <EmptyState title="No incoming requests" message="Techs who add you as their supervisor appear here." />
        )}
        {incoming.map(c => (
          <Card key={c.id}>
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.body, { color: colors.textPrimary }]}>{c.invited_email}</Text>
              <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>wants to add you as their supervisor</Text>
              <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                <Button title="Accept" onPress={async () => {
                  try { await conns.accept.mutateAsync(c.id); }
                  catch (e: any) { Alert.alert('Could not accept', e.message); }
                }} />
                <Button title="Decline" variant="ghost" onPress={async () => {
                  try { await conns.decline.mutateAsync(c.id); }
                  catch (e: any) { Alert.alert('Could not decline', e.message); }
                }} />
              </View>
            </View>
          </Card>
        ))}

        <Text style={[typography.h2, { color: colors.textPrimary }]}>Sign requests</Text>
        <EmptyState title="No sign requests yet" message="Techs can send you entries to sign. They'll appear here." />
      </ScrollView>
    </Screen>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/InboxScreen.tsx
git commit -m "feat(ui): InboxScreen for connections (sign requests stubbed)"
```

---

### Task 16: Wire the conditional Inbox tab in `RootNavigator`

**Files:**
- Modify: `src/navigation/RootNavigator.tsx`

- [ ] **Step 1: Conditional bottom tab**

Locate the `Tab.Navigator`. Before rendering `Tab.Screen`s, read the profile via the existing `useProfile()` hook already used by the navigator. Add the new tab only when `profile?.supervisor_capability_enabled === true`:

```tsx
{profile?.supervisor_capability_enabled ? (
  <Tab.Screen name="Inbox" component={InboxScreen} options={{ /* icon/title per existing pattern */ }} />
) : null}
```

Ensure `InboxScreen` is imported at the top.

- [ ] **Step 2: Manual smoke**

Run: `npx expo start`
Expected: Inbox tab appears only after enabling supervisor capability; disappears when disabled.

- [ ] **Step 3: Commit**

```bash
git add src/navigation/RootNavigator.tsx
git commit -m "feat(nav): conditional Inbox tab for supervisors"
```

---

### Task 17: Sync catch-up wiring

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Extend the AppState listener**

Find the existing `AppState.addEventListener('change', ...)` in `App.tsx`. After the existing background-trigger logic, add a foreground branch:

```ts
if (next === 'active') {
  try {
    const db = getClient();
    const cloud = createSupabaseCloudClient();
    const conns = createSupervisorConnectionsService(db, cloud);
    await conns.sync();
    // signRequestsService.sync() added in Task 24
  } catch {
    // best-effort, silent
  }
}
```

Imports:
```ts
import { createSupervisorConnectionsService } from './src/services/supervisorConnectionsService';
```

- [ ] **Step 2: Commit**

```bash
git add App.tsx
git commit -m "feat(app): sync supervisor connections on foreground"
```

---

### Task 18: Subscribe to realtime in `useSupervisorConnections`

**Files:**
- Modify: `src/hooks/useSupervisorConnections.ts`

- [ ] **Step 1: Add a `useEffect` that subscribes and invalidates**

Inside `useSupervisorConnections`, after the mutations block:

```ts
import { useEffect } from 'react';

// ...
useEffect(() => {
  const unsubscribe = cloud.subscribeConnections((_row) => {
    qc.invalidateQueries({ queryKey: KEY });
  });
  return unsubscribe;
}, [cloud, qc]);
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSupervisorConnections.ts
git commit -m "feat(hooks): realtime subscription for connections"
```

---

### Task 19: 🚩 Demo checkpoint — connections end-to-end

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: all tests pass (existing 92 + ~10 new = ~102 total).

- [ ] **Step 2: Manual QA in dev**

Run `npx expo start` and exercise:
1. Onboard two accounts (tech, supervisor) on two simulators or devices.
2. From supervisor's Profile, enable supervisor capability with a cert number.
3. From tech's Profile, tap "Add supervisor," search by SPRAT ID, send a request.
4. On supervisor's Inbox, accept the request. Tech sees it move to "My supervisors."
5. Revoke from tech side — supervisor's Inbox updates.

**Note:** This QA step requires the Supabase Postgres schema to be applied. The real implementation is deferred to Task 36, but unit-test coverage via the mock demonstrates correctness. If real QA is needed now, apply the SQL from Task 36 to your dev Supabase project first.

- [ ] **Step 3: Tag the checkpoint**

```bash
git tag supervisor-accounts-connections-demo
```

---

## Phase 4 — Sign requests service + entry locking

### Task 20: Add pending-lock enforcement to `entriesService`

**Files:**
- Modify: `src/services/entriesService.ts`
- Modify: `__tests__/services/entriesService.test.ts`

- [ ] **Step 1: Add the lock check to `updateEntry` and `deleteEntry`**

In `updateEntry`:

```ts
const existing = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
if (!existing) throw new Error('Entry not found');
if (existing.status === 'signed') throw new Error('Cannot edit signed entry');
if (existing.pending_sign_request_id) throw new Error('entry_locked_pending_request');
```

In `deleteEntry`, same:

```ts
const existing = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
if (!existing) return;   // or existing behavior
if (existing.status === 'signed') throw new Error('Cannot delete signed entry');
if (existing.pending_sign_request_id) throw new Error('entry_locked_pending_request');
```

- [ ] **Step 2: Add tests**

Append to `__tests__/services/entriesService.test.ts`:

```ts
test('updateEntry throws when entry has pending_sign_request_id', async () => {
  const { service, db } = await setupEntries();
  const entry = await service.createEntry({ /* usual fields */ });
  await db.run('UPDATE entries SET pending_sign_request_id = ? WHERE id = ?', ['req1', entry.id]);
  await expect(service.updateEntry(entry.id, { description: 'x' }))
    .rejects.toThrow('entry_locked_pending_request');
});

test('deleteEntry throws when entry has pending_sign_request_id', async () => {
  const { service, db } = await setupEntries();
  const entry = await service.createEntry({ /* usual fields */ });
  await db.run('UPDATE entries SET pending_sign_request_id = ? WHERE id = ?', ['req1', entry.id]);
  await expect(service.deleteEntry(entry.id))
    .rejects.toThrow('entry_locked_pending_request');
});
```

(Replace `/* usual fields */` with the existing helper or literal field set used elsewhere in that file.)

- [ ] **Step 3: Run**

Run: `npx jest __tests__/services/entriesService.test.ts`
Expected: all existing + 2 new pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/entriesService.ts __tests__/services/entriesService.test.ts
git commit -m "feat(entries): lock entries with pending sign requests"
```

---

### Task 21: `signRequestsService.ts` scaffolding

**Files:**
- Create: `src/services/signRequestsService.ts`
- Create: `__tests__/services/signRequestsService.test.ts`

- [ ] **Step 1: Write the service file**

```ts
import { DbClient } from '../db/client';
import { CloudClient, SendSignRequestInput, SignRequestSignInput } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import {
  Entry, EntryRow, SignRequest, SignRequestStatus, HashFn, Signature,
} from '../types';
import { canonicalize } from '../utils/canonical';
import { normalizeAppPath, rehydrateAppPath } from '../utils/paths';
import { computeEntryHashFromPayload } from '../utils/entryPayloadHash';   // new helper — see Task 22
import { saveSignaturePng } from '../utils/fileStorage';
import { generateId } from '../utils/uuid';

type Clock = () => string;

const EXPIRATION_DAYS = 30;

export function createSignRequestsService(
  db: DbClient,
  cloud: CloudClient,
  fs: FileSystemAbstraction,
  hash: HashFn,
  clock: Clock = () => new Date().toISOString(),
) {
  async function cacheRow(row: SignRequest): Promise<void> {
    await db.run(
      `INSERT OR REPLACE INTO sign_requests_cache
         (id, tech_user_id, supervisor_user_id, entry_id, status,
          decline_reason, signed_at, created_at, expires_at, updated_at, payload_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.id, row.tech_user_id, row.supervisor_user_id,
        (row.entry_payload as Entry).id, row.status, row.decline_reason,
        row.signed_at, row.created_at, row.expires_at, row.updated_at,
        JSON.stringify(row),
      ],
    );
  }

  async function getMaxUpdatedAt(): Promise<string | undefined> {
    const r = await db.get<{ max: string | null }>(
      'SELECT MAX(updated_at) as max FROM sign_requests_cache',
    );
    return r?.max ?? undefined;
  }

  // --- public API filled in across Tasks 22–26 ---
  return {
    sync: async () => { /* Task 26 */ },
    listCached: async (): Promise<SignRequest[]> => {
      const rows = await db.getAll<{ payload_json: string }>(
        'SELECT payload_json FROM sign_requests_cache ORDER BY created_at DESC',
      );
      return rows.map(r => JSON.parse(r.payload_json) as SignRequest);
    },
    sendRequest: async (_args: { entry_id: string; connection_id: string; supervisor_user_id: string }): Promise<SignRequest> => {
      throw new Error('not_implemented_yet');   // Task 22
    },
    withdraw: async (_id: string): Promise<SignRequest> => { throw new Error('not_implemented_yet'); },
    decline: async (_id: string, _reason: string): Promise<SignRequest> => { throw new Error('not_implemented_yet'); },
    sign: async (_args: { request_id: string; png_base64: string; supervisor_name: string; supervisor_cert_number: string; device_id: string; gps_lat?: number; gps_lon?: number }): Promise<SignRequest> => { throw new Error('not_implemented_yet'); },
    applyIncomingSignature: async (_row: SignRequest): Promise<Signature> => { throw new Error('not_implemented_yet'); },
  };
}
```

- [ ] **Step 2: Create `src/utils/entryPayloadHash.ts` helper**

```ts
import { Entry, HashFn } from '../types';
import { canonicalize } from './canonical';
import { normalizeAppPath } from './paths';

/**
 * Hash an Entry payload (as sent in a sign request) using the v3 algorithm.
 * Matches signingService.entryRowToHashInputV3 but operates on an in-memory
 * Entry object rather than a DB row.
 */
export async function computeEntryHashFromPayload(
  entry: Entry,
  hash: HashFn,
  version: number = 3,
): Promise<string> {
  if (version !== 3) {
    throw new Error(`Unsupported hash_version for payload: ${version}`);
  }
  const normalizedPaths = entry.photo_paths.map(normalizeAppPath);
  const input = {
    id: entry.id,
    date_from: entry.date_from,
    date_to: entry.date_to,
    employer: entry.employer,
    site: entry.site,
    client: entry.client,
    description: entry.description,
    work_hours: entry.work_hours,
    tech_level_snapshot: entry.tech_level_snapshot,
    work_types: JSON.stringify(entry.work_types),
    other_work_description: entry.other_work_description,
    equipment_notes: entry.equipment_notes,
    weather: entry.weather,
    photo_paths: normalizedPaths,
    status: entry.status,
    amends_entry_id: entry.amends_entry_id,
    amendment_reason: entry.amendment_reason,
  };
  return hash(canonicalize(input));
}
```

- [ ] **Step 3: Create the test file with setup**

```ts
// __tests__/services/signRequestsService.test.ts
import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createSignRequestsService } from '../../src/services/signRequestsService';
import { testHash } from '../testHash';
import { AuthSession, Entry } from '../../src/types';

// documentDirectory is mocked in this test file (pattern from signingService.test.ts)
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///tmp/test/' }));

const techSession: AuthSession = { user_id: 'tech-1', email: 'tech@example.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };
const supSession: AuthSession = { user_id: 'sup-1', email: 'sup@example.com', access_token: 't2', refresh_token: 'r2', expires_at: Date.now() + 3600_000 };

async function setup() {
  const db = await createTestClient();
  const cloud = createMockCloudClient({ initialSession: techSession });
  const fs = createMockFs();
  const service = createSignRequestsService(db, cloud, fs, testHash);
  return { db, cloud, fs, service };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    date_from: '2026-03-01',
    date_to: '2026-03-01',
    employer: 'Acme',
    site: 'Platform A',
    client: 'BigCo',
    description: 'Rope access inspection',
    work_hours: 8,
    tech_level_snapshot: 'II',
    work_types: ['inspection'],
    other_work_description: null,
    equipment_notes: null,
    weather: null,
    photo_paths: [],
    status: 'draft',
    amends_entry_id: null,
    amendment_reason: null,
    pending_sign_request_id: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

test('placeholder', async () => {
  const { service } = await setup();
  expect(await service.listCached()).toEqual([]);
});
```

- [ ] **Step 4: Run**

Run: `npx jest __tests__/services/signRequestsService.test.ts`
Expected: 1 passes.

- [ ] **Step 5: Commit**

```bash
git add src/services/signRequestsService.ts src/utils/entryPayloadHash.ts __tests__/services/signRequestsService.test.ts
git commit -m "feat(service): scaffold signRequestsService"
```

---

### Task 22: Implement `sendRequest`

**Files:**
- Modify: `src/services/signRequestsService.ts`
- Modify: `__tests__/services/signRequestsService.test.ts`

- [ ] **Step 1: Implement `sendRequest`**

Replace the `sendRequest` stub:

```ts
async function sendRequest(args: { entry_id: string; connection_id: string; supervisor_user_id: string }): Promise<SignRequest> {
  const row = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [args.entry_id]);
  if (!row) throw new Error('Entry not found');
  if (row.status !== 'draft') throw new Error('Entry not in draft status');
  if (row.pending_sign_request_id) throw new Error('entry_already_locked');
  if (!row.date_from || !row.date_to || row.work_hours <= 0 || !row.description?.trim()) {
    throw new Error('missing_required');
  }

  const entry: Entry = {
    ...row,
    work_types: JSON.parse(row.work_types),
    photo_paths: JSON.parse(row.photo_paths),
    pending_sign_request_id: null,
  } as any;

  // Build asset uploads + manifest
  const manifest: Record<string, { sha256: string; size_bytes: number }> = {};
  const uploads: Array<{ key: string; bytes: Uint8Array }> = [];
  for (let i = 0; i < entry.photo_paths.length; i++) {
    const path = entry.photo_paths[i];
    const bytes = await fs.readFileAsBytes(path);
    const sha256 = await hash(Buffer.from(bytes).toString('base64'));   // or equivalent
    const ext = path.split('.').pop() ?? 'jpg';
    const key = `sign-requests/PENDING/photo_${entry.id}_${i}.${ext}`;
    manifest[key] = { sha256, size_bytes: bytes.length };
    uploads.push({ key, bytes });
  }

  const expiresAt = new Date(Date.now() + EXPIRATION_DAYS * 24 * 3600_000).toISOString();

  // Send to cloud; the mock server rewrites PENDING → actual request_id in keys
  const cloudRow = await cloud.sendSignRequest({
    connection_id: args.connection_id,
    supervisor_user_id: args.supervisor_user_id,
    entry_payload: entry,
    assets_manifest: manifest,
    asset_uploads: uploads,
    expires_at: expiresAt,
  });

  await db.run('UPDATE entries SET pending_sign_request_id = ?, updated_at = ? WHERE id = ?',
    [cloudRow.id, clock(), entry.id]);
  await cacheRow(cloudRow);
  return cloudRow;
}
```

Expose it in the returned object, replacing the stub.

- [ ] **Step 2: Add test**

```ts
test('sendRequest uploads photos, inserts row, locks entry', async () => {
  const { service, cloud, db } = await setup();
  // Seed an entry and an accepted connection
  const entry = makeEntry();
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, other_work_description, equipment_notes, weather, photo_paths, status, amends_entry_id, amendment_reason, pending_sign_request_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [entry.id, entry.date_from, entry.date_from, entry.date_to, entry.employer, entry.site, entry.client, entry.description, entry.work_hours, entry.tech_level_snapshot, JSON.stringify(entry.work_types), null, null, null, '[]', 'draft', null, null, null, entry.created_at, entry.updated_at]
  );
  cloud.connections.set('c1', {
    id: 'c1', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'accepted', invited_email: 'sup@example.com', supervisor_display_name: 'Sup',
    declined_at: null, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  });

  const req = await service.sendRequest({ entry_id: entry.id, connection_id: 'c1', supervisor_user_id: supSession.user_id });
  expect(req.status).toBe('pending');

  const locked = await db.get<{ pending_sign_request_id: string }>('SELECT pending_sign_request_id FROM entries WHERE id = ?', [entry.id]);
  expect(locked?.pending_sign_request_id).toBe(req.id);

  const cached = await service.listCached();
  expect(cached).toHaveLength(1);
});

test('sendRequest rejects when connection is not accepted', async () => {
  const { service, cloud, db } = await setup();
  // ... same entry seed as above ...
  cloud.connections.set('c2', {
    id: 'c2', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'pending', invited_email: 'x', supervisor_display_name: null,
    declined_at: null, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  });
  await expect(service.sendRequest({ entry_id: 'e1', connection_id: 'c2', supervisor_user_id: supSession.user_id }))
    .rejects.toThrow('connection_not_accepted');
});

test('sendRequest rejects on incomplete draft', async () => {
  const { service, cloud, db } = await setup();
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES ('e2','2026-03-01','2026-03-01','2026-03-01','Acme','Site','','' /*empty desc*/, 0, 'II', '[]', '[]', 'draft','2026-03-01','2026-03-01')`
  );
  cloud.connections.set('c1', {
    id: 'c1', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'accepted', invited_email: 'sup@example.com', supervisor_display_name: 'Sup',
    declined_at: null, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  });
  await expect(service.sendRequest({ entry_id: 'e2', connection_id: 'c1', supervisor_user_id: supSession.user_id }))
    .rejects.toThrow('missing_required');
});
```

- [ ] **Step 3: Run**

Run: `npx jest __tests__/services/signRequestsService.test.ts`
Expected: 4 pass (placeholder + 3 new).

- [ ] **Step 4: Commit**

```bash
git add src/services/signRequestsService.ts __tests__/services/signRequestsService.test.ts
git commit -m "feat(sign-requests): sendRequest with entry lock and asset manifest"
```

---

### Task 23: Implement `withdraw`, `decline`, `sign`

**Files:**
- Modify: `src/services/signRequestsService.ts`
- Modify: `__tests__/services/signRequestsService.test.ts`

- [ ] **Step 1: Implement the three methods**

```ts
async function withdraw(id: string): Promise<SignRequest> {
  const row = await cloud.withdrawRequest(id);
  await cacheRow(row);
  // Unlock the entry if this device is the tech
  const entryId = (row.entry_payload as Entry).id;
  await db.run('UPDATE entries SET pending_sign_request_id = NULL, updated_at = ? WHERE id = ?', [clock(), entryId]);
  return row;
}

async function decline(id: string, reason: string): Promise<SignRequest> {
  const row = await cloud.declineRequest(id, reason);
  await cacheRow(row);
  return row;
}

async function sign(args: { request_id: string; png_base64: string; supervisor_name: string; supervisor_cert_number: string; device_id: string; gps_lat?: number; gps_lon?: number }): Promise<SignRequest> {
  // Locate the request in cache to get the entry payload for hashing
  const cachedRow = await db.get<{ payload_json: string }>('SELECT payload_json FROM sign_requests_cache WHERE id = ?', [args.request_id]);
  if (!cachedRow) throw new Error('request_not_found_in_cache');
  const req = JSON.parse(cachedRow.payload_json) as SignRequest;
  const entry = req.entry_payload;
  const entry_hash = await computeEntryHashFromPayload(entry, hash, 3);
  const png_bytes = Buffer.from(args.png_base64, 'base64');   // RN-compat: use global.Buffer or the polyfill
  const row = await cloud.signRequest({
    request_id: args.request_id,
    png_bytes,
    supervisor_name: args.supervisor_name,
    supervisor_cert_number: args.supervisor_cert_number,
    entry_hash,
    hash_version: 3,
    signed_device_id: args.device_id,
    signed_gps_lat: args.gps_lat,
    signed_gps_lon: args.gps_lon,
  });
  await cacheRow(row);
  return row;
}
```

Expose in the returned object.

- [ ] **Step 2: Add tests for each**

```ts
test('withdraw unlocks the entry', async () => {
  const { service, cloud, db } = await setup();
  // Seed + send a request
  // (copy the sendRequest setup block from Task 22 tests)
  // ... seed entry, seed connection 'c1' ...
  const req = await service.sendRequest({ entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id });

  const row = await service.withdraw(req.id);
  expect(row.status).toBe('withdrawn');
  const unlocked = await db.get<{ pending_sign_request_id: string | null }>('SELECT pending_sign_request_id FROM entries WHERE id = ?', ['e1']);
  expect(unlocked?.pending_sign_request_id).toBeNull();
});

test('decline stores reason and keeps row in terminal state', async () => {
  const { service, cloud } = await setup();
  // Seed a request directly in mock as-if received on supervisor side
  cloud.requests.set('r1', {
    id: 'r1', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    connection_id: 'c1', entry_payload: makeEntry() as any, assets_manifest: {},
    status: 'pending', decline_reason: null, signature_png_path: null,
    supervisor_name_snapshot: null, supervisor_cert_number_snapshot: null,
    entry_hash: null, hash_version: null, signed_device_id: null,
    signed_gps_lat: null, signed_gps_lon: null,
    created_at: '2026-03-01T00:00:00.000Z', expires_at: '2026-05-01T00:00:00.000Z',
    signed_at: null, updated_at: '2026-03-01T00:00:00.000Z',
  });
  cloud.actAs(supSession);
  const row = await service.decline('r1', 'Hours don\'t match timesheet');
  expect(row.status).toBe('declined');
  expect(row.decline_reason).toBe('Hours don\'t match timesheet');
});

test('sign uploads PNG, transitions row to signed, writes entry_hash v3', async () => {
  const { service, cloud, db } = await setup();
  // Seed a cached request (on the supervisor side we'd normally sync first; here
  // we insert directly into the cache)
  const entry = makeEntry();
  const reqRow = {
    id: 'r2', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    connection_id: 'c1', entry_payload: entry, assets_manifest: {},
    status: 'pending' as const, decline_reason: null, signature_png_path: null,
    supervisor_name_snapshot: null, supervisor_cert_number_snapshot: null,
    entry_hash: null, hash_version: null, signed_device_id: null,
    signed_gps_lat: null, signed_gps_lon: null,
    created_at: '2026-03-01T00:00:00.000Z', expires_at: '2026-05-01T00:00:00.000Z',
    signed_at: null, updated_at: '2026-03-01T00:00:00.000Z',
  };
  cloud.requests.set('r2', reqRow);
  await db.run(
    `INSERT INTO sign_requests_cache (id, tech_user_id, supervisor_user_id, entry_id, status, decline_reason, signed_at, created_at, expires_at, updated_at, payload_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ['r2', techSession.user_id, supSession.user_id, entry.id, 'pending', null, null, reqRow.created_at, reqRow.expires_at, reqRow.updated_at, JSON.stringify(reqRow)],
  );
  cloud.actAs(supSession);
  const tinyPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  const result = await service.sign({
    request_id: 'r2', png_base64: tinyPng,
    supervisor_name: 'Sup Name', supervisor_cert_number: 'L3-00001',
    device_id: 'mock-device',
  });
  expect(result.status).toBe('signed');
  expect(result.entry_hash).toBeTruthy();
  expect(result.hash_version).toBe(3);
  expect(result.supervisor_name_snapshot).toBe('Sup Name');
});
```

- [ ] **Step 3: Run**

Run: `npx jest __tests__/services/signRequestsService.test.ts`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/signRequestsService.ts __tests__/services/signRequestsService.test.ts
git commit -m "feat(sign-requests): withdraw, decline, sign"
```

---

### Task 24: Implement `applyIncomingSignature` + sync

**Files:**
- Modify: `src/services/signRequestsService.ts`
- Create: `__tests__/services/applyIncomingSignature.test.ts`

- [ ] **Step 1: Implement**

```ts
async function applyIncomingSignature(row: SignRequest): Promise<Signature> {
  if (row.status !== 'signed') throw new Error('not_signed');

  const entry = row.entry_payload;

  // Download the PNG
  const pngKey = row.signature_png_path;
  if (!pngKey) throw new Error('missing_png_path');
  let localPngPath: string | null = null;
  try {
    const bytes = await cloud.downloadObject(pngKey);
    const base64 = Buffer.from(bytes).toString('base64');
    const sigId = generateId();
    localPngPath = await saveSignaturePng(base64, sigId);
  } catch {
    localPngPath = null;   // quarantine: entry shows "image missing" banner
  }

  // Idempotency: check if a signature row already exists for this entry
  const existing = await db.get<Signature>('SELECT * FROM signatures WHERE entry_id = ?', [entry.id]);
  if (existing) {
    return existing;
  }

  const now = clock();
  const sigId = generateId();
  await db.run(
    `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, gps_lat, gps_lon, entry_hash, hash_version, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      sigId, entry.id,
      row.supervisor_name_snapshot ?? '',
      row.supervisor_cert_number_snapshot ?? '',
      localPngPath ?? '',
      row.signed_at ?? now,
      row.signed_device_id ?? 'unknown',
      row.signed_gps_lat, row.signed_gps_lon,
      row.entry_hash ?? '',
      row.hash_version ?? 3,
      now,
    ],
  );
  await db.run(
    `UPDATE entries SET status='signed', pending_sign_request_id=NULL, updated_at=? WHERE id=?`,
    [now, entry.id],
  );
  return (await db.get<Signature>('SELECT * FROM signatures WHERE id = ?', [sigId]))!;
}

async function sync(): Promise<void> {
  const since = await getMaxUpdatedAt();
  const rows = await cloud.listSignRequests(since);
  const currentUid = cloud.getCurrentUserId();
  for (const r of rows) {
    await cacheRow(r);
    // If this device is the tech and the row just transitioned to 'signed', apply it.
    if (currentUid && r.tech_user_id === currentUid && r.status === 'signed') {
      await applyIncomingSignature(r);
    }
    // If row transitioned to withdrawn/declined/expired on tech side, unlock entry.
    if (currentUid && r.tech_user_id === currentUid &&
        (r.status === 'withdrawn' || r.status === 'declined' || r.status === 'expired')) {
      const entryId = (r.entry_payload as Entry).id;
      await db.run(
        'UPDATE entries SET pending_sign_request_id = NULL, updated_at = ? WHERE id = ? AND pending_sign_request_id = ?',
        [clock(), entryId, r.id],
      );
    }
  }
}
```

Expose in the returned object.

- [ ] **Step 2: Test**

Create `__tests__/services/applyIncomingSignature.test.ts`:

```ts
import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createSignRequestsService } from '../../src/services/signRequestsService';
import { testHash } from '../testHash';
import { AuthSession, SignRequest, Entry } from '../../src/types';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///tmp/test/' }));

const techSession: AuthSession = { user_id: 'tech-1', email: 't@e.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };

async function setup() {
  const db = await createTestClient();
  const cloud = createMockCloudClient({ initialSession: techSession });
  const fs = createMockFs();
  const service = createSignRequestsService(db, cloud, fs, testHash);
  // Seed entry in tech's local DB with a pending lock
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, pending_sign_request_id, created_at, updated_at)
     VALUES ('e1','2026-03-01','2026-03-01','2026-03-01','Acme','Site','Client','Desc', 8, 'II', '["inspection"]', '[]', 'draft', 'r1', '2026-03-01', '2026-03-01')`,
  );
  return { db, cloud, fs, service };
}

test('applyIncomingSignature inserts signature row, flips entry to signed, clears lock', async () => {
  const { service, cloud, db } = await setup();
  // Seed PNG in mock storage
  await cloud.uploadObject('sign-requests/r1/sig.png', new Uint8Array([137, 80, 78, 71]));
  const entry: Entry = {
    id: 'e1', date_from: '2026-03-01', date_to: '2026-03-01', employer: 'Acme', site: 'Site',
    client: 'Client', description: 'Desc', work_hours: 8, tech_level_snapshot: 'II',
    work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
    photo_paths: [], status: 'draft', amends_entry_id: null, amendment_reason: null,
    pending_sign_request_id: 'r1',
    created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  };
  const row: SignRequest = {
    id: 'r1', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-1',
    connection_id: 'c1', entry_payload: entry, assets_manifest: {},
    status: 'signed', decline_reason: null, signature_png_path: 'sign-requests/r1/sig.png',
    supervisor_name_snapshot: 'Sup', supervisor_cert_number_snapshot: 'L3-00001',
    entry_hash: 'abc', hash_version: 3, signed_device_id: 'dev',
    signed_gps_lat: null, signed_gps_lon: null,
    created_at: '2026-03-01T00:00:00.000Z', expires_at: '2026-05-01T00:00:00.000Z',
    signed_at: '2026-03-02T00:00:00.000Z', updated_at: '2026-03-02T00:00:00.000Z',
  };
  const sig = await service.applyIncomingSignature(row);
  expect(sig.supervisor_name).toBe('Sup');
  const entryNow = await db.get<{ status: string; pending_sign_request_id: string | null }>(
    'SELECT status, pending_sign_request_id FROM entries WHERE id = ?', ['e1']);
  expect(entryNow?.status).toBe('signed');
  expect(entryNow?.pending_sign_request_id).toBeNull();
});

test('applyIncomingSignature is idempotent', async () => {
  const { service, cloud } = await setup();
  await cloud.uploadObject('sign-requests/r1/sig.png', new Uint8Array([137]));
  const row: SignRequest = { /* same as above */ } as any;
  await service.applyIncomingSignature(row);
  await service.applyIncomingSignature(row);   // second call: no throw, no duplicate row
});

test('applyIncomingSignature quarantines missing PNG but still creates signature row', async () => {
  const { service, db } = await setup();
  const row: SignRequest = { /* same but signature_png_path points to a non-uploaded key */ } as any;
  // Do NOT upload the PNG
  await service.applyIncomingSignature(row);
  const sig = await db.get<{ signature_png_path: string }>('SELECT signature_png_path FROM signatures WHERE entry_id = ?', ['e1']);
  expect(sig?.signature_png_path).toBe('');
});
```

(Fill in the `/* same as above */` placeholders with the literal row object.)

- [ ] **Step 3: Run**

Run: `npx jest __tests__/services/applyIncomingSignature.test.ts`
Expected: 3 pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/signRequestsService.ts __tests__/services/applyIncomingSignature.test.ts
git commit -m "feat(sign-requests): applyIncomingSignature and sync"
```

---

### Task 25: `useSignRequests` hook

**Files:**
- Create: `src/hooks/useSignRequests.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSignRequestsService } from '../services/signRequestsService';
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import { HashFn } from '../types';

export interface UseSignRequestsDeps {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  hash: HashFn;
}

const KEY = ['sign_requests'];

export function useSignRequests({ db, cloud, fs, hash }: UseSignRequestsDeps) {
  const qc = useQueryClient();
  const service = createSignRequestsService(db, cloud, fs, hash);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      await service.sync();
      return service.listCached();
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });

  const send = useMutation({ mutationFn: (args: Parameters<typeof service.sendRequest>[0]) => service.sendRequest(args), onSuccess: invalidate });
  const withdraw = useMutation({ mutationFn: (id: string) => service.withdraw(id), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: (args: { id: string; reason: string }) => service.decline(args.id, args.reason), onSuccess: invalidate });
  const sign = useMutation({ mutationFn: (args: Parameters<typeof service.sign>[0]) => service.sign(args), onSuccess: invalidate });

  useEffect(() => {
    const unsub = cloud.subscribeSignRequests(async () => {
      await service.sync();
      invalidate();
    });
    return unsub;
  }, [cloud]);

  return { query, send, withdraw, decline, sign };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSignRequests.ts
git commit -m "feat(hooks): useSignRequests"
```

---

### Task 26: `SignRequestDetailScreen`

**Files:**
- Create: `src/screens/SignRequestDetailScreen.tsx`

- [ ] **Step 1: Write the screen**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, Image } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas from 'react-native-signature-canvas';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Screen, Card, Button, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSignRequests } from '../hooks/useSignRequests';
import { useProfile } from '../hooks/useProfile';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { RootStackParamList } from '../navigation/RootNavigator';
import { SignRequest } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'SignRequestDetail'>;

export function SignRequestDetailScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { data: profile } = useProfile();
  const db = getClient();
  const cloud = createSupabaseCloudClient();
  const fs = createExpoFsAbstraction();
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const [showCanvas, setShowCanvas] = useState(false);
  const [signing, setSigning] = useState(false);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const sigRef = useRef<any>(null);

  const req = (signReqs.query.data ?? []).find(r => r.id === route.params.requestId);

  if (!req || !profile) return null;
  const entry = req.entry_payload;

  const handleSign = async (png_base64: string) => {
    setSigning(true);
    try {
      let lat: number | undefined, lon: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        }
      } catch {}
      await signReqs.sign.mutateAsync({
        request_id: req.id,
        png_base64: png_base64.replace('data:image/png;base64,', ''),
        supervisor_name: profile.full_name,
        supervisor_cert_number: profile.supervisor_cert_number ?? '',
        device_id: Device.modelName ?? 'unknown',
        gps_lat: lat, gps_lon: lon,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not sign', e.message);
    } finally {
      setSigning(false);
    }
  };

  const handleDecline = async () => {
    try {
      await signReqs.decline.mutateAsync({ id: req.id, reason: declineReason.trim() });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not decline', e.message);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Sign request</Text>
        <Banner variant="info" message={`Requested at ${new Date(req.created_at).toLocaleString()}`} />

        <Card>
          <Text style={[typography.bodyBold, { color: colors.textPrimary }]}>
            {entry.date_from === entry.date_to ? entry.date_from : `${entry.date_from} → ${entry.date_to}`}
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.site} · {entry.client}</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.employer}</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.work_hours}h · Level {entry.tech_level_snapshot}</Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            Work types: {entry.work_types.join(', ')}
          </Text>
          {entry.other_work_description && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Other: {entry.other_work_description}
            </Text>
          )}
          <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.sm }]}>{entry.description}</Text>
          {entry.equipment_notes && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              Equipment: {entry.equipment_notes}
            </Text>
          )}
          {entry.weather && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Weather: {entry.weather}
            </Text>
          )}
        </Card>

        {entry.photo_paths.length > 0 && (
          <Card>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginBottom: spacing.xs }]}>Photos</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {entry.photo_paths.map((p, i) => (
                <Image key={i} source={{ uri: p }} style={{ width: 100, height: 100, borderRadius: 6 }} />
              ))}
            </View>
          </Card>
        )}

        {req.status !== 'pending' && (
          <Banner variant="info" message={`Status: ${req.status}${req.decline_reason ? ` — ${req.decline_reason}` : ''}`} />
        )}

        {req.status === 'pending' && !showCanvas && !declineMode && (
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <Button title="Sign" onPress={() => setShowCanvas(true)} />
            <Button title="Decline" variant="ghost" onPress={() => setDeclineMode(true)} />
            <Button title="Close" variant="ghost" onPress={() => navigation.goBack()} />
          </View>
        )}

        {declineMode && (
          <Card>
            <Text style={[typography.bodyBold, { color: colors.textPrimary, marginBottom: spacing.xs }]}>Decline reason</Text>
            <Banner variant="warning" message="Optional, 200 chars max. The tech will see this." />
            {/* Textarea primitive used here — existing import pattern */}
            <Button title={`Decline request`} onPress={handleDecline} />
            <Button title="Cancel" variant="ghost" onPress={() => { setDeclineMode(false); setDeclineReason(''); }} />
          </Card>
        )}

        {showCanvas && (
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Your signature</Text>
            <View style={{ borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', height: 200 }}>
              <SignatureCanvas
                ref={sigRef}
                onOK={(sig) => handleSign(sig)}
                autoClear={false}
                descriptionText=""
                webStyle={`.m-signature-pad{box-shadow:none;border:none}.m-signature-pad--body{border:none}.m-signature-pad--footer{display:none}`}
              />
            </View>
            <Button title="Confirm signature" onPress={() => sigRef.current?.readSignature()} loading={signing} />
            <Button title="Clear" variant="ghost" onPress={() => sigRef.current?.clearSignature()} />
            <Button title="Back" variant="ghost" onPress={() => setShowCanvas(false)} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
```

(If the Textarea primitive has a specific API, wire it into the decline modal as the reason input — the above is a scaffold and leaves that detail to existing patterns in the codebase.)

- [ ] **Step 2: Commit**

```bash
git add src/screens/SignRequestDetailScreen.tsx
git commit -m "feat(ui): SignRequestDetailScreen"
```

---

### Task 27: Wire `SignRequestDetail` route + Inbox list of sign requests

**Files:**
- Modify: `src/navigation/RootNavigator.tsx`
- Modify: `src/screens/InboxScreen.tsx`

- [ ] **Step 1: Add to param list + register**

```ts
SignRequestDetail: { requestId: string };
```

```tsx
<Stack.Screen
  name="SignRequestDetail"
  component={SignRequestDetailScreen}
  options={{ headerShown: true, title: 'Sign request' }}
/>
```

- [ ] **Step 2: Extend `InboxScreen` with a sign-requests section**

Replace the "Sign requests" placeholder in `InboxScreen.tsx` with:

```tsx
const signReqs = useSignRequests({ db, cloud, fs: createExpoFsAbstraction(), hash: sha256 });
const incomingRequests = (signReqs.query.data ?? []).filter(r =>
  r.supervisor_user_id === profile.id && r.status === 'pending');
const history = (signReqs.query.data ?? []).filter(r =>
  r.supervisor_user_id === profile.id && r.status !== 'pending').slice(0, 50);

// ... below the connection section ...
<Text style={[typography.h2, { color: colors.textPrimary }]}>Sign requests</Text>
{incomingRequests.length === 0 && (
  <EmptyState title="No sign requests" message="Techs' completed entries will appear here for you to sign." />
)}
{incomingRequests.map(r => {
  const entry = r.entry_payload;
  return (
    <Card key={r.id}>
      <ListRow
        title={`${entry.date_from} — ${entry.site}`}
        subtitle={`${entry.work_hours}h · ${entry.employer}`}
        trailing={<Button title="Open" onPress={() => navigation.navigate('SignRequestDetail', { requestId: r.id })} />}
      />
    </Card>
  );
})}

{history.length > 0 && (
  <>
    <Text style={[typography.h2, { color: colors.textPrimary, marginTop: spacing.base }]}>History</Text>
    {history.map(r => {
      const entry = r.entry_payload;
      return (
        <Card key={r.id}>
          <ListRow
            title={`${entry.date_from} — ${entry.site}`}
            subtitle={`${r.status}${r.decline_reason ? ` — ${r.decline_reason}` : ''}`}
          />
        </Card>
      );
    })}
  </>
)}
```

Add needed imports for `useSignRequests`, `createExpoFsAbstraction`, `sha256`.

- [ ] **Step 3: Commit**

```bash
git add src/navigation/RootNavigator.tsx src/screens/InboxScreen.tsx
git commit -m "feat(ui): sign-request section in Inbox + detail route"
```

---

### Task 28: Tech side — "Send for signature" action on `EntryFormScreen`

**Files:**
- Modify: `src/screens/EntryFormScreen.tsx`

- [ ] **Step 1: Add a supervisor-picker sheet and "Send for signature" action**

At the bottom of the form (next to the existing "Sign in person" button), add:

```tsx
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useSignRequests } from '../hooks/useSignRequests';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';

// inside component:
const conns = useSupervisorConnections({ db, cloud });
const signReqs = useSignRequests({ db, cloud, fs: createExpoFsAbstraction(), hash: sha256 });
const [showPicker, setShowPicker] = useState(false);

const accepted = (conns.query.data ?? []).filter(c =>
  c.tech_user_id === profile?.id && c.status === 'accepted' && c.supervisor_user_id
);

const onSendForSignature = async (supervisor: typeof accepted[number]) => {
  if (!entry) return;
  try {
    await signReqs.send.mutateAsync({
      entry_id: entry.id,
      connection_id: supervisor.id,
      supervisor_user_id: supervisor.supervisor_user_id!,
    });
    setShowPicker(false);
    navigation.goBack();
  } catch (e: any) {
    Alert.alert('Could not send', e.message);
  }
};
```

And the button in the action row:

```tsx
<Button title="Send for signature" onPress={() => setShowPicker(true)} disabled={!entryIsComplete || accepted.length === 0} />
```

Plus a simple modal/sheet showing each accepted supervisor as a `ListRow`; tapping calls `onSendForSignature`.

If the entry has `pending_sign_request_id`, replace the action row with a `Banner`:

```tsx
{entry?.pending_sign_request_id && (
  <Banner
    variant="info"
    message={`Awaiting signature...`}
    actionLabel="Withdraw"
    onAction={async () => {
      try { await signReqs.withdraw.mutateAsync(entry.pending_sign_request_id!); }
      catch (e: any) { Alert.alert('Could not withdraw', e.message); }
    }}
  />
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/EntryFormScreen.tsx
git commit -m "feat(ui): Send for signature action + withdraw banner"
```

---

### Task 29: Tech side — banners on `EntryDetailScreen` + chip on `LogbookScreen`

**Files:**
- Modify: `src/screens/EntryDetailScreen.tsx`
- Modify: `src/screens/LogbookScreen.tsx`

- [ ] **Step 1: `EntryDetailScreen` pending/declined banners**

Near the top of the render, after the existing integrity/status banners:

```tsx
const signReqs = useSignRequests({ db, cloud, fs: createExpoFsAbstraction(), hash: sha256 });
const myRequest = (signReqs.query.data ?? []).find(r => r.entry_payload.id === entry.id);

{myRequest?.status === 'pending' && (
  <Banner
    variant="info"
    message="Awaiting supervisor signature"
    actionLabel="Withdraw"
    onAction={() => signReqs.withdraw.mutate(myRequest.id)}
  />
)}
{myRequest?.status === 'declined' && (
  <Banner
    variant="warning"
    message={`Declined: ${myRequest.decline_reason ?? '(no reason)'}`}
    actionLabel="Edit"
    onAction={() => navigation.navigate('EntryForm', { entryId: entry.id })}
  />
)}
{myRequest?.status === 'expired' && (
  <Banner
    variant="warning"
    message="Signature request expired"
    actionLabel="Resend"
    onAction={() => navigation.navigate('EntryForm', { entryId: entry.id })}
  />
)}
```

- [ ] **Step 2: `LogbookScreen` chip**

In the row render, add a `Chip` reflecting the sign-request state. Keep existing status chip logic; add:

```tsx
{entry.pending_sign_request_id && <Chip label="Awaiting" variant="pending" />}
```

(Use an existing variant or add one to the Chip primitive if absent.)

- [ ] **Step 3: Commit**

```bash
git add src/screens/EntryDetailScreen.tsx src/screens/LogbookScreen.tsx
git commit -m "feat(ui): pending/declined banners + awaiting chip"
```

---

### Task 30: App.tsx — sync sign requests on foreground

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Extend the AppState listener**

Where Task 17 added `conns.sync()`, also add:

```ts
const signReqs = createSignRequestsService(db, cloud, createExpoFsAbstraction(), sha256);
await signReqs.sync();
```

- [ ] **Step 2: Commit**

```bash
git add App.tsx
git commit -m "feat(app): sync sign requests on foreground"
```

---

### Task 31: Full-round-trip integration test

**Files:**
- Create: `__tests__/services/fullRemoteSignFlow.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createSupervisorConnectionsService } from '../../src/services/supervisorConnectionsService';
import { createSignRequestsService } from '../../src/services/signRequestsService';
import { createSigningService } from '../../src/services/signingService';
import { testHash } from '../testHash';
import { AuthSession } from '../../src/types';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///tmp/test/' }));

const techSession: AuthSession = { user_id: 'tech-1', email: 'tech@x.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };
const supSession: AuthSession = { user_id: 'sup-1', email: 'sup@x.com', access_token: 't2', refresh_token: 'r2', expires_at: Date.now() + 3600_000 };

test('full remote sign flow: invite → accept → send → sign → tech gets signature', async () => {
  const techDb = await createTestClient();
  const supDb = await createTestClient();
  // Shared mock cloud — both "devices" talk to the same backend
  const cloud = createMockCloudClient({ initialSession: techSession });
  const fs = createMockFs();

  const techConns = createSupervisorConnectionsService(techDb, cloud);
  const techReqs = createSignRequestsService(techDb, cloud, fs, testHash);
  const supConns = createSupervisorConnectionsService(supDb, cloud);
  const supReqs = createSignRequestsService(supDb, cloud, fs, testHash);
  const techSigning = createSigningService(techDb, testHash);

  // Supervisor: enable directory entry so search works
  cloud.actAs(supSession);
  await cloud.upsertSupervisorDirectory({ display_name: 'Sup Name', sprat_cert_number: 'L3-00001', visible: true });

  // Tech: search and invite
  cloud.actAs(techSession);
  const results = await techConns.search('sprat_id', 'L3-00001');
  expect(results).toHaveLength(1);
  const invited = await techConns.inviteByDirectoryResult(results[0], 'sup@x.com');
  expect(invited.status).toBe('pending');

  // Supervisor: sync and accept
  cloud.actAs(supSession);
  await supConns.sync();
  await supConns.accept(invited.id);

  // Tech: create an entry, send it
  cloud.actAs(techSession);
  await techDb.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES ('e1','2026-03-01','2026-03-01','2026-03-01','Acme','Platform','Client','Inspected welds',8,'II','["inspection"]','[]','draft','2026-03-01','2026-03-01')`,
  );
  await techConns.sync();   // refresh accepted connection
  const req = await techReqs.sendRequest({ entry_id: 'e1', connection_id: invited.id, supervisor_user_id: supSession.user_id });

  // Supervisor: sync, open, sign
  cloud.actAs(supSession);
  await supReqs.sync();
  const tinyPng = Buffer.from([137, 80, 78, 71]).toString('base64');
  await supReqs.sign({
    request_id: req.id, png_base64: tinyPng,
    supervisor_name: 'Sup Name', supervisor_cert_number: 'L3-00001',
    device_id: 'sup-device',
  });

  // Tech: sync pulls down the signed request; applyIncomingSignature writes local row
  cloud.actAs(techSession);
  await techReqs.sync();

  // Verify local state on tech side
  const entryNow = await techDb.get<{ status: string; pending_sign_request_id: string | null }>(
    'SELECT status, pending_sign_request_id FROM entries WHERE id = ?', ['e1']);
  expect(entryNow?.status).toBe('signed');
  expect(entryNow?.pending_sign_request_id).toBeNull();

  const sig = await techSigning.getSignatureForEntry('e1');
  expect(sig).toBeTruthy();
  expect(sig?.supervisor_name).toBe('Sup Name');
  expect(sig?.hash_version).toBe(3);
});
```

- [ ] **Step 2: Run**

Run: `npx jest __tests__/services/fullRemoteSignFlow.test.ts`
Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/fullRemoteSignFlow.test.ts
git commit -m "test(integration): full remote sign round-trip"
```

---

### Task 32: Verify remote signature passes `verifyIntegrity`

**Files:**
- Modify: `__tests__/services/signingService.test.ts`

- [ ] **Step 1: Append cross-algorithm verification test**

```ts
test('signature produced by remote sign flow verifies with signingService.verifyIntegrity', async () => {
  const techDb = await createTestClient();
  const cloud = createMockCloudClient({ initialSession: { user_id: 'tech-1', email: 't', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 } });
  const fs = createMockFs();
  const signReqs = createSignRequestsService(techDb, cloud, fs, testHash);
  const signing = createSigningService(techDb, testHash);

  // Seed entry + pre-signed remote row
  await techDb.run(
    `INSERT INTO entries (id,date,date_from,date_to,employer,site,client,description,work_hours,tech_level_snapshot,work_types,photo_paths,status,pending_sign_request_id,created_at,updated_at)
     VALUES ('e1','2026-03-01','2026-03-01','2026-03-01','Acme','Site','Client','Desc',8,'II','["inspection"]','[]','draft','r1','2026-03-01','2026-03-01')`,
  );
  const entry = {
    id: 'e1', date_from: '2026-03-01', date_to: '2026-03-01', employer: 'Acme', site: 'Site',
    client: 'Client', description: 'Desc', work_hours: 8, tech_level_snapshot: 'II',
    work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
    photo_paths: [], status: 'draft', amends_entry_id: null, amendment_reason: null,
    pending_sign_request_id: 'r1',
    created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  };
  const entry_hash = await computeEntryHashFromPayload(entry as any, testHash, 3);

  await cloud.uploadObject('sign-requests/r1/sig.png', new Uint8Array([137]));
  await signReqs.applyIncomingSignature({
    id: 'r1', tech_user_id: 'tech-1', supervisor_user_id: 'sup-1', connection_id: 'c1',
    entry_payload: entry as any, assets_manifest: {},
    status: 'signed', decline_reason: null, signature_png_path: 'sign-requests/r1/sig.png',
    supervisor_name_snapshot: 'Sup', supervisor_cert_number_snapshot: 'L3-00001',
    entry_hash, hash_version: 3, signed_device_id: 'dev',
    signed_gps_lat: null, signed_gps_lon: null,
    created_at: '2026-03-01T00:00:00.000Z', expires_at: '2026-05-01T00:00:00.000Z',
    signed_at: '2026-03-02T00:00:00.000Z', updated_at: '2026-03-02T00:00:00.000Z',
  });

  const result = await signing.verifyIntegrity('e1');
  expect(result.valid).toBe(true);
});
```

Add imports for `computeEntryHashFromPayload` and `createSignRequestsService`.

- [ ] **Step 2: Run**

Run: `npx jest __tests__/services/signingService.test.ts`
Expected: existing tests + 1 new pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/signingService.test.ts
git commit -m "test(signing): remote sign produces verifiable signature"
```

---

### Task 33: Apply Supabase schema (SQL file)

**Files:**
- Create: `supabase/migrations/20260418_supervisor_accounts.sql`

- [ ] **Step 1: Write the migration**

Paste the canonical SQL from spec §4.1, §4.2, §4.3 into the file. Verbatim from the spec:

```sql
-- 20260418_supervisor_accounts.sql
create extension if not exists pg_trgm;

create table supervisor_connections (
  id uuid primary key default gen_random_uuid(),
  tech_user_id uuid not null references auth.users(id) on delete cascade,
  supervisor_user_id uuid references auth.users(id) on delete cascade,
  status text not null check (status in ('pending','accepted','declined','revoked')),
  invited_email text not null,
  supervisor_display_name text,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uniq_conn_tech_sup on supervisor_connections (tech_user_id, supervisor_user_id)
  where supervisor_user_id is not null;
create unique index uniq_conn_tech_email on supervisor_connections (tech_user_id, invited_email)
  where supervisor_user_id is null;
create index on supervisor_connections (tech_user_id);
create index on supervisor_connections (supervisor_user_id);
create index on supervisor_connections (invited_email) where supervisor_user_id is null;

-- (include sign_requests, supervisor_directory, RLS policies, trigger — copy verbatim from spec §4.1 and §4.2)
```

Copy the **full SQL** from the spec §4.1 (tables + indexes) and §4.2 (RLS — translate the English descriptions into explicit `create policy` statements). Fill in every policy named in the spec.

For RLS policies, concrete SQL to include (follow exactly):

```sql
alter table supervisor_connections enable row level security;

create policy conn_select on supervisor_connections
  for select to authenticated
  using (auth.uid() = tech_user_id or auth.uid() = supervisor_user_id);

create policy conn_insert on supervisor_connections
  for insert to authenticated
  with check (auth.uid() = tech_user_id);

create policy conn_update_tech on supervisor_connections
  for update to authenticated
  using (auth.uid() = tech_user_id)
  with check (auth.uid() = tech_user_id);

create policy conn_update_sup on supervisor_connections
  for update to authenticated
  using (auth.uid() = supervisor_user_id)
  with check (auth.uid() = supervisor_user_id);

-- Re-invite cooldown: only allow flipping declined → pending if cooldown has passed.
-- Enforced in a BEFORE UPDATE trigger for clarity (RLS check clauses struggle with
-- referencing OLD).
create or replace function enforce_reinvite_cooldown() returns trigger as $$
begin
  if old.status = 'declined' and new.status = 'pending' then
    if old.declined_at is not null and old.declined_at > now() - interval '30 days' then
      raise exception 'cooldown_active';
    end if;
    new.declined_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger enforce_reinvite_cooldown_trg
  before update on supervisor_connections
  for each row execute function enforce_reinvite_cooldown();
```

Similar policies for `sign_requests` (see spec §4.2):

```sql
alter table sign_requests enable row level security;

create policy req_select on sign_requests
  for select to authenticated
  using (auth.uid() in (tech_user_id, supervisor_user_id));

create policy req_insert on sign_requests
  for insert to authenticated
  with check (
    auth.uid() = tech_user_id
    and exists (
      select 1 from supervisor_connections c
      where c.id = connection_id
        and c.tech_user_id = auth.uid()
        and c.supervisor_user_id = sign_requests.supervisor_user_id
        and c.status = 'accepted'
    )
  );

create policy req_update_tech_withdraw on sign_requests
  for update to authenticated
  using (auth.uid() = tech_user_id and status = 'pending')
  with check (auth.uid() = tech_user_id and status in ('pending','withdrawn'));

create policy req_update_sup_sign_or_decline on sign_requests
  for update to authenticated
  using (auth.uid() = supervisor_user_id and status = 'pending')
  with check (auth.uid() = supervisor_user_id and status in ('pending','signed','declined'));

-- Directory
alter table supervisor_directory enable row level security;
create policy dir_select on supervisor_directory for select to authenticated using (true);
create policy dir_upsert on supervisor_directory
  for insert to authenticated with check (auth.uid() = user_id);
create policy dir_update on supervisor_directory
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy dir_delete on supervisor_directory
  for delete to authenticated using (auth.uid() = user_id);
```

Signup trigger:

```sql
create or replace function resolve_supervisor_invites() returns trigger as $$
begin
  update supervisor_connections
     set supervisor_user_id = new.id, updated_at = now()
   where supervisor_user_id is null and lower(invited_email) = lower(new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger resolve_supervisor_invites_on_signup
  after insert on auth.users
  for each row execute function resolve_supervisor_invites();
```

Storage bucket + policy (cannot be `create bucket` in a migration on Supabase; do this via SQL or dashboard — the migration puts it in SQL for completeness):

```sql
insert into storage.buckets (id, name, public) values ('sign-requests', 'sign-requests', false)
  on conflict (id) do nothing;

create policy "sign_requests_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sign-requests'
    and exists (
      select 1 from public.sign_requests r
      where r.id::text = (storage.foldername(name))[1]
        and auth.uid() in (r.tech_user_id, r.supervisor_user_id)
    )
  );

create policy "sign_requests_insert_tech"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sign-requests'
    and (storage.filename(name) like 'photo_%' or storage.filename(name) = 'sig.png')
    and exists (
      select 1 from public.sign_requests r
      where r.id::text = (storage.foldername(name))[1]
        and (
          (storage.filename(name) like 'photo_%' and auth.uid() = r.tech_user_id)
          or (storage.filename(name) = 'sig.png' and auth.uid() = r.supervisor_user_id)
        )
    )
  );
```

- [ ] **Step 2: Apply to your dev Supabase**

Run: `supabase db push --db-url <your-dev-url>`
Expected: migration applies cleanly.

Or paste the SQL into the Supabase SQL editor if you don't have the CLI set up.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260418_supervisor_accounts.sql
git commit -m "feat(db): supervisor accounts Postgres schema and RLS"
```

---

### Task 34: Wire `supabaseClient.ts` to the real Postgres tables

**Files:**
- Modify: `src/cloud/supabaseClient.ts`

- [ ] **Step 1: Replace the stubs with real implementations**

Replace each `throw new Error('not_implemented')` with a real Supabase call. Pattern:

```ts
async listSupervisorConnections(sinceUpdatedAt) {
  const uid = client.auth.getSession().data.session?.user.id;
  if (!uid) throw new Error('not_authenticated');
  const q = client.from('supervisor_connections').select('*');
  if (sinceUpdatedAt) q.gt('updated_at', sinceUpdatedAt);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
},

async inviteSupervisorByUserId(supervisorUserId, invitedEmail) {
  const uid = await getUid();
  const { data, error } = await client.from('supervisor_connections')
    .insert({ tech_user_id: uid, supervisor_user_id: supervisorUserId, invited_email: invitedEmail.toLowerCase(), status: 'pending' })
    .select('*').single();
  if (error) throw new Error(error.message);
  return data;
},

async searchSupervisors(kind, query) {
  if (kind === 'sprat_id') {
    const { data, error } = await client.from('supervisor_directory')
      .select('*').eq('visible', true).eq('sprat_cert_number', query.trim()).limit(10);
    if (error) throw error;
    return (data ?? []).map(d => ({
      user_id: d.user_id, display_name: d.display_name,
      sprat_cert_number: d.sprat_cert_number, sprat_cert_number_is_masked: false,
    }));
  }
  if (kind === 'name') {
    if (query.trim().length < 3) return [];
    const { data, error } = await client.from('supervisor_directory')
      .select('*').eq('visible', true)
      .ilike('display_name', `${query.trim()}%`).limit(10);
    if (error) throw error;
    return (data ?? []).map(d => ({
      user_id: d.user_id, display_name: d.display_name,
      sprat_cert_number: maskCert(d.sprat_cert_number), sprat_cert_number_is_masked: true,
    }));
  }
  return [];
},

subscribeConnections(callback) {
  const ch = client.channel('supervisor_connections_sub')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'supervisor_connections' },
      (payload) => callback(payload.new as any))
    .subscribe();
  return () => { client.removeChannel(ch); };
},
```

Apply the same pattern to the rest (`respondToConnection` is `update().eq('id', id).eq('status', 'pending')`, `signRequest` writes the PNG via `client.storage.from('sign-requests').upload`, etc.). Use the spec §5 flows as the contract — each method does exactly what the spec describes.

Add helpers at the top of the file:

```ts
function maskCert(cert: string): string {
  if (cert.length <= 4) return cert;
  return cert.slice(0, 2) + '-***' + cert.slice(-2);
}
async function getUid(): Promise<string> {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('not_authenticated');
  return data.session.user.id;
}
```

For `inviteSupervisorByEmail` (unregistered user path), for Part A it can insert a row with `supervisor_user_id=null` directly — the Edge Function that triggers an email invite is Part B. The server-side `resolve_supervisor_invites_on_signup` trigger still backfills when the supervisor signs up.

For `sendSignRequest`, upload assets first (looping through `asset_uploads`), then insert the row. On insert, rewrite `assets_manifest` keys from `sign-requests/PENDING/...` to `sign-requests/{generated_id}/...` — simplest approach: generate a UUID client-side, upload assets under that UUID, then insert the row with that `id` explicitly. Update the mock to accept an optional `id` on `sendSignRequest` inputs (so production and tests agree).

- [ ] **Step 2: Run the test suite**

Run: `npx jest`
Expected: all pass — tests use the mock, not Supabase.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/supabaseClient.ts __tests__/cloudMock.ts
git commit -m "feat(cloud): real Supabase implementation of supervisor-accounts methods"
```

---

### Task 35: 🚩 Demo checkpoint — full remote signing works

- [ ] **Step 1: Run the full test suite**

Run: `npx jest`
Expected: all pass. Target: ~125 tests total (92 existing + ~33 new).

- [ ] **Step 2: Manual QA on two simulators / devices**

1. Apply the SQL migration from Task 33 to your dev Supabase project.
2. Run `npx expo start` on two clients signed in as different users.
3. Supervisor: enable capability with a cert number.
4. Tech: add supervisor via SPRAT ID search.
5. Supervisor: accept.
6. Tech: create + complete an entry, tap "Send for signature," pick the supervisor.
7. Supervisor: open Inbox → pending sign request → open detail → Sign.
8. Tech: observe the entry flip to "Signed" (either instantly via realtime, or on next foreground).
9. Verify the signature exists on tech's logbook, verify `verifyIntegrity` shows valid on `EntryDetailScreen`, verify a cloud backup has been triggered so the supervisor-side signature is persisted.

**This is the client-demo point.** Part B adds Edge Functions, `pg_cron` jobs, unregistered-user invite emails, anti-spam rate limits, and `delete-account` cascade — all nice-to-haves but not blocking a demo.

- [ ] **Step 3: Tag**

```bash
git tag supervisor-accounts-full-signing-demo
```

- [ ] **Step 4: Update CLAUDE.md**

Add a "Supervisor accounts" subsection to `CLAUDE.md`'s "Architecture — three-layer structure" block, summarizing the new tables, services, and screens in 4–6 sentences. Note which items remain in Part B.

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md covers supervisor accounts"
```

---

## Self-review notes

- **Spec coverage:** Every section of spec §3–§8 is implemented by a task above, with the exceptions noted in the plan header as Part B:
  - §3.1 Edge Functions (`invite-supervisor`, `search-supervisors`, `cleanup-request-assets`) — deferred to Part B. Task 34's `supabaseClient.ts` calls Supabase directly for the common paths instead.
  - §4 `pg_cron` expiration + retention — deferred (mock simulates). Tests cover the transition logic.
  - §7.3 `delete-account` cascade — deferred.
  - §7.7 anti-spam rate limits — deferred (cooldown-via-RLS is implemented; 20-searches-per-day is not).
- **Type consistency:** `SupervisorConnection`, `SignRequest`, `SupervisorSearchResult` defined in Task 1; every later task uses the same field names.
- **Commit cadence:** one commit per task (~35 total), demo-tags at Tasks 19 and 35.
- **TDD:** services are test-first; screens are not (they wrap tested services).
- **File size:** largest new file is `SignRequestDetailScreen.tsx` (~180 lines) — within focus budget. No file in this plan exceeds ~300 lines.
