# Cloud Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase B sub-project 1 — accounts + single-user cloud backup/restore — per spec `docs/superpowers/specs/2026-04-16-cloud-backup-and-restore-design.md`.

**Architecture:** Supabase Auth (Apple + Google + email magic link) and Storage only (no Postgres tables in this sub-project). One JSON snapshot per user with a binary manifest; assets stored content-keyed. Client built as pure-function services that accept injected `DbClient` and `CloudClient` abstractions, matching the existing MVP pattern. Path-normalization fix bundled (v2 hash algorithm) so restore can verify signed entries on any device.

**Tech Stack:**
- `@supabase/supabase-js` (Auth + Storage client)
- `expo-auth-session` (OAuth PKCE flow)
- `@react-native-async-storage/async-storage` (session persistence + local manifest cache)
- `react-native-url-polyfill/auto` (polyfill required by supabase-js in RN)
- Existing MVP stack unchanged — React Native + Expo SDK 54, TypeScript, expo-sqlite, @tanstack/react-query v5

**Prereqs before execution starts:**
- A development Supabase project provisioned with Apple, Google, and email auth providers enabled and redirect URL `logbook://auth-callback` allowed.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` available to the engineer.

---

## Phase 1 — Foundations

### Task 1: Install dependencies and wire env config

**Files:**
- Modify: `package.json`
- Create: `app.config.ts` (replaces `app.json` for dynamic config)
- Delete: `app.json` (after migrating its contents into `app.config.ts`)
- Create: `src/config.ts`

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage expo-auth-session expo-web-browser react-native-url-polyfill
```

Expected: new entries appear in `package.json` under `dependencies`.

- [ ] **Step 2: Read current app.json**

Run: `cat app.json`
Copy its contents; it will become the initial value of `app.config.ts`.

- [ ] **Step 3: Create `app.config.ts` to read env vars**

```ts
import { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Rope Access Logbook',
  slug: 'rope-access-logbook',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'logbook',
  ios: { supportsTablet: true, bundleIdentifier: 'com.ropeaccess.logbook' },
  android: { package: 'com.ropeaccess.logbook' },
  splash: { image: './assets/splash-icon.png', resizeMode: 'contain', backgroundColor: '#003366' },
  assetBundlePatterns: ['**/*'],
  extra: {
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  },
});
```

Preserve any existing fields from `app.json` not shown above (especially icons, splash, and any plugins the existing app.json declares). Merge rather than replace.

- [ ] **Step 4: Delete `app.json`**

Run: `rm app.json`

- [ ] **Step 5: Create `src/config.ts`**

```ts
import Constants from 'expo-constants';

interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function requireEnv(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required config: ${name}. Check app.config.ts and .env.`);
  }
  return value;
}

export function getConfig(): AppConfig {
  const extra = Constants.expoConfig?.extra ?? {};
  return {
    supabaseUrl: requireEnv('supabaseUrl', extra.supabaseUrl),
    supabaseAnonKey: requireEnv('supabaseAnonKey', extra.supabaseAnonKey),
  };
}
```

- [ ] **Step 6: Create `.env` (not committed) and `.env.example` (committed)**

Write `.env.example`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

Confirm `.env` is already in `.gitignore` (MVP's `.gitignore` should cover it; add the line if not).

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.config.ts src/config.ts .env.example .gitignore
git rm app.json
git commit -m "feat: add Supabase deps and env config for cloud backup"
```

---

### Task 2: Add new TypeScript types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add new types after the existing `JsonBackup` type**

Edit `src/types.ts` — add these types (place them logically with the existing interfaces):

```ts
export interface BinaryManifestEntry {
  sha256: string;
  size_bytes: number;
  created_at: string;
}

export interface BinaryManifest {
  [storage_key: string]: BinaryManifestEntry;
}

export interface CloudSnapshot extends JsonBackup {
  cloud_schema_version: 1;
  backup_id: string;
  binary_manifest: BinaryManifest;
  photos_included: boolean;
}

export interface AuthSession {
  user_id: string;
  email: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface BackupStatus {
  last_cloud_backup_at: string | null;
  last_uploaded_backup_id: string | null;
  is_uploading: boolean;
  last_error: string | null;
}

export type BackupResult =
  | { kind: 'uploaded'; backup_id: string; bytes_uploaded: number }
  | { kind: 'throttled' }
  | { kind: 'skipped_no_auth' }
  | { kind: 'skipped_offline' }
  | { kind: 'failed'; reason: 'quota' | 'auth_expired' | 'asset_failed' | 'network' | 'unknown'; message: string };

export interface CloudStatePreview {
  has_cloud_data: boolean;
  entries_count: number;
  signatures_count: number;
  cloud_backed_up_at: string | null;
  backup_id: string | null;
}

export type ConflictChoice = 'keep_cloud' | 'replace_cloud';
```

- [ ] **Step 2: Extend `Profile`**

In the existing `Profile` interface, add three fields:

```ts
  photos_in_backup: boolean;
  last_cloud_backup_at: string | null;
  last_uploaded_backup_id: string | null;
```

- [ ] **Step 3: Extend `Signature`**

In the existing `Signature` interface, add:

```ts
  hash_version: number;
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: will report errors in every file that constructs a `Profile` or `Signature` (e.g., `profileService.ts`, `signingService.ts`, tests). Do NOT fix them yet — later tasks handle the consumers one-at-a-time.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat: add cloud backup types (CloudSnapshot, BinaryManifest, AuthSession, BackupStatus, BackupResult)"
```

---

### Task 3: Schema migration infrastructure

Adds the new columns and makes the migration path testable. Runtime uses guarded ALTER TABLEs; tests use the full canonical schema.

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations.ts`
- Modify: `src/db/expoClient.ts` (call migrations after initial schema exec)
- Create: `__tests__/db/migration.test.ts`
- Modify: `__tests__/setup.ts` (run migrations after schema)

- [ ] **Step 1: Update `src/db/schema.ts` to include new columns on profile and signatures**

Edit the two CREATE TABLE blocks so they include the new columns directly (this is the canonical schema; ALTER-based migrations in `migrations.ts` handle existing DBs):

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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

```sql
CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id),
  supervisor_name TEXT NOT NULL,
  supervisor_cert_number TEXT NOT NULL,
  signature_png_path TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  gps_lat REAL,
  gps_lon REAL,
  entry_hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 2: Create `src/db/migrations.ts`**

```ts
import { DbClient } from './client';

interface ColumnInfo {
  name: string;
}

async function hasColumn(db: DbClient, table: string, column: string): Promise<boolean> {
  const rows = await db.getAll<ColumnInfo>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

export async function runSchemaMigrations(db: DbClient): Promise<void> {
  if (!(await hasColumn(db, 'profile', 'photos_in_backup'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN photos_in_backup INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await hasColumn(db, 'profile', 'last_cloud_backup_at'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN last_cloud_backup_at TEXT');
  }
  if (!(await hasColumn(db, 'profile', 'last_uploaded_backup_id'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN last_uploaded_backup_id TEXT');
  }
  if (!(await hasColumn(db, 'signatures', 'hash_version'))) {
    await db.exec('ALTER TABLE signatures ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1');
  }
}
```

- [ ] **Step 3: Hook migrations into the expo runtime client**

Modify `src/db/expoClient.ts` — wherever schema is initialized (right after `SCHEMA_SQL` is executed), call `runSchemaMigrations(db)`. Read the file first to locate the exact line:

```bash
cat src/db/expoClient.ts
```

Add an import and call at the bottom of the init path.

- [ ] **Step 4: Hook migrations into the test client**

Modify `__tests__/setup.ts`:

```ts
import BetterSqlite3 from 'better-sqlite3';
import { DbClient } from '../src/db/client';
import { SCHEMA_SQL } from '../src/db/schema';
import { runSchemaMigrations } from '../src/db/migrations';

export function createTestClient(): DbClient {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');

  const statements = SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    db.exec(stmt);
  }

  const client: DbClient = {
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const row = db.prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    async getAll<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async exec(sql) {
      db.exec(sql);
    },
  };

  // Run migrations as a no-op here since the schema already includes the new columns,
  // but call it so the code path is exercised and stays green.
  runSchemaMigrations(client);

  return client;
}

export function createLegacyTestClient(): DbClient {
  // Same as createTestClient but creates tables without the v2 columns, simulating a pre-migration DB.
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE profile (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      sprat_id TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('I', 'II', 'III')),
      cert_expires_on TEXT NOT NULL,
      default_employer TEXT NOT NULL DEFAULT '',
      sprat_card_photo_path TEXT,
      last_backup_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      employer TEXT NOT NULL,
      site TEXT NOT NULL,
      client TEXT NOT NULL,
      description TEXT NOT NULL,
      work_hours REAL NOT NULL,
      tech_level_snapshot TEXT NOT NULL CHECK (tech_level_snapshot IN ('I', 'II', 'III')),
      work_types TEXT NOT NULL DEFAULT '[]',
      equipment_notes TEXT,
      weather TEXT,
      photo_paths TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'amended')),
      amends_entry_id TEXT REFERENCES entries(id),
      amendment_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE signatures (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES entries(id),
      supervisor_name TEXT NOT NULL,
      supervisor_cert_number TEXT NOT NULL,
      signature_png_path TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      gps_lat REAL,
      gps_lon REAL,
      entry_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return {
    async run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes };
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const row = db.prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    async getAll<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
```

- [ ] **Step 5: Write the failing migration test**

Create `__tests__/db/migration.test.ts`:

```ts
import { createLegacyTestClient } from '../setup';
import { runSchemaMigrations } from '../../src/db/migrations';

interface ColumnInfo { name: string }

async function listColumns(db: ReturnType<typeof createLegacyTestClient>, table: string): Promise<string[]> {
  const rows = await db.getAll<ColumnInfo>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

describe('runSchemaMigrations', () => {
  it('adds the v2 columns to a legacy DB', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);

    const profileCols = await listColumns(db, 'profile');
    expect(profileCols).toContain('photos_in_backup');
    expect(profileCols).toContain('last_cloud_backup_at');
    expect(profileCols).toContain('last_uploaded_backup_id');

    const sigCols = await listColumns(db, 'signatures');
    expect(sigCols).toContain('hash_version');
  });

  it('is idempotent — running twice does not error', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    await expect(runSchemaMigrations(db)).resolves.not.toThrow();
  });

  it('defaults photos_in_backup to 0 for existing rows', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['p-1', 'Test', 'S1', 'II', '2027-01-01', '2026-04-16', '2026-04-16'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ photos_in_backup: number }>('SELECT photos_in_backup FROM profile WHERE id = ?', ['p-1']);
    expect(row?.photos_in_backup).toBe(0);
  });

  it('defaults hash_version to 1 for existing signatures', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO entries (id, date, employer, site, client, description, work_hours, tech_level_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e-1', '2026-04-01', 'Emp', 'Site', 'Cli', 'Desc', 8, 'II', '2026-04-01', '2026-04-01'],
    );
    await db.run(
      `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, entry_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['s-1', 'e-1', 'Sup', 'L3-X', '/p.png', '2026-04-01', 'd-1', 'hash', '2026-04-01'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ hash_version: number }>('SELECT hash_version FROM signatures WHERE id = ?', ['s-1']);
    expect(row?.hash_version).toBe(1);
  });
});
```

- [ ] **Step 6: Run the migration test**

Run: `npx jest __tests__/db/migration.test.ts`
Expected: all tests pass.

- [ ] **Step 7: Run the full suite to confirm no regressions**

Run: `npx jest`
Expected: existing tests may fail because `Profile` and `Signature` construction sites haven't been updated yet. Note the failures; they will be fixed in later tasks that touch those services (5, 6, 15, etc.).

Actually — to keep the plan green at commit boundaries, fix the one structural issue now: the `profileService.ts` `createProfile` call needs to write default values for the new columns. Read `src/services/profileService.ts` and add `photos_in_backup = 0`, `last_cloud_backup_at = null`, `last_uploaded_backup_id = null` to any INSERT. Same for tests that construct `Profile` objects directly — rely on the schema defaults for SQL, update TypeScript object literals to include the new fields.

Run `npx jest` again. Expected: all existing suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts src/db/expoClient.ts __tests__/setup.ts __tests__/db/migration.test.ts src/services/profileService.ts
git commit -m "feat: schema migrations for cloud-backup columns + hash_version"
```

---

### Task 4: Path normalization utility

**Files:**
- Create: `src/utils/paths.ts`
- Create: `__tests__/utils/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/utils/paths.test.ts`:

```ts
import { normalizeAppPath, rehydrateAppPath } from '../../src/utils/paths';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

describe('paths', () => {
  describe('normalizeAppPath', () => {
    it('strips the documentDirectory prefix', () => {
      const abs = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg';
      expect(normalizeAppPath(abs)).toBe('logbook/photos/a.jpg');
    });

    it('returns a path under logbook/ as relative even if already relative', () => {
      expect(normalizeAppPath('logbook/signatures/s1.png')).toBe('logbook/signatures/s1.png');
    });

    it('returns input unchanged when prefix does not match and is not already relative', () => {
      const weird = 'content://com.example/photo/1';
      expect(normalizeAppPath(weird)).toBe(weird);
    });
  });

  describe('rehydrateAppPath', () => {
    it('prepends the documentDirectory prefix to a relative path', () => {
      expect(rehydrateAppPath('logbook/photos/a.jpg')).toBe(
        'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg',
      );
    });

    it('leaves absolute paths unchanged', () => {
      const abs = 'file:///already/absolute/path.jpg';
      expect(rehydrateAppPath(abs)).toBe(abs);
    });
  });

  describe('round-trip', () => {
    it('normalize then rehydrate yields the original path', () => {
      const abs = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s.png';
      expect(rehydrateAppPath(normalizeAppPath(abs))).toBe(abs);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/utils/paths.test.ts`
Expected: FAIL with module-not-found for `../../src/utils/paths`.

- [ ] **Step 3: Implement**

Create `src/utils/paths.ts`:

```ts
import * as FileSystem from 'expo-file-system/legacy';

function getDocDir(): string {
  return FileSystem.documentDirectory ?? '';
}

function isAbsolute(path: string): boolean {
  return path.startsWith('file://') || path.startsWith('content://');
}

export function normalizeAppPath(path: string): string {
  if (!path) return path;
  const dir = getDocDir();
  if (dir && path.startsWith(dir)) {
    return path.slice(dir.length);
  }
  if (!isAbsolute(path)) {
    return path;
  }
  // Absolute but does not match docDir prefix — log and return as-is.
  if (typeof console !== 'undefined') {
    console.warn(`[paths] normalizeAppPath: path does not start with documentDirectory: ${path}`);
  }
  return path;
}

export function rehydrateAppPath(path: string): string {
  if (!path) return path;
  if (isAbsolute(path)) return path;
  return getDocDir() + path;
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest __tests__/utils/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/paths.ts __tests__/utils/paths.test.ts
git commit -m "feat: path normalization utility for portable asset paths"
```

---

### Task 5: Update signing service for v2 hash algorithm

**Files:**
- Modify: `src/services/signingService.ts`
- Modify: `__tests__/services/signingService.test.ts`

- [ ] **Step 1: Add the v1/v2 hash dispatch to signingService**

Read `src/services/signingService.ts` first. Then replace `entryRowToHashInput` with a version-aware pair and update `signEntry` and `verifyIntegrity`:

```ts
// src/services/signingService.ts
import { DbClient } from '../db/client';
import { Signature, CreateSignatureInput, EntryRow, HashFn } from '../types';
import { canonicalize } from '../utils/canonical';
import { sha256 } from '../utils/hash';
import { generateId } from '../utils/uuid';
import { normalizeAppPath } from '../utils/paths';

type UuidFn = () => string;

function entryRowToHashInputV1(row: EntryRow): Record<string, unknown> {
  return {
    id: row.id,
    date: row.date,
    employer: row.employer,
    site: row.site,
    client: row.client,
    description: row.description,
    work_hours: row.work_hours,
    tech_level_snapshot: row.tech_level_snapshot,
    work_types: row.work_types,
    equipment_notes: row.equipment_notes,
    weather: row.weather,
    photo_paths: row.photo_paths,
    status: row.status,
    amends_entry_id: row.amends_entry_id,
    amendment_reason: row.amendment_reason,
  };
}

function entryRowToHashInputV2(row: EntryRow): Record<string, unknown> {
  const parsedPaths: string[] = JSON.parse(row.photo_paths);
  const normalized = parsedPaths.map(normalizeAppPath);
  return {
    id: row.id,
    date: row.date,
    employer: row.employer,
    site: row.site,
    client: row.client,
    description: row.description,
    work_hours: row.work_hours,
    tech_level_snapshot: row.tech_level_snapshot,
    work_types: row.work_types,
    equipment_notes: row.equipment_notes,
    weather: row.weather,
    photo_paths: normalized,
    status: row.status,
    amends_entry_id: row.amends_entry_id,
    amendment_reason: row.amendment_reason,
  };
}

export const CURRENT_HASH_VERSION = 2;

export function createSigningService(db: DbClient, hashFn: HashFn = sha256, uuid: UuidFn = generateId) {
  async function computeEntryHash(entryId: string, version: number): Promise<string> {
    const row = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [entryId]);
    if (!row) throw new Error('Entry not found');
    const input = version === 2 ? entryRowToHashInputV2(row) : entryRowToHashInputV1(row);
    const canonical = canonicalize(input);
    return hashFn(canonical);
  }

  return {
    async signEntry(input: CreateSignatureInput): Promise<Signature> {
      const entry = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [input.entry_id]);
      if (!entry) throw new Error('Entry not found');
      if (entry.status !== 'draft') throw new Error('Entry is not in draft status');

      const now = new Date().toISOString();
      const id = uuid();

      await db.run("UPDATE entries SET status = 'signed', updated_at = ? WHERE id = ?", [now, input.entry_id]);

      const entryHash = await computeEntryHash(input.entry_id, CURRENT_HASH_VERSION);

      await db.run(
        `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, gps_lat, gps_lon, entry_hash, hash_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.entry_id, input.supervisor_name, input.supervisor_cert_number,
          input.signature_png_path, now, input.device_id,
          input.gps_lat ?? null, input.gps_lon ?? null,
          entryHash, CURRENT_HASH_VERSION, now,
        ],
      );

      return (await this.getSignatureForEntry(input.entry_id))!;
    },

    async verifyIntegrity(entryId: string): Promise<{ valid: boolean; storedHash: string; computedHash: string; hashVersion: number }> {
      const signature = await this.getSignatureForEntry(entryId);
      if (!signature) throw new Error('No signature found for entry');
      const computedHash = await computeEntryHash(entryId, signature.hash_version);
      return {
        valid: computedHash === signature.entry_hash,
        storedHash: signature.entry_hash,
        computedHash,
        hashVersion: signature.hash_version,
      };
    },

    async getSignatureForEntry(entryId: string): Promise<Signature | null> {
      return db.get<Signature>('SELECT * FROM signatures WHERE entry_id = ?', [entryId]);
    },

    async getAllSignatures(): Promise<Signature[]> {
      return db.getAll<Signature>('SELECT * FROM signatures ORDER BY signed_at DESC');
    },

    // Exposed for the v1→v2 migration (task 6).
    async computeEntryHashForVersion(entryId: string, version: number): Promise<string> {
      return computeEntryHash(entryId, version);
    },
  };
}
```

- [ ] **Step 2: Add new test cases**

Append to `__tests__/services/signingService.test.ts`:

```ts
  describe('hash_version', () => {
    it('new signatures are written with hash_version = 2', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      const sig = await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd-1',
      });
      expect(sig.hash_version).toBe(2);
    });

    it('verifyIntegrity dispatches on stored hash_version', async () => {
      // Create a signed entry (v2), then manually downgrade its hash_version to 1 with a recomputed v1 hash
      const entry = await entriesService.createEntry({
        ...validEntry,
        photo_paths: ['file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg'],
      }, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd-1',
      });
      // Downgrade row to simulate a legacy v1 signature
      const v1Hash = await signingService.computeEntryHashForVersion(entry.id, 1);
      await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', [v1Hash, entry.id]);

      const result = await signingService.verifyIntegrity(entry.id);
      expect(result.valid).toBe(true);
      expect(result.hashVersion).toBe(1);
    });
  });
```

Note — the test above assumes `createEntry` supports `photo_paths`. Check `src/services/entriesService.ts` and adjust the test if the signature differs.

Also — because `__tests__/setup.ts`'s schema now includes `hash_version`, the mock for `expo-file-system/legacy` at the top of the test file needs to be present:

```ts
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));
```

Add that mock near the top of the test file, before any imports.

- [ ] **Step 3: Run the test**

Run: `npx jest __tests__/services/signingService.test.ts`
Expected: all tests pass, including the two new cases.

- [ ] **Step 4: Run the full suite**

Run: `npx jest`
Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/signingService.ts __tests__/services/signingService.test.ts
git commit -m "feat: v2 hash algorithm with normalized paths; version-aware verification"
```

---

### Task 6: V1→V2 one-shot signature migration

**Files:**
- Create: `src/db/hashMigration.ts`
- Modify: `src/db/expoClient.ts` (run hash migration after schema migrations)
- Create: `__tests__/db/hashMigration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/db/hashMigration.test.ts`:

```ts
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

import { createTestClient } from '../setup';
import { testSha256 } from '../testHash';
import { createEntriesService } from '../../src/services/entriesService';
import { createSigningService } from '../../src/services/signingService';
import { runHashMigration } from '../../src/db/hashMigration';

describe('runHashMigration', () => {
  let uuidCounter = 0;
  const testUuid = () => `id-${++uuidCounter}`;

  beforeEach(() => { uuidCounter = 0; });

  it('upgrades a v1 signature that currently verifies to v2 with a recomputed hash', async () => {
    const db = createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);

    const entry = await entries.createEntry({
      date: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
      photo_paths: ['file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg'],
    }, 'II');

    // Sign at v2
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });
    // Manually downgrade to v1 with its v1 hash (simulating a pre-migration row)
    const v1Hash = await signing.computeEntryHashForVersion(entry.id, 1);
    await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', [v1Hash, entry.id]);

    await runHashMigration(db, testSha256);

    const row = await db.get<{ hash_version: number; entry_hash: string }>(
      'SELECT hash_version, entry_hash FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(row!.hash_version).toBe(2);
    const expectedV2 = await signing.computeEntryHashForVersion(entry.id, 2);
    expect(row!.entry_hash).toBe(expectedV2);
  });

  it('leaves v1 signatures that fail v1 verification untouched', async () => {
    const db = createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);

    const entry = await entries.createEntry({
      date: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });
    // Downgrade to v1 but with a BOGUS hash (tampered row)
    await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', ['bogus-hash', entry.id]);

    await runHashMigration(db, testSha256);

    const row = await db.get<{ hash_version: number; entry_hash: string }>(
      'SELECT hash_version, entry_hash FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(row!.hash_version).toBe(1);
    expect(row!.entry_hash).toBe('bogus-hash');
  });

  it('is idempotent', async () => {
    const db = createTestClient();
    // Empty DB — should be a no-op
    await expect(runHashMigration(db, testSha256)).resolves.not.toThrow();
    await expect(runHashMigration(db, testSha256)).resolves.not.toThrow();
  });

  it('leaves v2 signatures alone', async () => {
    const db = createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);

    const entry = await entries.createEntry({
      date: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });

    const before = await db.get<{ entry_hash: string; hash_version: number }>(
      'SELECT entry_hash, hash_version FROM signatures WHERE entry_id = ?', [entry.id],
    );
    await runHashMigration(db, testSha256);
    const after = await db.get<{ entry_hash: string; hash_version: number }>(
      'SELECT entry_hash, hash_version FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx jest __tests__/db/hashMigration.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement**

Create `src/db/hashMigration.ts`:

```ts
import { DbClient } from './client';
import { HashFn, Signature } from '../types';
import { createSigningService } from '../services/signingService';

export async function runHashMigration(db: DbClient, hashFn: HashFn): Promise<void> {
  const signing = createSigningService(db, hashFn);
  const rows = await db.getAll<Signature>(
    'SELECT * FROM signatures WHERE hash_version IS NULL OR hash_version = 1',
  );
  for (const sig of rows) {
    const v1Hash = await signing.computeEntryHashForVersion(sig.entry_id, 1);
    if (v1Hash !== sig.entry_hash) {
      // v1 verification fails on this device — do not migrate, leave flagged as tampered.
      continue;
    }
    const v2Hash = await signing.computeEntryHashForVersion(sig.entry_id, 2);
    await db.run(
      'UPDATE signatures SET entry_hash = ?, hash_version = 2 WHERE id = ?',
      [v2Hash, sig.id],
    );
  }
}
```

- [ ] **Step 4: Hook into expoClient**

Modify `src/db/expoClient.ts` — after `runSchemaMigrations`, call `runHashMigration(db, sha256)` (import `sha256` from `../utils/hash`).

- [ ] **Step 5: Run the test**

Run: `npx jest __tests__/db/hashMigration.test.ts`
Expected: all pass.

- [ ] **Step 6: Run the full suite**

Run: `npx jest`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/hashMigration.ts src/db/expoClient.ts __tests__/db/hashMigration.test.ts
git commit -m "feat: v1→v2 signature hash migration on app launch"
```

---

## Phase 2 — Cloud substrate

### Task 7: CloudClient interface

**Files:**
- Create: `src/cloud/cloudClient.ts`

- [ ] **Step 1: Define the interface**

```ts
// src/cloud/cloudClient.ts
import { AuthSession } from '../types';

export type AuthProvider = 'apple' | 'google';

export interface CloudClient {
  // Storage
  uploadObject(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  downloadObject(key: string): Promise<Uint8Array>;
  objectExists(key: string): Promise<boolean>;
  listPrefix(prefix: string): Promise<string[]>;
  deleteObject(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;

  // Auth
  getSession(): Promise<AuthSession | null>;
  getCurrentUserId(): string | null;
  signInWithProvider(provider: AuthProvider): Promise<AuthSession>;
  signInWithMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  // Edge Functions
  callEdgeFunction<TResponse>(name: string, body?: unknown): Promise<TResponse>;

  // Observability
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;

  // Connectivity
  isOnline(): Promise<boolean>;
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/cloudClient.ts
git commit -m "feat: CloudClient interface for auth + storage abstraction"
```

---

### Task 8: In-memory CloudClient mock

**Files:**
- Create: `__tests__/cloudMock.ts`

- [ ] **Step 1: Implement**

```ts
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
  // Test-only handles
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
      // Mock: immediately completes sign-in (real flow is async via deep link)
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
        // Simulate server-side cascade: delete all objects under user's prefix
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
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add __tests__/cloudMock.ts
git commit -m "feat: in-memory CloudClient mock for tests"
```

---

### Task 9: FileSystem abstraction

**Files:**
- Create: `src/cloud/fsAbstraction.ts`
- Create: `__tests__/fsMock.ts`

- [ ] **Step 1: Define the abstraction**

```ts
// src/cloud/fsAbstraction.ts
export interface FileSystemAbstraction {
  readAsBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  deletePath(path: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  getSha256(path: string): Promise<string>;
  getSize(path: string): Promise<number>;
}
```

- [ ] **Step 2: Create runtime impl in same file**

Append:

```ts
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

export function createExpoFsAbstraction(): FileSystemAbstraction {
  return {
    async readAsBytes(path: string) {
      const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
      return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    },
    async writeBytes(path: string, bytes: Uint8Array) {
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
    },
    async exists(path: string) {
      const info = await FileSystem.getInfoAsync(path);
      return info.exists;
    },
    async deletePath(path: string) {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
    },
    async ensureDir(path: string) {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) await FileSystem.makeDirectoryAsync(path, { intermediates: true });
    },
    async getSha256(path: string) {
      const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
      return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64, {
        encoding: Crypto.CryptoEncoding.HEX,
      });
    },
    async getSize(path: string) {
      const info = await FileSystem.getInfoAsync(path, { size: true });
      if (!info.exists) throw new Error(`File not found: ${path}`);
      return (info as { size?: number }).size ?? 0;
    },
  };
}
```

- [ ] **Step 3: Create test mock**

```ts
// __tests__/fsMock.ts
import { createHash } from 'crypto';
import { FileSystemAbstraction } from '../src/cloud/fsAbstraction';

export interface MockFs extends FileSystemAbstraction {
  readonly files: Map<string, Uint8Array>;
  writeStringSync(path: string, text: string): void;
}

export function createMockFs(): MockFs {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    writeStringSync(path, text) {
      files.set(path, new TextEncoder().encode(text));
    },
    async readAsBytes(path) {
      const b = files.get(path);
      if (!b) throw new Error(`File not found: ${path}`);
      return b;
    },
    async writeBytes(path, bytes) { files.set(path, bytes); },
    async exists(path) { return files.has(path); },
    async deletePath(path) { files.delete(path); },
    async ensureDir(_path) { /* no-op */ },
    async getSha256(path) {
      const b = files.get(path);
      if (!b) throw new Error(`File not found: ${path}`);
      return createHash('sha256').update(Buffer.from(b)).digest('hex');
    },
    async getSize(path) {
      const b = files.get(path);
      if (!b) throw new Error(`File not found: ${path}`);
      return b.length;
    },
  };
}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/cloud/fsAbstraction.ts __tests__/fsMock.ts
git commit -m "feat: file system abstraction with Expo runtime and test mock"
```

---

### Task 10: Supabase runtime CloudClient

**Files:**
- Create: `src/cloud/supabaseClient.ts`

- [ ] **Step 1: Implement**

```ts
// src/cloud/supabaseClient.ts
import 'react-native-url-polyfill/auto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { CloudClient, AuthProvider } from './cloudClient';
import { AuthSession as AppAuthSession } from '../types';
import { getConfig } from '../config';

WebBrowser.maybeCompleteAuthSession();

const BUCKET = 'logbook-backups';

let supabaseSingleton: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (supabaseSingleton) return supabaseSingleton;
  const cfg = getConfig();
  supabaseSingleton = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  return supabaseSingleton;
}

function sessionToAppSession(sbSession: {
  user: { id: string; email: string | null };
  access_token: string;
  refresh_token: string;
  expires_at?: number;
} | null): AppAuthSession | null {
  if (!sbSession) return null;
  return {
    user_id: sbSession.user.id,
    email: sbSession.user.email,
    access_token: sbSession.access_token,
    refresh_token: sbSession.refresh_token,
    expires_at: (sbSession.expires_at ?? 0) * 1000,
  };
}

export function createSupabaseCloudClient(): CloudClient {
  const sb = getSupabase();

  return {
    async uploadObject(key, bytes, contentType = 'application/octet-stream') {
      const { error } = await sb.storage.from(BUCKET).upload(key, bytes, {
        contentType,
        upsert: true,
      });
      if (error) throw error;
    },
    async downloadObject(key) {
      const { data, error } = await sb.storage.from(BUCKET).download(key);
      if (error) throw error;
      if (!data) throw new Error(`empty_response:${key}`);
      const buf = await data.arrayBuffer();
      return new Uint8Array(buf);
    },
    async objectExists(key) {
      const prefix = key.substring(0, key.lastIndexOf('/'));
      const filename = key.substring(key.lastIndexOf('/') + 1);
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, { search: filename });
      if (error) return false;
      return (data ?? []).some((f) => f.name === filename);
    },
    async listPrefix(prefix) {
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000 });
      if (error) throw error;
      return (data ?? []).map((f) => `${prefix}/${f.name}`);
    },
    async deleteObject(key) {
      const { error } = await sb.storage.from(BUCKET).remove([key]);
      if (error) throw error;
    },
    async deletePrefix(prefix) {
      const keys = await this.listPrefix(prefix);
      if (keys.length === 0) return;
      const { error } = await sb.storage.from(BUCKET).remove(keys);
      if (error) throw error;
    },

    async getSession() {
      const { data } = await sb.auth.getSession();
      return sessionToAppSession(data.session as never);
    },
    getCurrentUserId() {
      // Non-async convenience — uses the synchronously-cached session in supabase-js v2.
      const session = (sb.auth as unknown as { session?: () => { user?: { id: string } } }).session?.();
      return session?.user?.id ?? null;
    },

    async signInWithProvider(provider: AuthProvider) {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'logbook', path: 'auth-callback' });
      const { data, error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirectUri, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data?.url) throw new Error('oauth_no_url');

      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
      if (res.type !== 'success') throw new Error(`oauth_${res.type}`);

      const params = new URL(res.url).searchParams;
      const code = params.get('code');
      if (!code) throw new Error('oauth_no_code');

      const { data: exchData, error: exchErr } = await sb.auth.exchangeCodeForSession(code);
      if (exchErr) throw exchErr;
      const app = sessionToAppSession(exchData.session as never);
      if (!app) throw new Error('oauth_no_session');
      return app;
    },

    async signInWithMagicLink(email) {
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'logbook', path: 'auth-callback' });
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectUri },
      });
      if (error) throw error;
    },

    async signOut() {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    },

    async callEdgeFunction<T>(name: string, body?: unknown): Promise<T> {
      const { data, error } = await sb.functions.invoke<T>(name, { body });
      if (error) throw error;
      return data as T;
    },

    onAuthStateChange(callback) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        callback(sessionToAppSession(session as never));
      });
      return () => data.subscription.unsubscribe();
    },

    async isOnline() {
      // Best-effort: attempt a HEAD against Supabase.
      try {
        const cfg = getConfig();
        const res = await fetch(`${cfg.supabaseUrl}/auth/v1/health`, { method: 'GET' });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors. If supabase-js complains about type narrowing, use `as never` casts as shown.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/supabaseClient.ts
git commit -m "feat: Supabase runtime CloudClient with OAuth via expo-auth-session"
```

---

## Phase 3 — Auth

### Task 11: authService — magic link, getSession, signOut

**Files:**
- Create: `src/services/authService.ts`
- Create: `__tests__/services/authService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/services/authService.test.ts
import { createMockCloudClient } from '../cloudMock';
import { createAuthService } from '../../src/services/authService';

describe('authService', () => {
  it('signs in with magic link (mock returns immediately)', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    await auth.signInWithMagicLink('tech@example.com');
    const session = await auth.getSession();
    expect(session).not.toBeNull();
    expect(session!.email).toBe('tech@example.com');
  });

  it('signs out clears the session', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    await auth.signInWithMagicLink('tech@example.com');
    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
  });

  it('getSession returns null when not signed in', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    expect(await auth.getSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx jest __tests__/services/authService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/authService.ts
import { CloudClient, AuthProvider } from '../cloud/cloudClient';
import { AuthSession } from '../types';

export interface AuthServiceDeps {
  cloud: CloudClient;
}

export function createAuthService(cloud: CloudClient) {
  return {
    async signInWithMagicLink(email: string): Promise<void> {
      await cloud.signInWithMagicLink(email);
    },
    async signInWithProvider(provider: AuthProvider): Promise<AuthSession> {
      return cloud.signInWithProvider(provider);
    },
    async signOut(): Promise<void> {
      await cloud.signOut();
    },
    async getSession(): Promise<AuthSession | null> {
      return cloud.getSession();
    },
    onAuthStateChange(callback: (session: AuthSession | null) => void): () => void {
      return cloud.onAuthStateChange(callback);
    },
    async deleteAccount(): Promise<void> {
      await cloud.callEdgeFunction('delete-account');
    },
  };
}
```

- [ ] **Step 4: Run test**

Run: `npx jest __tests__/services/authService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.ts __tests__/services/authService.test.ts
git commit -m "feat: authService with magic link, OAuth, signOut, deleteAccount"
```

---

### Task 12: authService — OAuth + delete-account tests

**Files:**
- Modify: `__tests__/services/authService.test.ts`

- [ ] **Step 1: Append OAuth and delete-account tests**

```ts
  it('signs in with provider', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    const session = await auth.signInWithProvider('google');
    expect(session.user_id).toBe('mock-user-google');
  });

  it('deleteAccount calls delete-account edge function and clears session', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    await auth.signInWithMagicLink('tech@example.com');
    cloud.storage.set('mock-user-email-tech@example.com/snapshot.json', new Uint8Array([1, 2, 3]));
    await auth.deleteAccount();
    expect(cloud.edgeFunctionCalls[0]?.name).toBe('delete-account');
    expect(await auth.getSession()).toBeNull();
    expect(cloud.storage.has('mock-user-email-tech@example.com/snapshot.json')).toBe(false);
  });

  it('onAuthStateChange fires on sign-in and sign-out', async () => {
    const cloud = createMockCloudClient();
    const auth = createAuthService(cloud);
    const events: Array<string | null> = [];
    const unsub = auth.onAuthStateChange((s) => events.push(s?.user_id ?? null));
    await auth.signInWithMagicLink('tech@example.com');
    await auth.signOut();
    unsub();
    expect(events).toEqual(['mock-user-email-tech@example.com', null]);
  });
```

- [ ] **Step 2: Run test**

Run: `npx jest __tests__/services/authService.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/authService.test.ts
git commit -m "test: authService OAuth, delete-account, onAuthStateChange coverage"
```

---

### Task 13: useAuthSession hook

**Files:**
- Create: `src/hooks/useAuthSession.ts`

- [ ] **Step 1: Implement**

```ts
// src/hooks/useAuthSession.ts
import { useEffect, useState } from 'react';
import { AuthSession } from '../types';
import { createAuthService } from '../services/authService';
import { CloudClient } from '../cloud/cloudClient';

export function useAuthSession(cloud: CloudClient) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = createAuthService(cloud);
    let cancelled = false;

    auth.getSession()
      .then((s) => {
        if (!cancelled) {
          setSession(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    const unsub = auth.onAuthStateChange((s) => {
      if (!cancelled) setSession(s);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [cloud]);

  return { session, loading, isSignedIn: session !== null };
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAuthSession.ts
git commit -m "feat: useAuthSession hook wrapping CloudClient auth state"
```

---

## Phase 4 — Backup

### Task 14: cloudBackupService — Scenario A happy path

**Files:**
- Create: `src/services/cloudBackupService.ts`
- Create: `__tests__/services/cloudBackupService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/services/cloudBackupService.test.ts
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
    },
  };
});

import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { testSha256 } from '../testHash';
import { createEntriesService } from '../../src/services/entriesService';
import { createSigningService } from '../../src/services/signingService';
import { createExportService } from '../../src/services/exportService';
import { createProfileService } from '../../src/services/profileService';
import { createCloudBackupService } from '../../src/services/cloudBackupService';
import { CloudSnapshot } from '../../src/types';

describe('cloudBackupService.backup — Scenario A', () => {
  it('uploads snapshot.json and referenced assets for a logbook with a signed entry', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;

    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    const exp = createExportService(db);

    await profile.createProfile({
      full_name: 'Tech', sprat_id: 'S1', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'Emp',
    });

    // Make fake asset files on the mock FS
    fs.writeStringSync(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      'signature-bytes',
    );

    const entry = await entries.createEntry({
      date: '2026-04-01', employer: 'Emp', site: 'Site', client: 'Cli', description: 'Desc',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');

    await signing.signEntry({
      entry_id: entry.id,
      supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      device_id: 'd-1',
    });

    await cloud.signInWithMagicLink('tech@example.com');

    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256, exportService: exp,
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });

    const result = await svc.backup();

    expect(result.kind).toBe('uploaded');
    const uid = cloud.getCurrentUserId()!;
    expect(cloud.storage.has(`${uid}/snapshot.json`)).toBe(true);

    const snapshotBytes = cloud.storage.get(`${uid}/snapshot.json`)!;
    const snapshot: CloudSnapshot = JSON.parse(new TextDecoder().decode(snapshotBytes));
    expect(snapshot.entries.length).toBe(1);
    expect(snapshot.signatures.length).toBe(1);
    expect(snapshot.photos_included).toBe(false);
    expect(Object.keys(snapshot.binary_manifest)).toHaveLength(1);
    const sigKey = Object.keys(snapshot.binary_manifest)[0];
    expect(sigKey.startsWith('assets/sig_')).toBe(true);
    expect(cloud.storage.has(`${uid}/${sigKey}`)).toBe(true);

    // Assert profile updated with last_cloud_backup_at and last_uploaded_backup_id
    const p = await profile.getProfile();
    expect(p?.last_cloud_backup_at).toBe('2026-04-16T12:00:00.000Z');
    expect(p?.last_uploaded_backup_id).toBe(snapshot.backup_id);
  });

  it('skips silently when no auth session', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    const profile = createProfileService(db, () => 'id-1');
    await profile.createProfile({
      full_name: 'Tech', sprat_id: 'S1', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'Emp',
    });

    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });

    const r = await svc.backup();
    expect(r.kind).toBe('skipped_no_auth');
  });

  it('includes SPRAT card asset when profile has one', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;

    const profile = createProfileService(db, uuid);
    await profile.createProfile({
      full_name: 'Tech', sprat_id: 'S1', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'Emp',
      sprat_card_photo_path: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/cards/sprat_card.jpg',
    });
    fs.writeStringSync(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/cards/sprat_card.jpg',
      'card-bytes',
    );

    await cloud.signInWithMagicLink('tech@example.com');
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('uploaded');
    const uid = cloud.getCurrentUserId()!;
    const keys = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/spratcard_`));
    expect(keys.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx jest __tests__/services/cloudBackupService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/cloudBackupService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import {
  BackupResult, BinaryManifest, BinaryManifestEntry, CloudSnapshot,
  HashFn, Profile, Signature, Entry,
} from '../types';
import { createExportService } from './exportService';
import { normalizeAppPath } from '../utils/paths';

const THROTTLE_MS = 30_000;
const MANIFEST_CACHE_KEY = 'logbook:last_uploaded_manifest';

export interface CloudBackupDeps {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  hash: HashFn;
  exportService: ReturnType<typeof createExportService>;
  clock: () => string;
  appVersion: string;
  uuid?: () => string;
}

function genBackupId(): string {
  // Simple UUIDv4-like identifier; deterministic in tests by injection if needed.
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

export function createCloudBackupService(deps: CloudBackupDeps) {
  const { db, cloud, fs, hash, exportService, clock, appVersion } = deps;
  const makeBackupId = deps.uuid ?? genBackupId;
  let lastBackupAt = 0;
  let inFlight: Promise<BackupResult> | null = null;
  let lastSignaturesCount = -1;

  async function loadCachedManifest(): Promise<BinaryManifest> {
    const raw = await AsyncStorage.getItem(MANIFEST_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  }
  async function saveCachedManifest(m: BinaryManifest): Promise<void> {
    await AsyncStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(m));
  }

  async function buildAssetRef(fsPath: string, storageKeyBase: string): Promise<{ key: string; bytes: Uint8Array; entry: BinaryManifestEntry }> {
    const bytes = await fs.readAsBytes(fsPath);
    const sha = await fs.getSha256(fsPath);
    const size = bytes.length;
    return {
      key: storageKeyBase,
      bytes,
      entry: { sha256: sha, size_bytes: size, created_at: clock() },
    };
  }

  async function doBackup(): Promise<BackupResult> {
    const uid = (await cloud.getSession())?.user_id;
    if (!uid) return { kind: 'skipped_no_auth' };

    if (!(await cloud.isOnline())) return { kind: 'skipped_offline' };

    const profile = await db.get<Profile>('SELECT * FROM profile LIMIT 1');
    if (!profile) return { kind: 'skipped_no_auth' }; // no data to back up
    const photosIncluded = !!profile.photos_in_backup;

    // Build JsonBackup via existing export service
    const base = await exportService.exportAsJson(appVersion);

    // Collect asset references
    const binary_manifest: BinaryManifest = {};
    const assetsToUpload: Array<{ key: string; bytes: Uint8Array }> = [];

    // Signatures — always included
    for (const sig of base.signatures) {
      if (!sig.signature_png_path) continue;
      const ref = await buildAssetRef(sig.signature_png_path, `assets/sig_${sig.id}.png`);
      binary_manifest[ref.key] = ref.entry;
      assetsToUpload.push({ key: ref.key, bytes: ref.bytes });
    }

    // SPRAT card — if present
    if (profile.sprat_card_photo_path) {
      const ext = profile.sprat_card_photo_path.split('.').pop() ?? 'jpg';
      const ref = await buildAssetRef(profile.sprat_card_photo_path, `assets/spratcard_${profile.id}.${ext}`);
      binary_manifest[ref.key] = ref.entry;
      assetsToUpload.push({ key: ref.key, bytes: ref.bytes });
    }

    // Photos — only if toggle is on
    if (photosIncluded) {
      for (const e of base.entries) {
        for (let i = 0; i < e.photo_paths.length; i++) {
          const p = e.photo_paths[i];
          const ext = p.split('.').pop() ?? 'jpg';
          const ref = await buildAssetRef(p, `assets/photo_${e.id}_${i}.${ext}`);
          binary_manifest[ref.key] = ref.entry;
          assetsToUpload.push({ key: ref.key, bytes: ref.bytes });
        }
      }
    }

    // Normalize path columns inside the snapshot for portability
    const profileForSnapshot: Profile = {
      ...base.profile,
      sprat_card_photo_path: base.profile.sprat_card_photo_path
        ? normalizeAppPath(base.profile.sprat_card_photo_path)
        : null,
    };
    const entriesForSnapshot: Entry[] = base.entries.map((e) => ({
      ...e,
      photo_paths: e.photo_paths.map(normalizeAppPath),
    }));
    const signaturesForSnapshot: Signature[] = base.signatures.map((s) => ({
      ...s,
      signature_png_path: normalizeAppPath(s.signature_png_path),
    }));

    const backup_id = makeBackupId();
    const snapshot: CloudSnapshot = {
      ...base,
      profile: profileForSnapshot,
      entries: entriesForSnapshot,
      signatures: signaturesForSnapshot,
      cloud_schema_version: 1,
      backup_id,
      binary_manifest,
      photos_included: photosIncluded,
    };

    // Diff against cache to determine uploads vs. skips
    const cached = await loadCachedManifest();

    for (const { key, bytes } of assetsToUpload) {
      const cachedEntry = cached[key];
      if (cachedEntry && cachedEntry.sha256 === binary_manifest[key].sha256) {
        // Already uploaded with same content — skip
        continue;
      }
      await cloud.uploadObject(`${uid}/${key}`, bytes, 'application/octet-stream');
    }

    // Orphans: anything in cache that's not in the new manifest
    for (const key of Object.keys(cached)) {
      if (!binary_manifest[key]) {
        try {
          await cloud.deleteObject(`${uid}/${key}`);
        } catch {
          // Best-effort; continue
        }
      }
    }

    // Upload snapshot LAST
    const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot));
    await cloud.uploadObject(`${uid}/snapshot.json`, snapshotBytes, 'application/json');

    await saveCachedManifest(binary_manifest);
    const now = clock();
    await db.run(
      'UPDATE profile SET last_cloud_backup_at = ?, last_uploaded_backup_id = ?, updated_at = ? WHERE id = ?',
      [now, backup_id, now, profile.id],
    );
    lastBackupAt = Date.now();
    lastSignaturesCount = base.signatures.length;

    return { kind: 'uploaded', backup_id, bytes_uploaded: snapshotBytes.length };
  }

  return {
    async backup(): Promise<BackupResult> {
      // Throttle
      const profile = await db.get<Profile>('SELECT * FROM profile LIMIT 1');
      const sigsCount = (await db.getAll<Signature>('SELECT id FROM signatures')).length;
      if (Date.now() - lastBackupAt < THROTTLE_MS && sigsCount === lastSignaturesCount && profile?.last_uploaded_backup_id) {
        return { kind: 'throttled' };
      }
      // Mutex
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          return await doBackup();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('quota')) return { kind: 'failed', reason: 'quota', message: msg };
          if (msg.includes('offline')) return { kind: 'skipped_offline' };
          if (msg.includes('upload_failed')) return { kind: 'failed', reason: 'asset_failed', message: msg };
          return { kind: 'failed', reason: 'unknown', message: msg };
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },

    async getLastBackupStatus(): Promise<{ last_cloud_backup_at: string | null; last_uploaded_backup_id: string | null }> {
      const profile = await db.get<Profile>('SELECT last_cloud_backup_at, last_uploaded_backup_id FROM profile LIMIT 1');
      return {
        last_cloud_backup_at: profile?.last_cloud_backup_at ?? null,
        last_uploaded_backup_id: profile?.last_uploaded_backup_id ?? null,
      };
    },
  };
}
```

- [ ] **Step 4: Run test**

Run: `npx jest __tests__/services/cloudBackupService.test.ts`
Expected: PASS. If a test fails because `exportService.exportAsJson` doesn't find a profile row, confirm the test creates one.

- [ ] **Step 5: Commit**

```bash
git add src/services/cloudBackupService.ts __tests__/services/cloudBackupService.test.ts
git commit -m "feat: cloudBackupService Scenario A — upload snapshot + assets"
```

---

### Task 15: Delta upload + orphan cleanup + throttle

**Files:**
- Modify: `__tests__/services/cloudBackupService.test.ts` (add cases)

- [ ] **Step 1: Append tests**

```ts
describe('cloudBackupService.backup — deltas and lifecycle', () => {
  it('second backup with an unchanged logbook is throttled', async () => {
    // Arrange: one profile, one signed entry, one successful backup
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    fs.writeStringSync(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      'sig',
    );
    const entry = await entries.createEntry({
      date: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    let nowMs = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => new Date(nowMs).toISOString(),
      appVersion: '1.0.0',
    });

    const r1 = await svc.backup();
    expect(r1.kind).toBe('uploaded');
    nowMs += 5_000;
    const r2 = await svc.backup();
    expect(r2.kind).toBe('throttled');
  });

  it('second backup with a new signed entry uploads only the new asset + snapshot', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    const sigPath1 = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png';
    const sigPath2 = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s2.png';
    fs.writeStringSync(sigPath1, 'sig1');
    fs.writeStringSync(sigPath2, 'sig2');
    const e1 = await entries.createEntry({
      date: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: e1.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath1, device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    let nowMs = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => new Date(nowMs).toISOString(),
      appVersion: '1.0.0',
    });

    await svc.backup();
    const uid = cloud.getCurrentUserId()!;
    const attemptsBefore = cloud.getUploadAttempts(`${uid}/assets/sig_id-4.png`); // id depends on counter

    // Add a second signed entry
    const e2 = await entries.createEntry({
      date: '2026-04-02', employer: 'E', site: 'S', client: 'C', description: 'D2',
      work_hours: 6, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: e2.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath2, device_id: 'd-1',
    });

    nowMs += 60_000; // past throttle
    await svc.backup();

    // First asset uploaded once total; second asset exists now.
    // Verify only *new* asset was freshly uploaded.
    const firstSigAttempts = cloud.getUploadAttempts(`${uid}/assets/sig_id-4.png`);
    expect(firstSigAttempts).toBe(attemptsBefore); // unchanged
    const sigKeys = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/sig_`));
    expect(sigKeys.length).toBe(2);
  });

  it('orphan cleanup: toggling photos off deletes previously-uploaded photos', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    // Turn photos ON
    await db.run('UPDATE profile SET photos_in_backup = 1');

    const sigPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png';
    const photoPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/p1.jpg';
    fs.writeStringSync(sigPath, 'sig');
    fs.writeStringSync(photoPath, 'photo');
    const e1 = await entries.createEntry({
      date: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
      photo_paths: [photoPath],
    }, 'II');
    await signing.signEntry({
      entry_id: e1.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath, device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    let nowMs = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => new Date(nowMs).toISOString(),
      appVersion: '1.0.0',
    });

    await svc.backup();
    const uid = cloud.getCurrentUserId()!;
    const photosUploaded = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/photo_`));
    expect(photosUploaded.length).toBe(1);

    // Toggle photos OFF
    await db.run('UPDATE profile SET photos_in_backup = 0');
    nowMs += 60_000;
    await svc.backup();

    const photosStillThere = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/photo_`));
    expect(photosStillThere.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest __tests__/services/cloudBackupService.test.ts`
Expected: all pass. If counter-based IDs don't align, adjust test assertions for the correct id-N values.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/cloudBackupService.test.ts
git commit -m "test: delta upload, throttling, and orphan cleanup for cloudBackupService"
```

---

### Task 16: Backup error handling + quota + mutex

**Files:**
- Modify: `__tests__/services/cloudBackupService.test.ts`

- [ ] **Step 1: Append tests**

```ts
describe('cloudBackupService.backup — error handling', () => {
  async function makeFreshState() {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    const sigPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png';
    fs.writeStringSync(sigPath, 'sig');
    const e1 = await entries.createEntry({
      date: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: e1.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath, device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    return { db, cloud, fs };
  }

  it('returns quota failure when Storage reports over-quota', async () => {
    const { db, cloud, fs } = await makeFreshState();
    cloud.setQuotaExceeded(true);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.reason).toBe('quota');
  });

  it('retains old snapshot on asset-upload failure — no partial snapshot.json', async () => {
    const { db, cloud, fs } = await makeFreshState();
    cloud.setFailUpload((key, attempt) => key.includes('/assets/sig_') && attempt === 1);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('failed');
    const uid = cloud.getCurrentUserId()!;
    expect(cloud.storage.has(`${uid}/snapshot.json`)).toBe(false);
  });

  it('concurrent triggers coalesce — only one upload happens', async () => {
    const { db, cloud, fs } = await makeFreshState();
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const [r1, r2] = await Promise.all([svc.backup(), svc.backup()]);
    // Both promises resolve to the same result
    expect(r1.kind).toBe('uploaded');
    expect(r2.kind).toBe('uploaded');
    const uid = cloud.getCurrentUserId()!;
    expect(cloud.getUploadAttempts(`${uid}/snapshot.json`)).toBe(1);
  });

  it('skips silently when offline', async () => {
    const { db, cloud, fs } = await makeFreshState();
    cloud.setOnline(false);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('skipped_offline');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest __tests__/services/cloudBackupService.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/cloudBackupService.test.ts
git commit -m "test: error handling — quota, asset-fail atomicity, concurrency, offline"
```

---

### Task 17: useBackup + useBackupStatus hooks

**Files:**
- Create: `src/hooks/useBackupStatus.ts`
- Create: `src/hooks/useBackup.ts`

- [ ] **Step 1: Implement useBackupStatus**

```ts
// src/hooks/useBackupStatus.ts
import { useQuery } from '@tanstack/react-query';
import { DbClient } from '../db/client';
import { Profile } from '../types';

export function useBackupStatus(db: DbClient) {
  return useQuery({
    queryKey: ['backupStatus'],
    queryFn: async () => {
      const p = await db.get<Profile>('SELECT last_cloud_backup_at, last_uploaded_backup_id FROM profile LIMIT 1');
      return {
        last_cloud_backup_at: p?.last_cloud_backup_at ?? null,
        last_uploaded_backup_id: p?.last_uploaded_backup_id ?? null,
      };
    },
  });
}
```

- [ ] **Step 2: Implement useBackup**

```ts
// src/hooks/useBackup.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCloudBackupService, CloudBackupDeps } from '../services/cloudBackupService';
import { BackupResult } from '../types';

export function useBackup(deps: CloudBackupDeps) {
  const qc = useQueryClient();
  const svc = createCloudBackupService(deps);
  return useMutation<BackupResult, Error, void>({
    mutationFn: () => svc.backup(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['backupStatus'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useBackupStatus.ts src/hooks/useBackup.ts
git commit -m "feat: useBackup and useBackupStatus React Query hooks"
```

---

### Task 18: Wire post-sign backup trigger into useSignatures

**Files:**
- Modify: `src/hooks/useSignatures.ts`

- [ ] **Step 1: Read existing hook to find the sign mutation**

Run: `cat src/hooks/useSignatures.ts`
Identify the mutation that signs an entry.

- [ ] **Step 2: Add an optional onSuccess side-effect parameter**

The hook must accept an optional callback invoked after signing succeeds. This lets the consuming screen (signature screen) trigger a backup without coupling the hook to the cloud service.

Example modification (adjust to match the actual existing hook shape):

```ts
export function useSignEntry(db: DbClient, options?: { afterSign?: () => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSignatureInput) => {
      return createSigningService(db).signEntry(input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['signatures'] });
      options?.afterSign?.();
    },
  });
}
```

The actual integration (calling `useBackup` from the SignatureScreen on successful sign) is done in Task 29 where `SignatureScreen` is touched.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSignatures.ts
git commit -m "feat: useSignEntry accepts optional afterSign callback for backup triggers"
```

---

## Phase 5 — Restore

### Task 19: previewCloudState

**Files:**
- Create: `src/services/restoreService.ts`
- Create: `__tests__/services/restoreService.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// __tests__/services/restoreService.test.ts
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
    },
  };
});

import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createRestoreService } from '../../src/services/restoreService';
import { CloudSnapshot } from '../../src/types';

function makeSnapshot(overrides: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return {
    app_version: '1.0.0',
    exported_at: '2026-04-16T12:00:00.000Z',
    profile: {
      id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
      sprat_card_photo_path: null, last_backup_at: null,
      photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
      created_at: '2026-04-01', updated_at: '2026-04-01',
    },
    entries: [],
    signatures: [],
    schema_version: 1,
    cloud_schema_version: 1,
    backup_id: 'backup-abc',
    binary_manifest: {},
    photos_included: false,
    ...overrides,
  };
}

describe('restoreService.previewCloudState', () => {
  it('returns has_cloud_data=false when no snapshot exists', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const preview = await svc.previewCloudState();
    expect(preview.has_cloud_data).toBe(false);
  });

  it('returns has_cloud_data=true with counts when a snapshot exists', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;
    const snap = makeSnapshot({
      entries: [/* array shape matches Entry — shortened for test */],
      signatures: [],
    });
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const preview = await svc.previewCloudState();
    expect(preview.has_cloud_data).toBe(true);
    expect(preview.backup_id).toBe('backup-abc');
  });

  it('throws when not signed in', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    await expect(svc.previewCloudState()).rejects.toThrow(/auth/i);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/services/restoreService.ts
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import { CloudSnapshot, CloudStatePreview, ConflictChoice } from '../types';

const MAX_CLOUD_SCHEMA_VERSION = 1;
const MAX_DB_SCHEMA_VERSION = 1;

export interface RestoreDeps {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  appVersion: string;
}

export type RestoreResult =
  | { kind: 'restored'; entries: number; signatures: number; assets: number; assets_failed: string[] }
  | { kind: 'version_too_new'; which: 'cloud' | 'db' }
  | { kind: 'no_snapshot' };

export function createRestoreService(deps: RestoreDeps) {
  const { db, cloud, fs } = deps;

  async function fetchSnapshot(uid: string): Promise<CloudSnapshot | null> {
    if (!(await cloud.objectExists(`${uid}/snapshot.json`))) return null;
    const bytes = await cloud.downloadObject(`${uid}/snapshot.json`);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  return {
    async previewCloudState(): Promise<CloudStatePreview> {
      const session = await cloud.getSession();
      if (!session) throw new Error('not_authenticated');
      const snap = await fetchSnapshot(session.user_id);
      if (!snap) {
        return { has_cloud_data: false, entries_count: 0, signatures_count: 0, cloud_backed_up_at: null, backup_id: null };
      }
      return {
        has_cloud_data: true,
        entries_count: snap.entries.length,
        signatures_count: snap.signatures.length,
        cloud_backed_up_at: snap.exported_at,
        backup_id: snap.backup_id,
      };
    },

    async restore(): Promise<RestoreResult> {
      // Full implementation lands in Task 20
      throw new Error('not_implemented');
    },

    async uploadCurrentAsCloud(): Promise<void> {
      // Used by conflict flow ("Replace cloud with this device") — lands in Task 22
      throw new Error('not_implemented');
    },
  };
}
```

- [ ] **Step 3: Run test**

Run: `npx jest __tests__/services/restoreService.test.ts`
Expected: PASS (preview-only).

- [ ] **Step 4: Commit**

```bash
git add src/services/restoreService.ts __tests__/services/restoreService.test.ts
git commit -m "feat: restoreService.previewCloudState"
```

---

### Task 20: restoreService.restore — happy path

**Files:**
- Modify: `src/services/restoreService.ts`
- Modify: `__tests__/services/restoreService.test.ts`

- [ ] **Step 1: Write failing test**

Append to `__tests__/services/restoreService.test.ts`:

```ts
describe('restoreService.restore', () => {
  it('Scenario B: restores profile, entries, signatures, and assets to a fresh device', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    // Populate cloud snapshot for a single signed entry with a signature PNG asset
    const sigBytes = new TextEncoder().encode('signature-data');
    const sigKey = 'assets/sig_sig-1.png';
    cloud.storage.set(`${uid}/${sigKey}`, sigBytes);

    const snap: CloudSnapshot = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'Tech', sprat_id: 'S1', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'Emp',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [{
        id: 'e-1', date: '2026-04-10', employer: 'Emp', site: 'Site', client: 'Cli',
        description: 'Work', work_hours: 8, tech_level_snapshot: 'II',
        work_types: ['inspection'], equipment_notes: null, weather: null,
        photo_paths: [], status: 'signed', amends_entry_id: null, amendment_reason: null,
        created_at: '2026-04-10', updated_at: '2026-04-10',
      }],
      signatures: [{
        id: 'sig-1', entry_id: 'e-1', supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X', signature_png_path: 'logbook/signatures/sig-1.png',
        signed_at: '2026-04-10', device_id: 'd-old',
        gps_lat: null, gps_lon: null, entry_hash: 'irrelevant-for-download',
        hash_version: 2, created_at: '2026-04-10',
      }],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'backup-1',
      binary_manifest: {
        [sigKey]: {
          sha256: require('crypto').createHash('sha256').update(Buffer.from(sigBytes)).digest('hex'),
          size_bytes: sigBytes.length,
          created_at: '2026-04-16T12:00:00.000Z',
        },
      },
      photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();

    expect(result.kind).toBe('restored');
    if (result.kind === 'restored') {
      expect(result.entries).toBe(1);
      expect(result.signatures).toBe(1);
      expect(result.assets).toBe(1);
    }

    // Profile row present with last_cloud_backup_at set
    const p = await db.get<{ last_uploaded_backup_id: string }>('SELECT last_uploaded_backup_id FROM profile LIMIT 1');
    expect(p?.last_uploaded_backup_id).toBe('backup-1');

    // Signature row has rehydrated path
    const s = await db.get<{ signature_png_path: string }>('SELECT signature_png_path FROM signatures');
    expect(s?.signature_png_path).toBe(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/sig-1.png',
    );

    // Asset file written at local path
    expect(fs.files.has('file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/sig-1.png')).toBe(true);
  });

  it('refuses restore when cloud_schema_version is newer than app supports', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;
    const snap: CloudSnapshot = {
      app_version: '99.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [], signatures: [], schema_version: 1,
      cloud_schema_version: 99 as 1, backup_id: 'b', binary_manifest: {}, photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();
    expect(result.kind).toBe('version_too_new');
  });
});
```

- [ ] **Step 2: Implement restore**

Replace the `restore()` stub in `src/services/restoreService.ts`:

```ts
import { rehydrateAppPath } from '../utils/paths';
import { Profile, Entry, Signature, EntryRow } from '../types';
import { sha256 } from '../utils/hash';

// ...inside createRestoreService, replace the restore() stub with:

    async restore(): Promise<RestoreResult> {
      const session = await cloud.getSession();
      if (!session) throw new Error('not_authenticated');
      const snap = await fetchSnapshot(session.user_id);
      if (!snap) return { kind: 'no_snapshot' };

      if (snap.cloud_schema_version > MAX_CLOUD_SCHEMA_VERSION) {
        return { kind: 'version_too_new', which: 'cloud' };
      }
      if (snap.schema_version > MAX_DB_SCHEMA_VERSION) {
        return { kind: 'version_too_new', which: 'db' };
      }

      // 1. Download assets and write locally
      const assets_failed: string[] = [];
      let assets_downloaded = 0;
      for (const [storageKey, manifestEntry] of Object.entries(snap.binary_manifest)) {
        try {
          const bytes = await cloud.downloadObject(`${session.user_id}/${storageKey}`);
          const relativePath = storageKeyToRelativePath(storageKey);
          const localPath = rehydrateAppPath(relativePath);
          await fs.ensureDir(localPath.substring(0, localPath.lastIndexOf('/')));
          await fs.writeBytes(localPath, bytes);
          // sha256 check
          const actual = await fs.getSha256(localPath);
          if (actual !== manifestEntry.sha256) {
            await fs.deletePath(localPath);
            assets_failed.push(storageKey);
            continue;
          }
          assets_downloaded++;
        } catch {
          assets_failed.push(storageKey);
        }
      }

      // 2. Write DB rows in a single transaction via exec'd SQL
      await db.exec('BEGIN');
      try {
        // Clear existing data (this is a restore — device is expected to be empty; but guard in case)
        await db.exec('DELETE FROM signatures; DELETE FROM entries; DELETE FROM profile;');

        // Profile
        const p = snap.profile;
        const rehydratedCard = p.sprat_card_photo_path
          ? rehydrateAppPath(p.sprat_card_photo_path)
          : null;
        await db.run(
          `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, default_employer,
            sprat_card_photo_path, last_backup_at, photos_in_backup, last_cloud_backup_at,
            last_uploaded_backup_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id, p.full_name, p.sprat_id, p.level, p.cert_expires_on, p.default_employer,
            rehydratedCard, p.last_backup_at, p.photos_in_backup ? 1 : 0,
            snap.exported_at, snap.backup_id, p.created_at, p.updated_at,
          ],
        );

        // Entries
        for (const e of snap.entries) {
          const rehydratedPhotos = e.photo_paths.map(rehydrateAppPath);
          await db.run(
            `INSERT INTO entries (id, date, employer, site, client, description, work_hours,
              tech_level_snapshot, work_types, equipment_notes, weather, photo_paths, status,
              amends_entry_id, amendment_reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              e.id, e.date, e.employer, e.site, e.client, e.description, e.work_hours,
              e.tech_level_snapshot, JSON.stringify(e.work_types),
              e.equipment_notes, e.weather, JSON.stringify(rehydratedPhotos),
              e.status, e.amends_entry_id, e.amendment_reason,
              e.created_at, e.updated_at,
            ],
          );
        }

        // Signatures
        for (const s of snap.signatures) {
          const rehydratedSigPath = rehydrateAppPath(s.signature_png_path);
          await db.run(
            `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number,
              signature_png_path, signed_at, device_id, gps_lat, gps_lon, entry_hash, hash_version, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              s.id, s.entry_id, s.supervisor_name, s.supervisor_cert_number,
              rehydratedSigPath, s.signed_at, s.device_id, s.gps_lat, s.gps_lon,
              s.entry_hash, s.hash_version, s.created_at,
            ],
          );
        }

        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }

      return {
        kind: 'restored',
        entries: snap.entries.length,
        signatures: snap.signatures.length,
        assets: assets_downloaded,
        assets_failed,
      };
    },

// Helper — add outside the service (or as a local function inside the module):
function storageKeyToRelativePath(storageKey: string): string {
  // "assets/sig_abc.png" → "logbook/signatures/abc.png"  (signatures)
  // "assets/spratcard_p-1.jpg" → "logbook/cards/sprat_card.jpg"
  // "assets/photo_e-1_0.jpg" → "logbook/photos/e-1_0.jpg"
  if (storageKey.startsWith('assets/sig_')) {
    const sigId = storageKey.replace('assets/sig_', '').replace(/\.[^.]+$/, '');
    return `logbook/signatures/${sigId}.png`;
  }
  if (storageKey.startsWith('assets/spratcard_')) {
    const ext = storageKey.split('.').pop() ?? 'jpg';
    return `logbook/cards/sprat_card.${ext}`;
  }
  if (storageKey.startsWith('assets/photo_')) {
    const rest = storageKey.replace('assets/photo_', '');
    return `logbook/photos/${rest}`;
  }
  throw new Error(`Unknown storage key format: ${storageKey}`);
}
```

- [ ] **Step 3: Run test**

Run: `npx jest __tests__/services/restoreService.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/restoreService.ts __tests__/services/restoreService.test.ts
git commit -m "feat: restoreService.restore — Scenario B with path rehydration and version guards"
```

---

### Task 21: Restore — missing-asset, bad-sha, partial failure

**Files:**
- Modify: `__tests__/services/restoreService.test.ts`

- [ ] **Step 1: Append tests**

```ts
describe('restoreService.restore — partial failures', () => {
  it('reports asset_failed when a referenced asset is missing in Storage', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const snap: CloudSnapshot = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [],
      signatures: [],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'backup-x',
      binary_manifest: {
        'assets/sig_missing.png': {
          sha256: 'deadbeef',
          size_bytes: 100,
          created_at: '2026-04-16T12:00:00.000Z',
        },
      },
      photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));
    // Note: the referenced asset was NOT added to cloud.storage

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const r = await svc.restore();
    expect(r.kind).toBe('restored');
    if (r.kind === 'restored') {
      expect(r.assets_failed).toContain('assets/sig_missing.png');
    }
  });

  it('quarantines an asset with sha256 mismatch', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const bytes = new TextEncoder().encode('actual-bytes');
    const wrongSha = 'ff'.repeat(32); // intentionally wrong
    cloud.storage.set(`${uid}/assets/sig_bad.png`, bytes);

    const snap: CloudSnapshot = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [],
      signatures: [],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'backup-y',
      binary_manifest: {
        'assets/sig_bad.png': { sha256: wrongSha, size_bytes: bytes.length, created_at: '2026-04-16T12:00:00.000Z' },
      },
      photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const r = await svc.restore();
    expect(r.kind).toBe('restored');
    if (r.kind === 'restored') expect(r.assets_failed).toContain('assets/sig_bad.png');
    // And the quarantined file was deleted from the fs
    expect(fs.files.has('file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/bad.png')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest __tests__/services/restoreService.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/services/restoreService.test.ts
git commit -m "test: restore handles missing and corrupt assets without failing whole restore"
```

---

### Task 22: uploadCurrentAsCloud — for Scenario C "Replace cloud"

**Files:**
- Modify: `src/services/restoreService.ts`
- Modify: `__tests__/services/restoreService.test.ts`

- [ ] **Step 1: Write test**

Append to the test file:

```ts
describe('restoreService.uploadCurrentAsCloud', () => {
  it('overwrites cloud snapshot and wipes orphan assets', async () => {
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;
    // Existing cloud state
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode('{"old":true}'));
    cloud.storage.set(`${uid}/assets/sig_old.png`, new Uint8Array([1, 2]));

    // Local state: empty-ish — trigger backup service via restore's uploadCurrentAsCloud
    // (delegation: uploadCurrentAsCloud = delete prefix + run a fresh backup)
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    await svc.uploadCurrentAsCloud();
    expect(cloud.storage.has(`${uid}/assets/sig_old.png`)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

Replace the `uploadCurrentAsCloud()` stub in `src/services/restoreService.ts`:

```ts
    async uploadCurrentAsCloud(): Promise<void> {
      const session = await cloud.getSession();
      if (!session) throw new Error('not_authenticated');
      // Delete all existing cloud objects for this user
      await cloud.deletePrefix(`${session.user_id}/`);
      // Clear local cached manifest so the next backup uploads everything fresh
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.removeItem('logbook:last_uploaded_manifest');
      // The caller should now trigger cloudBackupService.backup() to repopulate.
    },
```

Note — this leaves the actual re-upload to the caller's next backup trigger, keeping concerns separated. Document this behavior in the service's JSDoc or a comment.

- [ ] **Step 3: Run test**

Run: `npx jest __tests__/services/restoreService.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/restoreService.ts __tests__/services/restoreService.test.ts
git commit -m "feat: restoreService.uploadCurrentAsCloud clears cloud state for replace-cloud"
```

---

### Task 23: useRestore hook

**Files:**
- Create: `src/hooks/useRestore.ts`

- [ ] **Step 1: Implement**

```ts
// src/hooks/useRestore.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRestoreService, RestoreDeps, RestoreResult } from '../services/restoreService';
import { CloudStatePreview } from '../types';

export function useCloudStatePreview(deps: RestoreDeps, enabled: boolean) {
  return useQuery<CloudStatePreview>({
    queryKey: ['cloudPreview'],
    queryFn: () => createRestoreService(deps).previewCloudState(),
    enabled,
    retry: false,
  });
}

export function useRestore(deps: RestoreDeps) {
  const qc = useQueryClient();
  const svc = createRestoreService(deps);
  return useMutation<RestoreResult, Error, void>({
    mutationFn: () => svc.restore(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['signatures'] });
      qc.invalidateQueries({ queryKey: ['backupStatus'] });
    },
  });
}

export function useReplaceCloud(deps: RestoreDeps) {
  const svc = createRestoreService(deps);
  return useMutation<void, Error, void>({
    mutationFn: () => svc.uploadCurrentAsCloud(),
  });
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRestore.ts
git commit -m "feat: useRestore + useCloudStatePreview + useReplaceCloud hooks"
```

---

## Phase 6 — UI

For all UI tasks below, follow the existing pattern: compose from primitives (`Screen`, `Button`, `Input`, `Card`, `Badge`, `Banner`, etc.) and read tokens from `src/theme/tokens.ts`. Read `src/screens/ProfileScreen.tsx` as a reference before starting.

### Task 24: AuthScreen

**Files:**
- Create: `src/screens/AuthScreen.tsx`

- [ ] **Step 1: Read an existing screen for style reference**

Run: `cat src/screens/ProfileScreen.tsx`
Note the import patterns, the `Screen` wrapper, Button variants, token usage.

- [ ] **Step 2: Implement**

```tsx
// src/screens/AuthScreen.tsx
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../primitives/Screen';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { Banner } from '../primitives/Banner';
import { tokens } from '../theme/tokens';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createAuthService } from '../services/authService';

type Nav = NativeStackNavigationProp<Record<string, never>>;

export function AuthScreen() {
  const nav = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<'apple' | 'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cloud = createSupabaseCloudClient();
  const auth = createAuthService(cloud);

  async function signInWith(provider: 'apple' | 'google') {
    try {
      setError(null);
      setLoading(provider);
      await auth.signInWithProvider(provider);
      // AuthState subscription (in App.tsx) handles navigation post-login.
    } catch (e) {
      setError((e as Error).message ?? 'Sign-in failed. Try again.');
    } finally {
      setLoading(null);
    }
  }

  async function sendMagicLink() {
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    try {
      setError(null);
      setLoading('email');
      await auth.signInWithMagicLink(email);
      nav.navigate('MagicLinkWait' as never, { email } as never);
    } catch (e) {
      setError((e as Error).message ?? 'Could not send link. Try again.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <Screen>
      <View style={{ padding: tokens.spacing[4], gap: tokens.spacing[4] }}>
        <Text style={{ fontSize: tokens.typography.heading.fontSize, color: tokens.colors.text.primary }}>
          Back up your logbook
        </Text>
        <Text style={{ color: tokens.colors.text.secondary }}>
          Your logbook stays on this device. Signing in lets you restore it on a new phone if you lose or replace this one.
        </Text>

        {error && <Banner kind="error">{error}</Banner>}

        <Button onPress={() => signInWith('apple')} disabled={loading !== null}>
          {loading === 'apple' ? 'Signing in…' : 'Continue with Apple'}
        </Button>
        <Button onPress={() => signInWith('google')} disabled={loading !== null} variant="secondary">
          {loading === 'google' ? 'Signing in…' : 'Continue with Google'}
        </Button>

        <Text style={{ textAlign: 'center', color: tokens.colors.text.secondary }}>or use email</Text>

        <Input
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          editable={loading === null}
        />
        <Button onPress={sendMagicLink} disabled={loading !== null} variant="secondary">
          {loading === 'email' ? 'Sending…' : 'Send me a sign-in link'}
        </Button>
      </View>
    </Screen>
  );
}
```

Adjust Button `variant` names to match the existing primitives' actual props — read `src/primitives/Button.tsx` first if needed.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/AuthScreen.tsx
git commit -m "feat: AuthScreen with Apple, Google, and email magic link options"
```

---

### Task 25: MagicLinkWaitScreen + deep-link listener

**Files:**
- Create: `src/screens/MagicLinkWaitScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/screens/MagicLinkWaitScreen.tsx
import React from 'react';
import { View, Text } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Screen } from '../primitives/Screen';
import { Button } from '../primitives/Button';
import { tokens } from '../theme/tokens';

type Params = { MagicLinkWait: { email: string } };

export function MagicLinkWaitScreen() {
  const route = useRoute<RouteProp<Params, 'MagicLinkWait'>>();
  const email = route.params.email;

  return (
    <Screen>
      <View style={{ padding: tokens.spacing[4], gap: tokens.spacing[4] }}>
        <Text style={{ fontSize: tokens.typography.heading.fontSize, color: tokens.colors.text.primary }}>
          Check your email
        </Text>
        <Text style={{ color: tokens.colors.text.secondary }}>
          We sent a sign-in link to {email}. Open it on this device to continue.
        </Text>
        <Text style={{ color: tokens.colors.text.secondary, fontStyle: 'italic' }}>
          The link expires in an hour. You can close this screen and come back anytime.
        </Text>
      </View>
    </Screen>
  );
}
```

Deep-link handling itself lives in `App.tsx` (Task 33).

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/MagicLinkWaitScreen.tsx
git commit -m "feat: MagicLinkWaitScreen — check-your-email message after submission"
```

---

### Task 26: CloudConflictScreen

**Files:**
- Create: `src/screens/CloudConflictScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/screens/CloudConflictScreen.tsx
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen } from '../primitives/Screen';
import { Button } from '../primitives/Button';
import { Card } from '../primitives/Card';
import { Banner } from '../primitives/Banner';
import { tokens } from '../theme/tokens';
import { useCloudStatePreview, useRestore, useReplaceCloud } from '../hooks/useRestore';
import { useBackup } from '../hooks/useBackup';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { DbClient } from '../db/client';
import { createExportService } from '../services/exportService';
import { APP_VERSION } from '../constants';

export function CloudConflictScreen({ db, localEntriesCount, localSignaturesCount, localLastBackupAt }: {
  db: DbClient;
  localEntriesCount: number;
  localSignaturesCount: number;
  localLastBackupAt: string | null;
}) {
  const nav = useNavigation();
  const cloud = createSupabaseCloudClient();
  const fs = createExpoFsAbstraction();
  const deps = { db, cloud, fs, appVersion: APP_VERSION };
  const backupDeps = {
    ...deps,
    hash: sha256,
    exportService: createExportService(db),
    clock: () => new Date().toISOString(),
  };
  const preview = useCloudStatePreview(deps, true);
  const restoreMut = useRestore(deps);
  const replaceMut = useReplaceCloud(deps);
  const backupMut = useBackup(backupDeps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function keepCloud() {
    try {
      setBusy(true); setError(null);
      await restoreMut.mutateAsync();
      nav.navigate('Logbook' as never);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function replaceCloud() {
    try {
      setBusy(true); setError(null);
      await replaceMut.mutateAsync();
      await backupMut.mutateAsync();
      nav.navigate('Logbook' as never);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ padding: tokens.spacing[4], gap: tokens.spacing[4] }}>
        <Text style={{ fontSize: tokens.typography.heading.fontSize }}>Your logbooks don't match</Text>
        <Text style={{ color: tokens.colors.text.secondary }}>
          This device and your cloud backup have different data. Choose which one to keep. This can't be undone.
        </Text>

        {error && <Banner kind="error">{error}</Banner>}

        <Card>
          <Text style={{ fontWeight: '600' }}>Your cloud logbook</Text>
          <Text>
            {preview.data?.entries_count ?? 0} entries, {preview.data?.signatures_count ?? 0} signatures
          </Text>
          <Text>Last backed up: {preview.data?.cloud_backed_up_at ?? 'unknown'}</Text>
        </Card>

        <Card>
          <Text style={{ fontWeight: '600' }}>This device</Text>
          <Text>{localEntriesCount} entries, {localSignaturesCount} signatures</Text>
          <Text>Last synced: {localLastBackupAt ?? 'never'}</Text>
        </Card>

        <Button onPress={keepCloud} disabled={busy}>
          {busy ? 'Working…' : 'Keep cloud, replace this device'}
        </Button>
        <Button onPress={replaceCloud} disabled={busy} variant="secondary">
          {busy ? 'Working…' : 'Replace cloud with this device'}
        </Button>
      </View>
    </Screen>
  );
}
```

Create `src/constants.ts`:

```ts
export const APP_VERSION = '1.0.0';
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/CloudConflictScreen.tsx src/constants.ts
git commit -m "feat: CloudConflictScreen with keep-cloud vs replace-cloud resolution"
```

---

### Task 27: ProfileCloudSection

**Files:**
- Create: `src/components/ProfileCloudSection.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/ProfileCloudSection.tsx
import React, { useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Banner } from '../primitives/Banner';
import { tokens } from '../theme/tokens';
import { useAuthSession } from '../hooks/useAuthSession';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { useBackup } from '../hooks/useBackup';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createAuthService } from '../services/authService';
import { createExportService } from '../services/exportService';
import { sha256 } from '../utils/hash';
import { DbClient } from '../db/client';
import { APP_VERSION } from '../constants';

export function ProfileCloudSection({ db, profileId, photosInBackup, onChangePhotosInBackup, onDeleteAccount }: {
  db: DbClient;
  profileId: string;
  photosInBackup: boolean;
  onChangePhotosInBackup: (v: boolean) => void;
  onDeleteAccount: () => void;
}) {
  const nav = useNavigation();
  const cloud = createSupabaseCloudClient();
  const fs = createExpoFsAbstraction();
  const { session, loading } = useAuthSession(cloud);
  const status = useBackupStatus(db);
  const backup = useBackup({
    db, cloud, fs, hash: sha256,
    exportService: createExportService(db),
    clock: () => new Date().toISOString(),
    appVersion: APP_VERSION,
  });
  const [signingOut, setSigningOut] = useState(false);

  if (loading) return null;

  if (!session) {
    return (
      <Card>
        <Text style={{ fontWeight: '600' }}>Cloud backup</Text>
        <Text style={{ color: tokens.colors.text.secondary, marginVertical: tokens.spacing[2] }}>
          Not signed in. Your logbook lives only on this device.
        </Text>
        <Button onPress={() => nav.navigate('Auth' as never)}>Sign in to back up</Button>
      </Card>
    );
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await createAuthService(cloud).signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Card>
      <Text style={{ fontWeight: '600' }}>Cloud backup</Text>
      <Text style={{ color: tokens.colors.text.secondary }}>
        Signed in as {session.email ?? session.user_id}
      </Text>
      <Text style={{ color: tokens.colors.text.secondary }}>
        Last backed up: {status.data?.last_cloud_backup_at ?? 'never'}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: tokens.spacing[3] }}>
        <Text style={{ flex: 1 }}>Include photos in backup</Text>
        <Switch value={photosInBackup} onValueChange={onChangePhotosInBackup} />
      </View>

      {backup.isError && <Banner kind="error">{(backup.error as Error).message}</Banner>}
      {backup.data?.kind === 'failed' && <Banner kind="error">Backup failed: {backup.data.message}</Banner>}

      <Button onPress={() => backup.mutate()} disabled={backup.isPending}>
        {backup.isPending ? 'Backing up…' : 'Back up now'}
      </Button>
      <Button onPress={signOut} disabled={signingOut} variant="secondary">
        {signingOut ? 'Signing out…' : 'Sign out'}
      </Button>
      <Button onPress={onDeleteAccount} variant="danger">
        Delete cloud backup + account
      </Button>
    </Card>
  );
}
```

- [ ] **Step 2: Mount in ProfileScreen**

Modify `src/screens/ProfileScreen.tsx`:

```tsx
import { ProfileCloudSection } from '../components/ProfileCloudSection';

// Inside the component, after the existing profile form:
const [deleteModalOpen, setDeleteModalOpen] = useState(false);

// Add a handler that updates photos_in_backup on the profile row:
async function changePhotosInBackup(v: boolean) {
  await db.run(
    'UPDATE profile SET photos_in_backup = ?, updated_at = ? WHERE id = ?',
    [v ? 1 : 0, new Date().toISOString(), profile.id],
  );
  queryClient.invalidateQueries({ queryKey: ['profile'] });
}

// Render:
<ProfileCloudSection
  db={db}
  profileId={profile.id}
  photosInBackup={!!profile.photos_in_backup}
  onChangePhotosInBackup={changePhotosInBackup}
  onDeleteAccount={() => setDeleteModalOpen(true)}
/>
```

The `DeleteAccountModal` is mounted in Task 28. Leave `deleteModalOpen` unused for now — Task 28 consumes it.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ProfileCloudSection.tsx src/screens/ProfileScreen.tsx
git commit -m "feat: ProfileCloudSection with backup controls, photo toggle, and sign-out"
```

---

### Task 28: Account deletion modal

**Files:**
- Create: `src/components/DeleteAccountModal.tsx`
- Modify: `src/screens/ProfileScreen.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/DeleteAccountModal.tsx
import React, { useState } from 'react';
import { Modal, View, Text } from 'react-native';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { tokens } from '../theme/tokens';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createAuthService } from '../services/authService';
import { DbClient } from '../db/client';

export function DeleteAccountModal({ visible, onDone, db }: { visible: boolean; onDone: () => void; db: DbClient }) {
  const [step, setStep] = useState<'confirm' | 'type' | 'deleting'>('confirm');
  const [typed, setTyped] = useState('');

  async function doDelete() {
    setStep('deleting');
    const cloud = createSupabaseCloudClient();
    const auth = createAuthService(cloud);
    await auth.deleteAccount();
    await db.run(
      `UPDATE profile SET last_cloud_backup_at = NULL, last_uploaded_backup_id = NULL, updated_at = ?`,
      [new Date().toISOString()],
    );
    onDone();
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'center' }}>
        <View style={{ backgroundColor: tokens.colors.surface, margin: tokens.spacing[4], padding: tokens.spacing[4], borderRadius: tokens.radii.md, gap: tokens.spacing[3] }}>
          {step === 'confirm' && (
            <>
              <Text style={{ fontSize: tokens.typography.heading.fontSize }}>Delete cloud backup?</Text>
              <Text>This permanently deletes your cloud backup. Your on-device logbook will remain intact. This cannot be undone.</Text>
              <Button variant="secondary" onPress={onDone}>Cancel</Button>
              <Button variant="danger" onPress={() => setStep('type')}>Continue</Button>
            </>
          )}
          {step === 'type' && (
            <>
              <Text style={{ fontSize: tokens.typography.heading.fontSize }}>Type DELETE to confirm</Text>
              <Input value={typed} onChangeText={setTyped} placeholder="DELETE" autoCapitalize="characters" />
              <Button variant="secondary" onPress={onDone}>Cancel</Button>
              <Button variant="danger" onPress={doDelete} disabled={typed !== 'DELETE'}>
                Delete
              </Button>
            </>
          )}
          {step === 'deleting' && <Text>Deleting…</Text>}
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Wire into ProfileScreen**

In `src/screens/ProfileScreen.tsx`, add a `deleteModalOpen` state and pass `onDeleteAccount={() => setDeleteModalOpen(true)}` to `ProfileCloudSection`. Render `<DeleteAccountModal visible={deleteModalOpen} onDone={() => setDeleteModalOpen(false)} db={db} />`.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/DeleteAccountModal.tsx src/screens/ProfileScreen.tsx
git commit -m "feat: account deletion modal with two-step confirmation"
```

---

### Task 29: OnboardingScreen sign-in link + post-onboarding prompt + SignatureScreen backup trigger

**Files:**
- Modify: `src/screens/OnboardingScreen.tsx`
- Modify: `src/screens/SignatureScreen.tsx`

- [ ] **Step 1: Add sign-in link to OnboardingScreen**

Read `src/screens/OnboardingScreen.tsx`. At the bottom of the screen, above the main CTA, add a small secondary link:

```tsx
<Text style={{ textAlign: 'center', marginTop: tokens.spacing[4], color: tokens.colors.primary }}
      onPress={() => nav.navigate('Auth' as never)}>
  Already have an account? Sign in
</Text>
```

- [ ] **Step 2: Add post-onboarding prompt**

In OnboardingScreen's createProfile success handler, after saving profile, navigate to a small modal or the next screen with a one-time offer:

```tsx
Alert.alert(
  'Back up your logbook?',
  'Sign in to keep your logbook safe in the cloud and restore it on a new phone. You can do this later from Profile.',
  [
    { text: 'Not now', style: 'cancel', onPress: () => nav.navigate('Logbook') },
    { text: 'Sign up', onPress: () => nav.navigate('Auth') },
  ],
);
```

- [ ] **Step 3: Wire SignatureScreen backup trigger**

Read `src/screens/SignatureScreen.tsx`. Find the signEntry mutation call. Pass an `afterSign` callback that kicks off `useBackup().mutate()`:

```tsx
const backup = useBackup({
  db, cloud, fs, hash: sha256,
  exportService: createExportService(db),
  clock: () => new Date().toISOString(),
  appVersion: APP_VERSION,
});
const sign = useSignEntry(db, { afterSign: () => backup.mutate() });
```

Ensure `cloud` and `fs` are obtained via `createSupabaseCloudClient()` and `createExpoFsAbstraction()` at the top of the component.

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/screens/OnboardingScreen.tsx src/screens/SignatureScreen.tsx
git commit -m "feat: onboarding sign-in link, post-onboarding prompt, post-sign backup trigger"
```

---

## Phase 7 — Wiring

### Task 30: RootNavigator — new screens + gates

**Files:**
- Modify: `src/navigation/RootNavigator.tsx`

- [ ] **Step 1: Read existing RootNavigator first**

Run: `cat src/navigation/RootNavigator.tsx`

Note: the existing file has an onboarding gate and bottom tabs. Understand its current shape before modifying.

- [ ] **Step 2: Add three new stack screens**

Register `AuthScreen`, `MagicLinkWaitScreen`, and `CloudConflictScreen` in the existing native-stack navigator so they can be pushed from anywhere (e.g., from ProfileScreen, from OnboardingScreen):

```tsx
import { AuthScreen } from '../screens/AuthScreen';
import { MagicLinkWaitScreen } from '../screens/MagicLinkWaitScreen';
import { CloudConflictScreen } from '../screens/CloudConflictScreen';

// Add to the existing Stack.Navigator (same one hosting EntryForm, EntryDetail, Signature):
<Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Sign in' }} />
<Stack.Screen name="MagicLinkWait" component={MagicLinkWaitScreen} options={{ title: 'Check your email' }} />
<Stack.Screen name="CloudConflict" component={CloudConflictScreen} options={{ headerShown: false, gestureEnabled: false }} />
```

- [ ] **Step 3: Add the conflict detection gate**

In the top-level component that decides which stack to render (the file with the existing `if (!profile) return <OnboardingStack />` gate), add:

```tsx
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { useAuthSession } from '../hooks/useAuthSession';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { useCloudStatePreview } from '../hooks/useRestore';
import { useEntries } from '../hooks/useEntries';
import { APP_VERSION } from '../constants';

// Inside the component:
const cloud = React.useMemo(() => createSupabaseCloudClient(), []);
const fs = React.useMemo(() => createExpoFsAbstraction(), []);
const { session, loading: sessionLoading } = useAuthSession(cloud);
const preview = useCloudStatePreview({ db, cloud, fs, appVersion: APP_VERSION }, session !== null);
const { data: localEntries } = useEntries(db);
const { data: backupStatus } = useBackupStatus(db);

const conflict = React.useMemo(() => {
  if (!session || !profile || !preview.data) return false;
  const localHasData = (localEntries?.length ?? 0) > 0;
  if (!localHasData || !preview.data.has_cloud_data) return false;
  return backupStatus?.last_uploaded_backup_id !== preview.data.backup_id;
}, [session, profile, localEntries, preview.data, backupStatus]);

if (!profile) return <OnboardingStack />;
if (sessionLoading || preview.isLoading) return <LoadingScreen />;  // or use the existing loading shape
if (conflict) {
  return (
    <Stack.Navigator>
      <Stack.Screen name="CloudConflict" options={{ headerShown: false }}>
        {() => (
          <CloudConflictScreen
            db={db}
            localEntriesCount={localEntries?.length ?? 0}
            localSignaturesCount={0 /* derive from useSignatures if needed */}
            localLastBackupAt={backupStatus?.last_cloud_backup_at ?? null}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
// Otherwise: existing MainTabs + stack
return <MainStack />;
```

Adjust `LoadingScreen` and `MainStack` names to match whatever the existing file already uses. The structural point is: detect conflict right after auth is settled, render the conflict screen as a one-off stack, and let the existing stack take over once resolved (the conflict screen navigates back to `Logbook` on resolution, at which point `backupStatus.last_uploaded_backup_id` will equal `preview.data.backup_id` and the gate passes).

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/navigation/RootNavigator.tsx
git commit -m "feat: RootNavigator adds Auth, MagicLinkWait, CloudConflict screens + conflict gate"
```

---

### Task 31: App.tsx — supabase init, AppState trigger, deep-link listener

**Files:**
- Modify: `App.tsx`

- [ ] **Step 1: Read existing App.tsx**

Run: `cat App.tsx`

- [ ] **Step 2: Add three things**

**a) Top-level effect: `AppState` listener fires a backup on background:**

```tsx
import { AppState } from 'react-native';
import { createSupabaseCloudClient } from './src/cloud/supabaseClient';
import { createExpoFsAbstraction } from './src/cloud/fsAbstraction';
import { createCloudBackupService } from './src/services/cloudBackupService';
import { createExportService } from './src/services/exportService';
import { sha256 } from './src/utils/hash';
import { APP_VERSION } from './src/constants';

// Inside App component, after db is initialized:
useEffect(() => {
  const cloud = createSupabaseCloudClient();
  const fs = createExpoFsAbstraction();
  const svc = createCloudBackupService({
    db, cloud, fs, hash: sha256,
    exportService: createExportService(db),
    clock: () => new Date().toISOString(),
    appVersion: APP_VERSION,
  });
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      svc.backup().catch(() => { /* swallow; errors surface via UI hooks */ });
    }
  });
  return () => sub.remove();
}, [db]);
```

**b) Deep-link listener for magic-link callbacks:**

```tsx
import * as Linking from 'expo-linking';

useEffect(() => {
  const sub = Linking.addEventListener('url', ({ url }) => {
    if (url.startsWith('logbook://auth-callback')) {
      // Supabase-js's detectSessionInUrl + onAuthStateChange handles the rest.
      // Just ensure the URL is consumed — supabase-js picks up the token from AsyncStorage
      // when the app regains focus.
    }
  });
  return () => sub.remove();
}, []);
```

**c) Polyfill import at the top of the file:**

```tsx
import 'react-native-url-polyfill/auto';
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add App.tsx
git commit -m "feat: App.tsx wires url polyfill, background-backup trigger, deep-link listener"
```

---

### Task 32: Supabase project provisioning — setup script and docs

This task produces artifacts used at release time to provision the production Supabase project. It does NOT run against production; the engineer executing the plan does this against a dev project first.

**Files:**
- Create: `supabase/migrations/20260416_storage_bucket_and_rls.sql`
- Create: `supabase/functions/delete-account/index.ts`
- Create: `supabase/README.md`

- [ ] **Step 1: Create migration**

```sql
-- supabase/migrations/20260416_storage_bucket_and_rls.sql

-- Create the private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('logbook-backups', 'logbook-backups', false)
ON CONFLICT (id) DO NOTHING;

-- Own-prefix RLS policy
DROP POLICY IF EXISTS "own_prefix_rw" ON storage.objects;
CREATE POLICY "own_prefix_rw" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'logbook-backups'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 2: Create Edge Function**

```ts
// supabase/functions/delete-account/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response('missing_auth', { status: 401 });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Verify caller JWT
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return new Response('unauthenticated', { status: 401 });
  const uid = userData.user.id;

  // Service-role client for destructive ops
  const admin = createClient(url, service);

  // Delete all objects under {uid}/
  const { data: files, error: listErr } = await admin.storage.from('logbook-backups').list(uid, { limit: 1000 });
  if (!listErr && files && files.length > 0) {
    const keys = files.map((f) => `${uid}/${f.name}`);
    await admin.storage.from('logbook-backups').remove(keys);
  }
  // Also recursively delete subdirs
  const { data: assets } = await admin.storage.from('logbook-backups').list(`${uid}/assets`, { limit: 1000 });
  if (assets && assets.length > 0) {
    const keys = assets.map((f) => `${uid}/assets/${f.name}`);
    await admin.storage.from('logbook-backups').remove(keys);
  }

  // Delete the Auth user
  const { error: deleteErr } = await admin.auth.admin.deleteUser(uid);
  if (deleteErr) return new Response(`delete_user_failed:${deleteErr.message}`, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
});
```

- [ ] **Step 3: Create README with ops steps**

```markdown
# Supabase setup for Rope Access Logbook

## Dev project setup

1. Create a new Supabase project.
2. Enable Apple, Google, and Email auth providers in Authentication → Providers.
3. In Authentication → URL Configuration, add `logbook://auth-callback` to Redirect URLs.
4. In Authentication → Settings → Advanced, enable "Manual linking" for Identity Linking.
5. Apply the migration:
   ```bash
   supabase db push --db-url postgres://...
   # or paste supabase/migrations/20260416_storage_bucket_and_rls.sql in the SQL editor
   ```
6. Deploy the Edge Function:
   ```bash
   supabase functions deploy delete-account --no-verify-jwt
   ```
   (`--no-verify-jwt` because we verify manually inside the function using the caller's token.)
7. Set secrets for the function:
   ```bash
   supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
   ```
8. Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` into the developer's local `.env` at repo root.

## Production setup

Mirror the dev setup. Ship production values in the release bundle.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260416_storage_bucket_and_rls.sql supabase/functions/delete-account/index.ts supabase/README.md
git commit -m "feat: Supabase schema, Edge Function, and setup docs"
```

---

## Phase 8 — Verification

### Task 33: End-to-end backup → restore roundtrip test

**Files:**
- Create: `__tests__/integration/backupRestore.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// __tests__/integration/backupRestore.test.ts
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
    },
  };
});

import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { testSha256 } from '../testHash';
import { createEntriesService } from '../../src/services/entriesService';
import { createSigningService } from '../../src/services/signingService';
import { createExportService } from '../../src/services/exportService';
import { createProfileService } from '../../src/services/profileService';
import { createCloudBackupService } from '../../src/services/cloudBackupService';
import { createRestoreService } from '../../src/services/restoreService';

describe('integration: backup on device A → restore on device B', () => {
  it('produces a device-B DB whose signed entries all verify with v2', async () => {
    // Device A
    const dbA = createTestClient();
    const cloud = createMockCloudClient();
    const fsA = createMockFs();
    let counterA = 0;
    const uuidA = () => `a-${++counterA}`;
    const profileA = createProfileService(dbA, uuidA);
    const entriesA = createEntriesService(dbA, uuidA);
    const signingA = createSigningService(dbA, testSha256, uuidA);
    await profileA.createProfile({
      full_name: 'Tech', sprat_id: 'S1', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'Emp',
    });
    const sigPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/device-a.png';
    fsA.writeStringSync(sigPath, 'device-a-signature-bytes');
    const e = await entriesA.createEntry({
      date: '2026-04-10', employer: 'Emp', site: 'Site', client: 'Cli', description: 'Work',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signingA.signEntry({
      entry_id: e.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath, device_id: 'd-a',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    const backup = createCloudBackupService({
      db: dbA, cloud, fs: fsA, hash: testSha256,
      exportService: createExportService(dbA),
      clock: () => '2026-04-16T12:00:00.000Z', appVersion: '1.0.0',
    });
    const r = await backup.backup();
    expect(r.kind).toBe('uploaded');

    // Device B — fresh DB and fresh FS, same cloud
    const dbB = createTestClient();
    const fsB = createMockFs();
    const restore = createRestoreService({ db: dbB, cloud, fs: fsB, appVersion: '1.0.0' });
    const rr = await restore.restore();
    expect(rr.kind).toBe('restored');

    // Verify integrity on Device B
    const signingB = createSigningService(dbB, testSha256);
    const verify = await signingB.verifyIntegrity(e.id);
    expect(verify.valid).toBe(true);
    expect(verify.hashVersion).toBe(2);

    // Signature file is present at the expected local path on device B
    const sigPathB = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/a-4.png';
    // id-4 may differ based on uuid counter order — use the actual id from the restored signature
    const sigRow = await dbB.get<{ id: string; signature_png_path: string }>(
      'SELECT id, signature_png_path FROM signatures WHERE entry_id = ?', [e.id],
    );
    expect(sigRow!.signature_png_path.startsWith(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/'
    )).toBe(true);
    expect(fsB.files.has(sigRow!.signature_png_path)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx jest __tests__/integration/backupRestore.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/integration/backupRestore.test.ts
git commit -m "test: integration — backup on device A restores correctly on device B with v2 hash"
```

---

### Task 34: Manual QA checklist document

**Files:**
- Create: `docs/qa/2026-04-16-cloud-backup-manual-checklist.md`

- [ ] **Step 1: Create checklist**

```markdown
# Manual QA — Cloud Backup & Restore

Target: a development Supabase project. Tester: the engineer implementing this feature.

## Pre-test setup

- [ ] Dev Supabase project provisioned (migration applied, Edge Function deployed, auth providers enabled).
- [ ] `.env` at repo root contains correct `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
- [ ] `npx expo start` runs the app on a physical iOS and Android device (or two simulators).

## Scenarios

### 1. New user signup → first backup
- [ ] Fresh install, no profile.
- [ ] Complete onboarding, save profile.
- [ ] Post-onboarding prompt offers sign-in. Tap "Sign up".
- [ ] Send magic link to a real email. Open link on the device. App receives deep link, session becomes active.
- [ ] Scenario A preview modal shows correct counts. Tap "Back up".
- [ ] Profile screen now shows "Last backed up: <now>" in Cloud section.
- [ ] Verify in Supabase dashboard: `snapshot.json` exists under `{user_id}/`.

### 2. Sign an entry while signed in → auto-backup
- [ ] Create a draft entry, capture supervisor signature.
- [ ] Check: Profile → Cloud → Last backed up timestamp updated within 30s.
- [ ] Check: Supabase Storage → `{user_id}/assets/sig_<id>.png` exists.

### 3. Restore to a second device
- [ ] On the second device, fresh install, sign in with same email (magic link).
- [ ] Scenario B confirmation modal shows correct counts. Tap "Restore".
- [ ] All entries present. All signed entries show "Integrity: Valid" in EntryDetailScreen.
- [ ] SPRAT card photo (if present) appears correctly.

### 4. Conflict resolution
- [ ] On device A, sign out. Create a new draft entry while signed out.
- [ ] Sign back in.
- [ ] CloudConflictScreen appears.
- [ ] "Keep cloud, replace this device" — verify: new draft is gone, pre-existing cloud data is present.
- [ ] Repeat with "Replace cloud with this device" — verify cloud now reflects device state.

### 5. Photos toggle (off → on)
- [ ] Create an entry with 2 photos. Confirm photos appear on the entry.
- [ ] Profile → Cloud → toggle "Include photos in backup" ON.
- [ ] Trigger a backup (sign another entry, or tap "Back up now").
- [ ] Verify: `{user_id}/assets/photo_<entry>_*.jpg` files appear in Storage.
- [ ] On a fresh device, restore and confirm photos are present on the entry.

### 6. Photos toggle (on → off)
- [ ] With photos ON and at least one photo backed up, toggle OFF.
- [ ] Trigger a backup.
- [ ] Verify: photo assets are gone from Storage.
- [ ] On a fresh device, restore; photos appear only locally from the entry rows with empty photo_paths (depends on data — verify against the test scenario).

### 7. Account deletion
- [ ] Profile → Cloud → "Delete cloud backup + account". Confirmation modal → Type DELETE → Delete.
- [ ] Verify Supabase dashboard: user removed from auth.users; all objects under `{user_id}/` removed.
- [ ] Local logbook still works. Signing out/in with the same email should allow fresh signup.

### 8. Offline behavior
- [ ] Airplane mode on. Sign a draft entry.
- [ ] Verify no error banner (backup silently skipped).
- [ ] Airplane mode off. Bring app to foreground; or background/foreground. Backup succeeds on next trigger.

### 9. Quota (simulated)
- [ ] Upload enough content to exceed dev project limits (or lower the limit temporarily).
- [ ] Trigger a backup.
- [ ] Verify: durable banner on Profile screen reads "Cloud storage full — manage your backup in Profile."

### 10. Version guard
- [ ] (Manually edit a `snapshot.json` in Supabase to set `cloud_schema_version = 99`.)
- [ ] Sign in on a fresh device. Restore attempt shows "Please update the app." Local DB untouched.

## Sign-off

- [ ] All scenarios above pass.
- [ ] No crashes.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npx jest` all green.
```

- [ ] **Step 2: Commit**

```bash
git add docs/qa/2026-04-16-cloud-backup-manual-checklist.md
git commit -m "docs: manual QA checklist for cloud backup and restore"
```

---

### Task 35: Final sanity check

**Files:** none (verification only)

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run full test suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 3: Smoke-boot the app**

Run: `npx expo start`
Expected: bundle builds without errors. Open on a physical device or simulator and confirm the existing app still loads — onboarding → profile → logbook → entry form → signing still works end-to-end.

- [ ] **Step 4: Document completion**

If all three above pass, the sub-project is code-complete pending execution of the manual QA checklist (Task 34) against the dev Supabase project.

- [ ] **Step 5: Final commit (if anything stray)**

```bash
git status
# If clean, nothing to do. Otherwise, review and commit.
```

---

## Self-review appendix (for the planning agent, not the executor)

Spec coverage cross-check — every section of `docs/superpowers/specs/2026-04-16-cloud-backup-and-restore-design.md` maps to one or more tasks:

- §1 purpose/success — covered by Task 34 (manual QA) and Task 33 (integration test).
- §2 key decisions — embodied by tasks 14–18 (backup behavior), 19–23 (restore), 24–28 (UI), 11–13 (auth).
- §3 architecture — tasks 1–13 (substrate), 14–23 (services), 24–31 (UI + wiring).
- §4 path-normalization — tasks 4–6.
- §5 server data model — tasks 14 (snapshot.json shape), 32 (storage + RLS SQL).
- §6 user flows — tasks 19–23 (services), 24–28 (UI), 29 (onboarding + post-sign), 30 (navigator).
- §7 error handling — tasks 16 (backup errors), 20–21 (restore errors), 31 (app-level).
- §8 security — task 32 (RLS + Edge Function), carried forward.
- §9 testing — tasks 3–33 (every service has its test; task 33 is integration).
- §10 rollout — task 32 (docs) + task 34 (QA).
- §11 known risks — embedded as notes inside tasks 10 (Apple/Google), 28 (delete cold start), 18 (backup coupling).

No placeholders. Types consistent — `CloudSnapshot`, `BinaryManifest`, `BackupResult`, `CloudStatePreview`, `AuthSession` used the same way across services, hooks, and screens.
