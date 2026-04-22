# Supervisor-side Photo Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the visible gap where the supervisor can't see photos the tech attached to a sign request — download them from the `sign-requests` bucket on sync, verify sha256 against the manifest, cache locally per request, and clean up on terminal sign-request transitions.

**Architecture:** One new nullable column on `sign_requests_cache` to persist local photo paths per request. Two new file-storage helpers that route through the `FileSystemAbstraction` (so tests can verify writes via `getSha256`). Two new service methods on `signRequestsService` (`downloadRequestPhotos`, `cleanupRequestPhotos`) plus one pure selector (`getLocalPhotoPathsFromCache`). `sync()` grows a top-up pass for pre-existing rows and two new branches in the main loop. `SignRequestDetailScreen` reads the persisted paths and swaps broken `<Image>` tiles for placeholders + a warning banner when downloads failed.

**Tech Stack:** Expo SQLite via `DbClient`, `@supabase/supabase-js` storage (via `CloudClient`), `expo-file-system/legacy` (via `FileSystemAbstraction`), React Native.

**Spec:** `docs/superpowers/specs/2026-04-19-supervisor-photo-download-design.md`

---

### Task 1: Schema + migration for `local_photo_paths_json`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrations.ts`
- Modify: `__tests__/db/migrationsSupervisor.test.ts`

- [ ] **Step 1: Write the failing migration test**

Open `__tests__/db/migrationsSupervisor.test.ts` and add a new test at the end of the `describe` block:

```ts
test('adds local_photo_paths_json to sign_requests_cache on legacy DB', async () => {
  const db = createLegacyTestClient();
  await runSchemaMigrations(db);
  const cols = await db.getAll<{ name: string }>(
    "PRAGMA table_info(sign_requests_cache)"
  );
  expect(cols.map(c => c.name)).toContain('local_photo_paths_json');
});

test('canonical schema has local_photo_paths_json on sign_requests_cache', async () => {
  const db = await createTestClient();
  const cols = await db.getAll<{ name: string }>(
    "PRAGMA table_info(sign_requests_cache)"
  );
  expect(cols.map(c => c.name)).toContain('local_photo_paths_json');
});
```

- [ ] **Step 2: Run test to verify both fail**

Run: `npx jest __tests__/db/migrationsSupervisor.test.ts -t 'local_photo_paths_json'`

Expected: both new tests FAIL (`Expected array containing: "local_photo_paths_json"`).

- [ ] **Step 3: Add column to canonical schema**

In `src/db/schema.ts`, change the `sign_requests_cache` CREATE TABLE block (around line 78) to add the column as the last field:

```sql
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
  payload_json TEXT NOT NULL,
  local_photo_paths_json TEXT
);
```

- [ ] **Step 4: Add idempotent ALTER to the migration runner**

In `src/db/migrations.ts`, append to the end of `runSchemaMigrations` (after the `CREATE INDEX` lines, before the closing brace):

```ts
if (!(await hasColumn(db, 'sign_requests_cache', 'local_photo_paths_json'))) {
  await db.exec('ALTER TABLE sign_requests_cache ADD COLUMN local_photo_paths_json TEXT');
}
```

- [ ] **Step 5: Re-run the migration tests**

Run: `npx jest __tests__/db/migrationsSupervisor.test.ts`

Expected: all tests (existing + new two) PASS.

- [ ] **Step 6: Run the full suite to confirm no regressions**

Run: `npx jest`

Expected: all 134 tests PASS (132 existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts __tests__/db/migrationsSupervisor.test.ts
git commit -m "feat(db): add local_photo_paths_json to sign_requests_cache"
```

---

### Task 2: File storage helpers

**Files:**
- Modify: `src/utils/fileStorage.ts`

This task has no direct tests — the helpers are exercised transitively by `downloadRequestPhotos` / `cleanupRequestPhotos` tests in tasks 3 and 4. Keeping them as a separate commit keeps the diff reviewable.

- [ ] **Step 1: Add imports and constant**

In `src/utils/fileStorage.ts`, after the existing imports and before `LOGBOOK_DIR`:

```ts
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
```

After the existing directory constants, add:

```ts
const SIGNREQUEST_PHOTOS_DIR = `${LOGBOOK_DIR}signrequest_photos/`;

export function signRequestPhotoPath(requestId: string, basename: string): string {
  return `${SIGNREQUEST_PHOTOS_DIR}${requestId}/${basename}`;
}
```

Exporting `signRequestPhotoPath` gives the service a single source of truth for the target path — used both for the idempotency pre-check (does the file already exist with the right sha256?) and for the write itself.

- [ ] **Step 2: Add `saveSignRequestPhoto`**

Append at the end of the file:

```ts
export async function saveSignRequestPhoto(
  fs: FileSystemAbstraction,
  requestId: string,
  basename: string,
  bytes: Uint8Array,
): Promise<string> {
  const dir = `${SIGNREQUEST_PHOTOS_DIR}${requestId}/`;
  await fs.ensureDir(dir);
  const destPath = `${dir}${basename}`;
  await fs.writeBytes(destPath, bytes);
  return destPath;
}
```

- [ ] **Step 3: Add `deleteSignRequestPhotosDir`**

Append:

```ts
export async function deleteSignRequestPhotosDir(
  fs: FileSystemAbstraction,
  requestId: string,
  knownPaths: string[] = [],
): Promise<void> {
  for (const p of knownPaths) {
    if (p) {
      try { await fs.deletePath(p); } catch {}
    }
  }
  const dir = `${SIGNREQUEST_PHOTOS_DIR}${requestId}/`;
  try { await fs.deletePath(dir); } catch {}
}
```

Rationale for `knownPaths`: `fs.deletePath(dir)` on the in-memory mock only removes the dir key (never registered because we use the flat Map). Iterating known file paths ensures the mock's state reflects deletion, matching what `expo-file-system.deleteAsync({recursive:true})` does on device.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/fileStorage.ts
git commit -m "feat(storage): saveSignRequestPhoto + deleteSignRequestPhotosDir helpers"
```

---

### Task 3: `downloadRequestPhotos` service method

**Files:**
- Modify: `src/services/signRequestsService.ts`
- Modify: `__tests__/services/signRequestsService.test.ts`

- [ ] **Step 1: Write the failing happy-path test**

Append to `__tests__/services/signRequestsService.test.ts`:

```ts
// ===== Task: downloadRequestPhotos =====

function makeSupervisorService(techCloud: ReturnType<typeof createMockCloudClient>, db: DbClient, fs: ReturnType<typeof createMockFs>) {
  const supCloud = createMockCloudClient({ initialSession: supSession });
  // Share the mock state across tech & supervisor cloud instances.
  // The mock exposes these Maps for cross-user tests.
  (supCloud as any).requests = (techCloud as any).requests;
  (supCloud as any).storage = (techCloud as any).storage;
  let uuidCounter = 1000;
  const testUuid = () => `sup-uuid-${++uuidCounter}`;
  return createSignRequestsService(db, supCloud, fs, testSha256, undefined, testUuid);
}

async function seedEntryWithPhotos(db: DbClient, fs: ReturnType<typeof createMockFs>, photoCount: number) {
  const paths: string[] = [];
  for (let i = 0; i < photoCount; i++) {
    const p = `file:///tmp/test/logbook/photos/e1_${i}.jpg`;
    const bytes = new Uint8Array([1, 2, 3, i]);
    fs.files.set(p, bytes);
    paths.push(p);
  }
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES ('e1','2026-03-01','2026-03-01','2026-03-01','Acme','Site','Client','Desc',8,'II','["inspection"]',?,'draft','2026-03-01','2026-03-01')`,
    [JSON.stringify(paths)],
  );
}

test('downloadRequestPhotos writes all photos locally and persists paths', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 3);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(req);

  expect(result.failed).toEqual([]);
  expect(result.localPaths).toHaveLength(3);
  for (const p of result.localPaths) {
    expect(p).toMatch(new RegExp(`/logbook/signrequest_photos/${req.id}/photo_e1_\\d+\\.jpg$`));
    expect(fs.files.has(p)).toBe(true);
  }

  const cached = await db.get<{ local_photo_paths_json: string }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(JSON.parse(cached!.local_photo_paths_json)).toEqual(result.localPaths);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest signRequestsService.test.ts -t 'downloadRequestPhotos writes'`

Expected: FAIL — `supService.downloadRequestPhotos is not a function`.

- [ ] **Step 3: Implement `downloadRequestPhotos`**

In `src/services/signRequestsService.ts`:

Update the `fileStorage` import at the top of the file — it currently imports only `saveSignaturePng`:

```ts
import {
  saveSignaturePng,
  saveSignRequestPhoto,
  deleteSignRequestPhotosDir,
  signRequestPhotoPath,
} from '../utils/fileStorage';
```

Inside `createSignRequestsService`, after `applyIncomingSignature` and before `sync`, add:

```ts
const PHOTO_BASENAME_RE = /^photo_[^_]+_(\d+)\.[^.]+$/;

function parsePhotoIndex(basename: string): number | null {
  const m = basename.match(PHOTO_BASENAME_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) ? n : null;
}

async function downloadRequestPhotos(row: SignRequest): Promise<{ localPaths: string[]; failed: number[] }> {
  const entry = row.entry_payload as Entry;
  const count = entry.photo_paths.length;
  const localPaths: string[] = new Array(count).fill('');
  const failed: number[] = [];

  const manifest = row.assets_manifest as Record<string, { sha256: string; size_bytes: number }>;
  for (const [key, meta] of Object.entries(manifest ?? {})) {
    const basename = key.split('/').pop() ?? '';
    const idx = parsePhotoIndex(basename);
    if (idx === null || idx < 0 || idx >= count) continue;

    try {
      const bucketKey = key.replace(/^sign-requests\//, '');
      const targetPath = signRequestPhotoPath(row.id, basename);

      if (await fs.exists(targetPath)) {
        const existingSha = await fs.getSha256(targetPath);
        if (existingSha === meta.sha256) {
          localPaths[idx] = targetPath;
          continue;
        }
        try { await fs.deletePath(targetPath); } catch {}
      }

      const bytes = await cloud.downloadSignRequestAsset(bucketKey);
      const writtenPath = await saveSignRequestPhoto(fs, row.id, basename, bytes);
      const writtenSha = await fs.getSha256(writtenPath);
      if (writtenSha !== meta.sha256) {
        try { await fs.deletePath(writtenPath); } catch {}
        failed.push(idx);
        continue;
      }
      localPaths[idx] = writtenPath;
    } catch {
      failed.push(idx);
    }
  }

  try {
    await db.run(
      'UPDATE sign_requests_cache SET local_photo_paths_json = ? WHERE id = ?',
      [JSON.stringify(localPaths), row.id],
    );
  } catch {}

  return { localPaths, failed };
}
```

Then export `downloadRequestPhotos` from the return block at the bottom of `createSignRequestsService`:

```ts
return {
  sync,
  listCached: async (): Promise<SignRequest[]> => { /* existing */ },
  sendRequest,
  withdraw,
  decline,
  sign,
  applyIncomingSignature,
  downloadRequestPhotos,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest signRequestsService.test.ts -t 'downloadRequestPhotos writes'`

Expected: PASS.

- [ ] **Step 5: Add idempotency test**

Append to the test file:

```ts
test('downloadRequestPhotos is idempotent — second call is a no-op', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);

  const first = await supService.downloadRequestPhotos(req);
  expect(first.failed).toEqual([]);

  // Tamper with the mock's storage: if download runs again we'd catch it.
  const storageSize = (techCloud as any).storage.size;
  const second = await supService.downloadRequestPhotos(req);
  expect(second.failed).toEqual([]);
  expect(second.localPaths).toEqual(first.localPaths);
  expect((techCloud as any).storage.size).toBe(storageSize);
});
```

Run: `npx jest signRequestsService.test.ts -t 'idempotent'`

Expected: PASS (the existing-file-with-matching-sha check short-circuits).

- [ ] **Step 6: Add sha256 mismatch test**

Append:

```ts
test('downloadRequestPhotos quarantines photos with sha256 mismatch', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // Corrupt the manifest sha256 for index 1 so the downloaded bytes don't match.
  const corrupt = { ...req, assets_manifest: { ...req.assets_manifest } } as SignRequest;
  const keys = Object.keys(corrupt.assets_manifest);
  const badKey = keys.find(k => k.endsWith('_1.jpg'))!;
  (corrupt.assets_manifest as any)[badKey] = {
    ...(corrupt.assets_manifest as any)[badKey],
    sha256: 'deadbeef'.repeat(8),
  };

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(corrupt);

  expect(result.failed).toEqual([1]);
  expect(result.localPaths[0]).not.toBe('');
  expect(result.localPaths[1]).toBe('');

  // Quarantined file must not linger on disk.
  for (const [path, _] of fs.files.entries()) {
    if (path.includes(`/signrequest_photos/${req.id}/`) && path.endsWith('_1.jpg')) {
      throw new Error(`Expected quarantined file to be deleted: ${path}`);
    }
  }
});
```

Run: `npx jest signRequestsService.test.ts -t 'sha256 mismatch'`

Expected: PASS.

- [ ] **Step 7: Add download-throw test**

Append:

```ts
test('downloadRequestPhotos handles download failure per-index without rethrowing', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // Delete one key from the mock storage to force a download failure.
  const storage = (techCloud as any).storage as Map<string, Uint8Array>;
  const doomed = [...storage.keys()].find(k => k.endsWith('_0.jpg'))!;
  storage.delete(doomed);

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(req);

  expect(result.failed).toEqual([0]);
  expect(result.localPaths[0]).toBe('');
  expect(result.localPaths[1]).not.toBe('');
});
```

Run: `npx jest signRequestsService.test.ts -t 'download failure per-index'`

Expected: PASS.

- [ ] **Step 8: Add index-alignment test (manifest missing an index)**

Append:

```ts
test('downloadRequestPhotos aligns output to entry.photo_paths length even when manifest has gaps', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 3);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // Drop the middle manifest entry to simulate a gap.
  const trimmed = { ...req, assets_manifest: { ...req.assets_manifest } } as SignRequest;
  const midKey = Object.keys(trimmed.assets_manifest).find(k => k.endsWith('_1.jpg'))!;
  delete (trimmed.assets_manifest as any)[midKey];

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(trimmed);

  expect(result.localPaths).toHaveLength(3);
  expect(result.localPaths[0]).not.toBe('');
  expect(result.localPaths[1]).toBe('');
  expect(result.localPaths[2]).not.toBe('');
});
```

Run: `npx jest signRequestsService.test.ts -t 'aligns output'`

Expected: PASS.

- [ ] **Step 9: Run the full signRequestsService test file and the full suite**

```bash
npx jest signRequestsService.test.ts
npx jest
```

Expected: all PASS (4 new tests added).

- [ ] **Step 10: Commit**

```bash
git add src/services/signRequestsService.ts __tests__/services/signRequestsService.test.ts
git commit -m "feat(signrequest): downloadRequestPhotos with sha256 verify + quarantine"
```

---

### Task 4: `cleanupRequestPhotos` service method

**Files:**
- Modify: `src/services/signRequestsService.ts`
- Modify: `__tests__/services/signRequestsService.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
test('cleanupRequestPhotos deletes cached files and nulls the column', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);
  const dl = await supService.downloadRequestPhotos(req);

  // Pre-condition: files exist, column is set.
  for (const p of dl.localPaths) expect(fs.files.has(p)).toBe(true);
  const pre = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(pre?.local_photo_paths_json).not.toBeNull();

  await supService.cleanupRequestPhotos(req);

  // Post-condition: files gone, column is null.
  for (const p of dl.localPaths) expect(fs.files.has(p)).toBe(false);
  const post = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(post?.local_photo_paths_json).toBeNull();
});

test('cleanupRequestPhotos is a no-op when nothing was downloaded', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 1);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);

  // Should not throw, even though no cache row for supervisor yet / no files.
  await expect(supService.cleanupRequestPhotos(req)).resolves.toBeUndefined();
});
```

Run: `npx jest signRequestsService.test.ts -t 'cleanupRequestPhotos'`

Expected: FAIL — `supService.cleanupRequestPhotos is not a function`.

- [ ] **Step 2: Implement `cleanupRequestPhotos`**

In `src/services/signRequestsService.ts`, after `downloadRequestPhotos`:

```ts
async function cleanupRequestPhotos(row: SignRequest): Promise<void> {
  try {
    await deleteSignRequestPhotosDir(fs, row.id);
    await db.run(
      'UPDATE sign_requests_cache SET local_photo_paths_json = NULL WHERE id = ?',
      [row.id],
    );
  } catch {}
}
```

`deleteSignRequestPhotosDir` recursively deletes the request's photo directory via `fs.deletePath(dir)`. The in-memory test mock honors trailing-slash paths as recursive prefix-deletes, matching the on-device `expo-file-system.deleteAsync({recursive:true})` semantics.

Export it from the service:

```ts
return {
  sync,
  listCached: /* existing */,
  sendRequest,
  withdraw,
  decline,
  sign,
  applyIncomingSignature,
  downloadRequestPhotos,
  cleanupRequestPhotos,
};
```

- [ ] **Step 3: Run tests**

```bash
npx jest signRequestsService.test.ts -t 'cleanupRequestPhotos'
npx jest
```

Expected: both new tests PASS; full suite still green.

- [ ] **Step 4: Commit**

```bash
git add src/services/signRequestsService.ts __tests__/services/signRequestsService.test.ts
git commit -m "feat(signrequest): cleanupRequestPhotos removes local cache on terminal state"
```

---

### Task 5: `getLocalPhotoPathsFromCache` selector

**Files:**
- Modify: `src/services/signRequestsService.ts`
- Modify: `__tests__/services/signRequestsService.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
import { getLocalPhotoPathsFromCache } from '../../src/services/signRequestsService';

describe('getLocalPhotoPathsFromCache', () => {
  test('returns pending when column is null', () => {
    const result = getLocalPhotoPathsFromCache({ local_photo_paths_json: null });
    expect(result).toEqual({ paths: [], missingCount: 0, pending: true });
  });

  test('parses paths and counts empty slots', () => {
    const json = JSON.stringify([
      '/abs/a.jpg',
      '',
      '/abs/c.jpg',
    ]);
    const result = getLocalPhotoPathsFromCache({ local_photo_paths_json: json });
    expect(result).toEqual({
      paths: ['/abs/a.jpg', '', '/abs/c.jpg'],
      missingCount: 1,
      pending: false,
    });
  });

  test('handles empty array', () => {
    const result = getLocalPhotoPathsFromCache({ local_photo_paths_json: '[]' });
    expect(result).toEqual({ paths: [], missingCount: 0, pending: false });
  });
});
```

Run: `npx jest signRequestsService.test.ts -t 'getLocalPhotoPathsFromCache'`

Expected: FAIL — import doesn't resolve.

- [ ] **Step 2: Implement the selector**

In `src/services/signRequestsService.ts`, at the top level (outside `createSignRequestsService`), export:

```ts
export function getLocalPhotoPathsFromCache(row: { local_photo_paths_json: string | null }): {
  paths: string[];
  missingCount: number;
  pending: boolean;
} {
  if (row.local_photo_paths_json == null) {
    return { paths: [], missingCount: 0, pending: true };
  }
  const paths = JSON.parse(row.local_photo_paths_json) as string[];
  const missingCount = paths.filter(p => p === '').length;
  return { paths, missingCount, pending: false };
}
```

- [ ] **Step 3: Run tests**

```bash
npx jest signRequestsService.test.ts -t 'getLocalPhotoPathsFromCache'
npx jest
```

Expected: all three new tests PASS; full suite still green.

- [ ] **Step 4: Commit**

```bash
git add src/services/signRequestsService.ts __tests__/services/signRequestsService.test.ts
git commit -m "feat(signrequest): getLocalPhotoPathsFromCache UI selector"
```

---

### Task 6: Extend `sync()` with photo download, cleanup, and top-up pass

**Files:**
- Modify: `src/services/signRequestsService.ts`
- Modify: `__tests__/services/signRequestsService.test.ts`

- [ ] **Step 1: Write test — supervisor-side new pending row triggers download**

Append:

```ts
test('sync downloads photos for new supervisor-side pending rows', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  const supService = makeSupervisorService(techCloud, db, fs);
  // The supervisor's local cache starts empty.
  await db.run('DELETE FROM sign_requests_cache');

  await supService.sync();

  const cached = await db.get<{ local_photo_paths_json: string }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  const paths = JSON.parse(cached!.local_photo_paths_json) as string[];
  expect(paths).toHaveLength(2);
  for (const p of paths) expect(fs.files.has(p)).toBe(true);
});
```

Run the test. Expected: FAIL (the column is still null after sync).

- [ ] **Step 2: Write test — supervisor-side terminal transition triggers cleanup**

Append:

```ts
test('sync calls cleanupRequestPhotos when a supervisor-side row hits a terminal state', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 1);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);
  await supService.sync(); // downloads photos

  const before = await db.get<{ local_photo_paths_json: string }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  const beforePaths = JSON.parse(before!.local_photo_paths_json) as string[];
  expect(beforePaths.every(p => fs.files.has(p))).toBe(true);

  // Tech withdraws the request.
  await techService.withdraw(req.id);

  await supService.sync();

  const after = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(after?.local_photo_paths_json).toBeNull();
  for (const p of beforePaths) expect(fs.files.has(p)).toBe(false);
});
```

Run. Expected: FAIL.

- [ ] **Step 3: Write test — top-up pass downloads for pre-existing null-column rows**

Append:

```ts
test('sync top-up pass downloads photos for pre-existing supervisor pending rows with null column', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  const supService = makeSupervisorService(techCloud, db, fs);
  await supService.sync(); // populates cache + downloads

  // Simulate a pre-existing row whose photos were never downloaded
  // (e.g., cached before this feature shipped).
  await db.run(
    'UPDATE sign_requests_cache SET local_photo_paths_json = NULL WHERE id = ?', [req.id]);
  // Also remove the on-disk files, since we're simulating they never existed.
  const paths = [...fs.files.keys()].filter(k => k.includes(`/signrequest_photos/${req.id}/`));
  for (const p of paths) fs.files.delete(p);

  await supService.sync();

  const cached = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(cached?.local_photo_paths_json).not.toBeNull();
});
```

Run. Expected: FAIL.

- [ ] **Step 4: Write test — tech-side rows do NOT trigger download**

Append:

```ts
test('sync does not download photos for tech-side pending rows', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // The tech is syncing their own outgoing request. They should NOT get
  // a supervisor-side cache of the photos (they already have the originals).
  await techService.sync();

  const cached = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(cached?.local_photo_paths_json).toBeNull();
});
```

Run. Expected: may PASS already (pre-implementation) since sync doesn't touch the column yet. Keep the test — it becomes a regression guard once we add the download branch.

- [ ] **Step 5: Implement the sync extensions**

In `src/services/signRequestsService.ts`, replace the existing `sync` function with:

```ts
async function topUpPendingPhotos(): Promise<void> {
  const uid = cloud.getCurrentUserId();
  if (!uid) return;
  const rows = await db.getAll<{ payload_json: string }>(
    `SELECT payload_json FROM sign_requests_cache
      WHERE status = 'pending'
        AND supervisor_user_id = ?
        AND local_photo_paths_json IS NULL`,
    [uid],
  );
  for (const r of rows) {
    try { await downloadRequestPhotos(JSON.parse(r.payload_json) as SignRequest); } catch {}
  }
}

async function sync(): Promise<void> {
  await topUpPendingPhotos();

  const since = await getMaxUpdatedAt();
  const rows = await cloud.listSignRequests(since);
  const currentUid = cloud.getCurrentUserId();
  for (const r of rows) {
    await cacheRow(r);

    if (currentUid && r.supervisor_user_id === currentUid && r.status === 'pending') {
      try { await downloadRequestPhotos(r); } catch {}
    }

    if (currentUid && r.tech_user_id === currentUid && r.status === 'signed') {
      await applyIncomingSignature(r);
    }

    if (
      currentUid && r.supervisor_user_id === currentUid &&
      (r.status === 'signed' || r.status === 'declined' ||
       r.status === 'withdrawn' || r.status === 'expired')
    ) {
      try { await cleanupRequestPhotos(r); } catch {}
    }

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

- [ ] **Step 6: Run the new sync tests**

```bash
npx jest signRequestsService.test.ts -t 'sync'
```

Expected: all four new `sync` tests PASS.

- [ ] **Step 7: Run the full suite**

Run: `npx jest`

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/signRequestsService.ts __tests__/services/signRequestsService.test.ts
git commit -m "feat(signrequest): sync downloads + cleans up supervisor photo cache"
```

---

### Task 7: Extend end-to-end flow test

**Files:**
- Modify: `__tests__/services/fullRemoteSignFlow.test.ts`

- [ ] **Step 1: Read the existing E2E test to understand structure**

Run: `cat __tests__/services/fullRemoteSignFlow.test.ts`

Find the test that exercises the full tech-sends → supervisor-signs → tech-receives flow. Locate the point where the supervisor has synced and the request is pending on their side.

- [ ] **Step 2: Add photo assertions after supervisor sync**

In the existing round-trip test, after the supervisor's `sync()` call (when the request is pending for them), add:

```ts
// Supervisor now has photos locally.
const pendingCached = await db.get<{ local_photo_paths_json: string | null }>(
  'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [requestId]);
expect(pendingCached?.local_photo_paths_json).not.toBeNull();
const localPaths = JSON.parse(pendingCached!.local_photo_paths_json!) as string[];
expect(localPaths).toHaveLength(originalPhotoCount);
for (const p of localPaths) {
  expect(p).not.toBe('');
  expect(fs.files.has(p)).toBe(true);
}
```

Replace `requestId` and `originalPhotoCount` with whatever the existing test already tracks; seed 2 photos on the entry if it doesn't already.

- [ ] **Step 3: Add cleanup assertions after supervisor signs and re-syncs**

After the supervisor signs and runs another `sync()`:

```ts
const afterSigned = await db.get<{ local_photo_paths_json: string | null }>(
  'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [requestId]);
expect(afterSigned?.local_photo_paths_json).toBeNull();
// On-disk files are gone.
for (const p of localPaths) {
  expect(fs.files.has(p)).toBe(false);
}
```

- [ ] **Step 4: Run the E2E test**

```bash
npx jest fullRemoteSignFlow.test.ts
```

Expected: PASS. If the original test didn't seed photos, add two before `sendRequest` using the same `seedEntryWithPhotos`-style pattern.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add __tests__/services/fullRemoteSignFlow.test.ts
git commit -m "test(e2e): assert supervisor photo round-trip + cleanup"
```

---

### Task 8: UI — replace broken photo grid in `SignRequestDetailScreen`

**Files:**
- Modify: `src/screens/SignRequestDetailScreen.tsx`

No unit tests — React Native screen rendering is not covered by the test harness in this repo. Verify manually in the simulator after changes.

- [ ] **Step 1: Import the selector and add a small placeholder component inline**

In `src/screens/SignRequestDetailScreen.tsx`, add to the imports near the top:

```tsx
import { getLocalPhotoPathsFromCache } from '../services/signRequestsService';
```

- [ ] **Step 2: Derive local photo paths from the cached row**

The screen currently finds the request via:

```tsx
const req = (signReqs.query.data ?? []).find((r) => r.id === route.params.requestId);
```

Immediately after this line, add a query for the cached DB row's `local_photo_paths_json` column. Simplest approach: store the column directly on each listed `SignRequest` when `listCached` projects it. But `listCached` returns parsed `SignRequest` objects (which don't carry cache-local columns). Read from the cache table separately via a `useEffect` + state:

Add state:

```tsx
const [photoView, setPhotoView] = useState<{ paths: string[]; missingCount: number; pending: boolean }>(
  { paths: [], missingCount: 0, pending: true },
);

useEffect(() => {
  if (!req) return;
  let cancelled = false;
  (async () => {
    const row = await db.get<{ local_photo_paths_json: string | null }>(
      'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
    if (cancelled || !row) return;
    setPhotoView(getLocalPhotoPathsFromCache(row));
  })();
  return () => { cancelled = true; };
}, [req?.id, signReqs.query.dataUpdatedAt, db]);
```

Add `useEffect` / `useState` to the existing React import if they aren't already there.

- [ ] **Step 3: Replace the photos card**

Find the existing photos `Card` (around lines 121–132 — `entry.photo_paths.length > 0 && ( ... )`). Replace it with:

```tsx
{entry.photo_paths.length > 0 && (
  <Card>
    <Text style={[typography.bodyBold, { color: colors.textPrimary, marginBottom: spacing.xs }]}>
      Photos
    </Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {Array.from({ length: entry.photo_paths.length }).map((_, i) => {
        const localPath = photoView.pending ? '' : (photoView.paths[i] ?? '');
        if (localPath) {
          return <Image key={i} source={{ uri: localPath }} style={{ width: 100, height: 100, borderRadius: 6 }} />;
        }
        return (
          <View
            key={i}
            style={{
              width: 100, height: 100, borderRadius: 6,
              backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
              {photoView.pending ? 'Loading…' : 'Photo unavailable'}
            </Text>
          </View>
        );
      })}
    </View>
    {photoView.pending && (
      <Banner variant="info" message="Downloading photos…" />
    )}
    {!photoView.pending && photoView.missingCount > 0 && (
      <Banner
        variant="warning"
        message={`${photoView.missingCount} of ${entry.photo_paths.length} photos couldn't be downloaded. Will retry on next sync.`}
      />
    )}
  </Card>
)}
```

Verify `colors.surfaceMuted` exists in the theme. If not, use `colors.border` as a neutral fallback.

- [ ] **Step 4: Check color token exists**

Run: `grep -n "surfaceMuted\|surface" src/theme/tokens.ts`

If `surfaceMuted` is not defined, replace with `colors.border` in the snippet above.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npx jest`

Expected: all tests PASS (no test exercises this screen, but nothing should regress).

- [ ] **Step 7: Manual smoke test**

```bash
npx expo start
```

Steps to exercise:
1. Sign in on two devices (or two simulators): Device A as a tech (Level ≥ II), Device B as a supervisor (Level III with supervisor capability enabled).
2. From A, attach 2 photos to a draft entry and "Send for signature" to Device B.
3. On Device B, open Inbox, tap the sign request.
4. Verify: the Photos card shows the same photos as Device A, not broken images. If offline or the download races, placeholder tiles with "Loading…" then "Photo unavailable" should show cleanly.
5. Sign the request on B. Return to Inbox. The row disappears from pending.
6. Trigger a manual sync (or background the app and resume). Verify via a debug DB inspector (or by killing and re-opening) that the supervisor's local cache folder was cleaned up.

Note in the commit message if you couldn't run step 5–6 end to end — the service-layer tests cover that path fully, this is belt-and-suspenders.

- [ ] **Step 8: Commit**

```bash
git add src/screens/SignRequestDetailScreen.tsx
git commit -m "feat(ui): render supervisor-downloaded photos in SignRequestDetailScreen"
```

---

## Self-Review Notes

- **Spec coverage:** Sections 1–10 of the spec are each referenced by at least one task: §3 downloadRequestPhotos → Task 3; §3 cleanupRequestPhotos → Task 4; §4 file helpers → Task 2; §5 schema → Task 1; §6 sync integration → Task 6; §7 UI selector → Task 5, screen changes → Task 8; §8 test plan → Tasks 3/4/5/6/7; §9 out-of-scope items explicitly not in any task; §10 invariants preserved by construction (`entry_payload.photo_paths` never rewritten, sync ordering unchanged, no impact on hash dispatch).
- **Placeholder scan:** No "TBD", "TODO", or "similar to Task N" left. Every code block is complete enough to paste.
- **Type consistency:** `downloadRequestPhotos` and `cleanupRequestPhotos` signatures match between tasks 3/4, the service return block, and task 6's sync extension. `getLocalPhotoPathsFromCache` shape matches between task 5 and task 8's UI consumer.
- **Test-count math:** Tasks 1/3/4/5/6/7 add 2 + 4 + 2 + 3 + 4 + 0 = 15 new tests plus 2 E2E assertions in an existing test. Full suite target: 132 → ~147 passing.
