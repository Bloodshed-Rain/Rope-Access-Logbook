# Supervisor-side Photo Download

Spec date: 2026-04-19
Parent spec: `2026-04-18-supervisor-accounts-design.md`

Supersedes section 6 of `2026-04-19-supervisor-accounts-part-b-design.md`. That earlier sketch used lazy, on-screen-mount downloads into `FileSystem.cacheDirectory`. This spec replaces it with eager, sync-time downloads into a managed `logbook/signrequest_photos/` directory with lifecycle tied to sign-request status and sha256 verification against the manifest.

---

## 1. Problem

When the supervisor opens `SignRequestDetailScreen`, the rendered `entry.photo_paths` contains the tech's device-local absolute paths (e.g. `/data/user/0/.../logbook/photos/e1_0.jpg`). These don't resolve on the supervisor's device. The screen currently shows a literal disclaimer banner ("images reside on the tech's device; upload/download of the request's copies is not yet wired up") and broken image tiles.

The photos are already uploaded. `sendRequest` uploads each photo to `sign-requests/{request_id}/photo_{entry_id}_{i}.{ext}` and records the final keys plus `{sha256, size_bytes}` in `sign_requests.assets_manifest`. The gap is purely supervisor-side read.

## 2. Approach

- **Trigger**: eager, as part of `syncSignRequests`. When a new `pending` row lands in cache where `currentUid === supervisor_user_id`, download its photos immediately.
- **Cache lifecycle**: tied to sign-request status. When a row transitions to a terminal state (`signed | declined | withdrawn | expired`) and `currentUid === supervisor_user_id`, delete the per-request cache folder.
- **Integrity**: verify sha256 of each downloaded asset against `assets_manifest[key].sha256`. Mismatches are quarantined (file deleted, index marked failed). Matches the quarantine pattern from `restoreService`.
- **Idempotency**: re-syncing or re-downloading is a no-op when the local file already exists with matching sha256.
- **Offline-tolerance**: download failures never throw to the caller. Failed indices show a placeholder tile; the top-up pass on the next sync retries.

## 3. Service surface

Two new exports on `signRequestsService`:

### `downloadRequestPhotos(row: SignRequest): Promise<{ localPaths: string[]; failed: number[] }>`

1. Output `localPaths` has `length === row.entry_payload.photo_paths.length`, initialised to empty strings.
2. Iterate `row.assets_manifest` entries. Only keys whose basename matches `/^photo_[^_]+_(\d+)\.[^.]+$/` are processed; the parsed numeric group is the index `i` into `localPaths`.
3. For each photo key (each step wrapped in try/catch; any thrown error → add `i` to `failed`, ensure target file is deleted, leave `localPaths[i]` empty):
    - Strip the `sign-requests/` bucket prefix → `bucketKey = key.replace(/^sign-requests\//, '')`.
    - Compute the target local path: `{documentDirectory}logbook/signrequest_photos/{row.id}/{basename}`.
    - **Idempotency check**: if the target file already exists and `fs.getSha256(target)` matches `manifest[key].sha256`, skip download; set `localPaths[i]` to the existing path and continue.
    - Otherwise, call `cloud.downloadSignRequestAsset(bucketKey)` to get `Uint8Array`.
    - Write bytes via `saveSignRequestPhoto(row.id, basename, base64)` (this encodes bytes→base64 at the call site and writes to disk).
    - Compute `fs.getSha256(target)`; compare with `manifest[key].sha256`. Mismatch → delete target file, add `i` to `failed`.
    - Match → set `localPaths[i]` to the returned absolute path.
4. Persist the result to `sign_requests_cache` (wrapped in try/catch — DB failure does not rethrow):

    ```sql
    UPDATE sign_requests_cache
       SET local_photo_paths_json = ?
     WHERE id = ?
    ```

5. Return `{ localPaths, failed }`. **Never throws.** All per-photo errors surface via `failed`; the function's contract is best-effort and callers treat a thrown promise as a programming bug, not an expected state.

### `cleanupRequestPhotos(row: SignRequest): Promise<void>`

1. Call `deleteSignRequestPhotosDir(row.id)` — removes `{documentDirectory}logbook/signrequest_photos/{row.id}/` recursively. No-op if missing.
2. `UPDATE sign_requests_cache SET local_photo_paths_json = NULL WHERE id = ?`.
3. Never throws.

## 4. File storage helpers

Add to `src/utils/fileStorage.ts`:

```ts
const SIGNREQUEST_PHOTOS_DIR = `${LOGBOOK_DIR}signrequest_photos/`;

export async function saveSignRequestPhoto(
  requestId: string,
  basename: string,
  base64Data: string,
): Promise<string> {
  const dir = `${SIGNREQUEST_PHOTOS_DIR}${requestId}/`;
  await ensureDir(dir);
  const destPath = `${dir}${basename}`;
  await FileSystem.writeAsStringAsync(destPath, base64Data, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return destPath;
}

export async function deleteSignRequestPhotosDir(requestId: string): Promise<void> {
  const dir = `${SIGNREQUEST_PHOTOS_DIR}${requestId}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (info.exists) {
    await FileSystem.deleteAsync(dir, { idempotent: true });
  }
}
```

## 5. Schema

Add one column to `sign_requests_cache`:

```sql
local_photo_paths_json TEXT
```

Nullable. JSON-serialised `string[]` aligned index-by-index with `entry_payload.photo_paths`. Empty string at index `i` means that photo is not cached locally (failed or pending retry). `NULL` means the download pass hasn't run yet for this row.

Added idempotently via `runSchemaMigrations` — guarded `PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN` check, same pattern as existing supervisor columns. Also added to the canonical `SCHEMA_SQL` in `schema.ts` so fresh-install DBs and tests pick it up.

## 6. Sync integration

`signRequestsService.sync()` runs three phases, in order:

### Phase 1 — top-up for pre-existing or previously-failed rows

```ts
const uid = cloud.getCurrentUserId();
if (uid) {
  const rows = await db.getAll<{ payload_json: string }>(
    `SELECT payload_json FROM sign_requests_cache
      WHERE status = 'pending'
        AND supervisor_user_id = ?
        AND local_photo_paths_json IS NULL`,
    [uid],
  );
  for (const r of rows) {
    try { await downloadRequestPhotos(JSON.parse(r.payload_json)); } catch {}
  }
}
```

Handles two cases: rows cached before this feature shipped (migration leaves their `local_photo_paths_json` null), and rows whose previous download failed entirely (`downloadRequestPhotos` only persists the column on success of at least the DB update step — which it always reaches since it catches all errors per-photo; however if a row's download attempt was never made due to sync crashing mid-loop, the column stays null).

### Phase 2 — existing main loop, extended

For each row returned by `listSignRequests(since)`:

```ts
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

if (
  currentUid && r.tech_user_id === currentUid &&
  (r.status === 'withdrawn' || r.status === 'declined' || r.status === 'expired')
) {
  /* existing entry-unlock */
}
```

All photo-related calls are wrapped so a single storage failure never breaks the rest of sync.

## 7. UI changes

`SignRequestDetailScreen` (`src/screens/SignRequestDetailScreen.tsx`):

- Remove the misleading disclaimer ("images reside on the tech's device…").
- Parse `local_photo_paths_json` from the request's cached row. Expose via a small pure selector in `signRequestsService`:

    ```ts
    export function getLocalPhotoPathsFromCache(
      cachedRow: SignRequestCacheRow,
    ): { paths: string[]; missingCount: number; pending: boolean } {
      if (cachedRow.local_photo_paths_json == null) {
        return { paths: [], missingCount: 0, pending: true };
      }
      const paths = JSON.parse(cachedRow.local_photo_paths_json) as string[];
      const missingCount = paths.filter(p => p === '').length;
      return { paths, missingCount, pending: false };
    }
    ```

- Render grid:
    - If `pending === true`: render `entry.photo_paths.length` placeholder tiles and a banner "Downloading photos…".
    - Else: for each index `i < entry.photo_paths.length`, render `<Image src={paths[i]} />` if non-empty, or a placeholder tile with "Photo unavailable" text. Show a warning banner when `missingCount > 0`: `"N of M photos couldn't be downloaded. Will retry on next sync."`.

No new hook. The existing `useSignRequests` surface re-renders when `sign_requests_cache` changes.

## 8. Test plan

`__tests__/services/signRequestsService.test.ts` — new tests:

- `downloadRequestPhotos` writes N local files for N manifest photos, populates `local_photo_paths_json` with N absolute paths, returns `failed: []`.
- Idempotent: a second call with files already on disk skips download (verify via mock call counter) and produces the same output.
- sha256 mismatch: mock cloud returns tampered bytes for one key → that file is not written (or is deleted), that index is in `failed` and is empty string in persisted column.
- Download throw: mock cloud throws for one key → that index is in `failed`, others succeed, no top-level throw, `local_photo_paths_json` is still persisted.
- Index alignment: manifest missing index `1` → output array is still `length === entry.photo_paths.length`; slot 1 is empty, `failed` includes `1`.
- `cleanupRequestPhotos`: folder deleted (verify via fs mock), column nulled.
- `cleanupRequestPhotos` is a no-op when the folder doesn't exist.
- `sync` downloads photos for new supervisor-side pending rows.
- `sync` top-up pass downloads for pre-existing supervisor-side pending rows with null column.
- `sync` calls `cleanupRequestPhotos` on any supervisor-side terminal transition.
- `sync` does NOT download photos for tech-side rows.

`__tests__/db/migrationsSupervisor.test.ts` — assert `local_photo_paths_json` is present on `sign_requests_cache` after `runSchemaMigrations` on canonical and legacy schemas.

`__tests__/services/fullRemoteSignFlow.test.ts` — extend: after the supervisor syncs a pending request, assert local photo files exist with bytes matching the tech's originals. After the supervisor signs and re-syncs, assert the cache folder is gone.

Mock infra: `createMockCloudClient.downloadSignRequestAsset` already exists (used by the signature-PNG path). Verify it returns the correct bytes for photo keys; extend the mock storage if needed. `createMockFs` already supports the write/read/delete primitives.

Target: ~12 new unit tests + 1 migration assertion + 1 E2E extension. Suite moves from 132 → ~145.

## 9. Out of scope

- Any client-side photo download for the **tech** viewing their own outgoing request. The tech already has the originals locally; no need to round-trip through cloud.
- Server-side `cleanup-request-assets` Edge Function. Separate scope (still in Part B spec section 3).
- Prefetch of signed requests the supervisor wants to re-review after the fact. Terminal-state cleanup is intentional.

## 10. Invariants preserved

- `entry_payload.photo_paths` in `sign_requests` rows keeps its original tech-device paths. Never rewritten. This spec only adds a *parallel* supervisor-side local-path list.
- Sign-request insert ordering (row before assets) is unchanged.
- Supervisor-accounts writes-require-online invariant is unchanged. Photo downloads are reads, best-effort, offline-tolerant.
- `CURRENT_HASH_VERSION` and the hash-version dispatch are unaffected — photos aren't part of the entry hash input.
