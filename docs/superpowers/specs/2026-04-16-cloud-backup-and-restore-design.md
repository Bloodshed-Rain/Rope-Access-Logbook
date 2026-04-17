# Cloud Backup & Restore — Design Spec

**Date:** 2026-04-16
**Status:** Draft — awaiting user review
**Scope:** Phase B sub-project 1 of 3 (accounts + single-user cloud backup). Sub-projects 2 (supervisor accounts + remote signing) and 3 (cryptographic keypair signing) are deferred and out of scope.

## 1. Purpose & success criteria

Give a tech the ability to sign up for a cloud account, back their logbook up to the cloud, and restore it on a new device if the old one is lost, replaced, or reset.

**In scope for v1:**

- Single-user accounts (one tech, one logbook per account).
- Triggered snapshot backup (not continuous sync).
- Account recovery via Apple, Google, or email magic link.
- Full restore on a new device, preserving all tamper-detection guarantees.
- Explicit conflict resolution when local and cloud both have data.
- Account deletion (cloud + auth) with local logbook preserved.

**Out of scope (deferred):**

- Cryptographic non-repudiation of the cloud snapshot → Phase B sub-project 3.
- Supervisor accounts, remote signing, shared logbook views → Phase B sub-project 2.
- Real-time continuous sync, multi-device simultaneous editing.
- Server-side analytics, admin dashboards, org/employer accounts.

**Success criteria:**

- A tech can sign up from a fresh install with no prior data.
- A tech with an existing local logbook can sign up without losing data.
- A tech can restore their full logbook on a new device with all signed entries still passing hash verification.
- The app continues to work fully offline with no account, identically to the MVP.
- Account deletion is available and unambiguously destructive-to-cloud, preserving-to-local.

## 2. Key decisions

| Decision | Chosen option | Rationale |
|---|---|---|
| Primary driver | Cloud backup + device restore (single-user) | Matches minimum surface area principle; defers multi-tenancy complexity. |
| Freshness model | Triggered snapshot (not continuous sync) | Tech's mental model already matches the existing JSON export story. No draft-conflict plumbing needed. |
| Backend | Supabase managed | Matches README roadmap. Auth + Storage covers 100% of needs. |
| Binary scope | Full fidelity with global "back up photos" toggle; **photos default OFF** | Paper logbooks don't store photos — paper is the reference model. |
| Toggle granularity | Global only, no per-entry override | Minimal UX surface. |
| Toggle transition off→on | Next backup backfills all historical photos | Manifest is re-computed each backup; delta upload handles backfill naturally. |
| Toggle transition on→off | Photos uploaded during on-period get deleted on next backup | Snapshot's manifest is authoritative each time; orphans get cleaned. |
| Auth methods | Apple OAuth + Google OAuth + email magic link (no password) | App Store rule requires Apple if Google is offered. Magic link is the accessibility fallback. |
| Account unification | Enabled (Supabase `identity_linking` by email) | Prevents duplicate accounts when users return via a different method. |
| Sign-out behavior | Preserves local DB; stops backup triggers | App is fully usable without an account. |
| Tamper/security model | Cloud is a trusted custodian; local device is authoritative | Crypto integrity of cloud snapshot deferred to Phase B sub-project 3. |
| Data model on server | JSON blob in Storage (no Postgres tables) | Maps 1:1 onto existing `JsonBackup` type and `exportService`. |
| Backup triggers | Post-sign event + app-background + manual button; **30-second throttle**; any network | Covers signed entries (critical), recent drafts (best-effort), user-initiated (transparency). |
| Conflict resolution | Explicit choice, no merge | Two buttons: "Keep cloud" or "Replace cloud." Signed entries are immutable so merge is meaningless. |

## 3. Architecture overview

### 3.1 Server (Supabase)

- **Auth** — Apple + Google OAuth + email magic link; identity linking by email enabled.
- **Storage** — single private bucket `logbook-backups`.
- **No Postgres tables** introduced in this sub-project.
- **Edge Function** — `delete-account` runs with service-role privileges, operates only on the calling user's own ID (derived from the request JWT, never accepted as a parameter).

#### Storage layout per user

```
{user_id}/
  snapshot.json                              ← single CloudSnapshot file, replaced each backup
  assets/
    sig_{signature_id}.png                   ← supervisor signature image
    spratcard_{profile_id}.{ext}             ← SPRAT card photo
    photo_{entry_id}_{index}.{ext}           ← entry photos (only if photos_in_backup = true)
```

Asset filenames are content-keyed to their owning DB row, decoupling cloud storage from device-local file paths.

#### Storage RLS policy

A single `FOR ALL` policy restricts every operation to the caller's own prefix:

```sql
CREATE POLICY "own_prefix_rw" ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'logbook-backups'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

### 3.2 Client

#### New files

```
src/
  cloud/
    cloudClient.ts           CloudClient interface (mockable)
    supabaseClient.ts        Runtime impl using @supabase/supabase-js + expo-auth-session
  services/
    authService.ts           signInWithApple/Google/MagicLink, signOut, deleteAccount, getSession
    cloudBackupService.ts    backup(), getLastBackupStatus()
    restoreService.ts        restore(), previewCloudState(), resolveConflict(choice)
  hooks/
    useAuthSession.ts        React Query wrapper around Supabase auth state
    useBackupStatus.ts       last_cloud_backup_at + pending/uploading state
    useBackup.ts             trigger-backup mutation
    useRestore.ts            restore mutation
  screens/
    AuthScreen.tsx           three buttons (Apple, Google, Email)
    CloudConflictScreen.tsx  Scenario C resolution
    MagicLinkWaitScreen.tsx  "check your email" after submitting an address
  components/
    ProfileCloudSection.tsx  new Cloud section inside ProfileScreen
  utils/
    paths.ts                 normalizeAppPath() / rehydrateAppPath() for portable paths
```

#### Touched existing files

- `src/types.ts` — add `CloudSnapshot`, `BinaryManifest`, `AuthSession`, `BackupStatus`, `BackupResult`; add `photos_in_backup: boolean` and `last_cloud_backup_at: string | null` and `last_uploaded_backup_id: string | null` to `Profile`; add `hash_version: number` to `Signature`.
- `src/db/schema.ts` — idempotent migration adds the three new profile columns plus `hash_version INTEGER NOT NULL DEFAULT 1` on signatures.
- `src/utils/canonical.ts` — no change; takes normalized inputs from `signingService`.
- `src/services/signingService.ts` — `entryRowToHashInput` normalizes paths via `normalizeAppPath` before canonicalizing; new signatures write `hash_version = 2`.
- `src/services/profileService.ts` — `updateCloudBackupState(backup_id, backed_up_at)` helper.
- `src/hooks/useSignatures.ts` — `onSuccess` in the signing mutation triggers a backup (no new event-bus pattern introduced).
- `src/navigation/RootNavigator.tsx` — add `AuthScreen`, `CloudConflictScreen`, `MagicLinkWaitScreen`; add gate branches for the new auth/conflict states.
- `src/screens/ProfileScreen.tsx` — mount `<ProfileCloudSection />`.
- `src/screens/OnboardingScreen.tsx` — optional "already have an account? sign in" link at the bottom.
- `App.tsx` — `AppState` listener fires a backup when the app goes to `background`.

#### Service signature pattern

Matches existing services (pure functions, dependencies injected):

```ts
export function createCloudBackupService(deps: {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  hash: HashFn;
  exportService: ReturnType<typeof createExportService>;
  clock: () => string;
  appVersion: string;
}) {
  return {
    async backup(): Promise<BackupResult> { ... },
    async getLastBackupStatus(): Promise<BackupStatus> { ... },
  };
}
```

#### CloudClient interface

```ts
interface CloudClient {
  uploadObject(key: string, bytes: Uint8Array): Promise<void>;
  downloadObject(key: string): Promise<Uint8Array>;
  listPrefix(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
  getCurrentUserId(): string | null;
  signInWithProvider(provider: 'apple' | 'google'): Promise<AuthSession>;
  signInWithMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  callEdgeFunction<T>(name: string, body: unknown): Promise<T>;
}
```

Tests use an in-memory implementation; runtime uses `supabaseClient.ts`.

## 4. Path-normalization fix (required pre-work bundled into this sub-project)

**Discovered during design review.** The MVP stores absolute file paths in DB columns (`entries.photo_paths`, `signatures.signature_png_path`, `profile.sprat_card_photo_path`). These paths include `FileSystem.documentDirectory`, which on iOS includes a per-install container UUID — reinstalling the app on the same device produces a different prefix.

Because `signingService.entryRowToHashInput` includes `photo_paths` in the hash input, **every signed entry would fail hash verification after any reinstall** — including restore to a new device, which is the whole point of this sub-project. This is a pre-existing latent bug, not introduced by cloud backup, but made operative by it.

### 4.1 Fix

- Add `src/utils/paths.ts` exporting:
  - `normalizeAppPath(absolutePath: string): string` — strips `FileSystem.documentDirectory` and returns a relative path like `logbook/photos/abc.jpg`. If the path does not have the documentDirectory prefix (unexpected), returns the input unchanged and logs a warning.
  - `rehydrateAppPath(relativePath: string): string` — prepends `FileSystem.documentDirectory` to produce an absolute path usable by expo-file-system.
- `signingService.entryRowToHashInput` parses `photo_paths` from its stored JSON string, applies `normalizeAppPath` to each element, and passes the resulting string array to `canonicalize`. (`canonical.ts` already recursively handles arrays, so no change is needed there.) Hash inputs become device-portable.
- New column `signatures.hash_version INTEGER NOT NULL DEFAULT 1`. New signatures write `hash_version = 2`. Verification dispatches on the stored value:
  - `hash_version = 1` → legacy algorithm (absolute paths).
  - `hash_version = 2` → new algorithm (normalized paths).

### 4.2 One-shot migration for pre-existing v1 signatures

Run at DB init when the app first launches with the new schema:

1. `SELECT * FROM signatures WHERE hash_version = 1 OR hash_version IS NULL`.
2. For each, verify using the v1 algorithm on the current device. Paths haven't changed since signing (same install), so v1 verification is meaningful here.
3. If v1 verification passes: recompute the hash using v2 (normalized paths), `UPDATE signatures SET entry_hash = ?, hash_version = 2 WHERE id = ?`.
4. If v1 verification fails: leave the row at `hash_version = 1` with the original (failing) hash. The existing integrity banner will continue to surface this as tampered. No destructive change.

After migration, verification is uniform (v2) for all future rows, and existing signatures are portable across devices.

### 4.3 Paths in the cloud snapshot

- In `snapshot.json`, all path columns (`entries.photo_paths`, `signatures.signature_png_path`, `profile.sprat_card_photo_path`) are **stored relative** (normalized before upload).
- On restore, path columns are rewritten with the new device's absolute paths before insertion into the local DB.
- The `binary_manifest` in `snapshot.json` uses Storage keys (e.g. `assets/sig_{id}.png`) — no device paths anywhere in the cloud side.

## 5. Server data model

### 5.1 `CloudSnapshot` shape

Extends the existing `JsonBackup` type with cloud-specific metadata:

```ts
interface CloudSnapshot extends JsonBackup {
  // Inherited from JsonBackup:
  //   app_version, exported_at, profile, entries, signatures, schema_version

  cloud_schema_version: 1;                  // versions the cloud-side semantics
  backup_id: string;                        // UUID of this snapshot
  binary_manifest: {
    [storage_key: string]: {                // e.g. "assets/sig_abc123.png"
      sha256: string;                       // integrity check on restore
      size_bytes: number;
      created_at: string;
    };
  };
  photos_included: boolean;                 // reflects the toggle state at backup time
}
```

All path columns inside `profile`, `entries`, and `signatures` are **relative** in the snapshot (see section 4.3).

### 5.2 Version compatibility

- `cloud_schema_version` versions the cloud-side semantics (snapshot shape, storage layout). Current value: `1`.
- Existing `schema_version` (inherited from `JsonBackup`) continues to version the DB row shape.

Compatibility policy on restore:

| Cloud vs. app | Policy |
|---|---|
| `cloud_schema_version > app.MAX_CLOUD_SCHEMA_VERSION` | Refuse restore with "App out of date, please update." |
| `cloud_schema_version <= app.MAX_CLOUD_SCHEMA_VERSION` | Allowed. |
| `schema_version > app.MAX_DB_SCHEMA_VERSION` | Refuse restore with "App out of date, please update." |
| `schema_version < app.MAX_DB_SCHEMA_VERSION` | Allowed; local DB migrations run after restore imports the rows. |

## 6. User flows

### 6.1 New user (onboarding path)

1. App launches → no profile, no session → `OnboardingScreen`.
2. User completes profile creation (unchanged from MVP).
3. One-time prompt after profile save: "Want to back up your logbook to the cloud? You can always do this later from Profile." → "Sign up" or "Not now."
4. `AuthScreen`: Apple / Google / Email buttons. Apple and Google use `expo-auth-session` with Supabase's PKCE flow. Email opens `MagicLinkWaitScreen`.
5. On successful auth: run Scenario A flow automatically (section 6.4).

### 6.2 Existing user signing in later

1. `ProfileScreen` → "Sign in to back up" → `AuthScreen`.
2. On successful auth, `restoreService.previewCloudState()` fetches `snapshot.json` (if present) without writing locally and returns `{ has_cloud_data, entries_count, signatures_count, cloud_backed_up_at, backup_id }`.
3. Route to Scenario A, B, or C based on local and cloud state (sections 6.4–6.6).

### 6.3 Scenario detection

Detection is based on two pieces of state:

- Local side: presence of profile + entries, plus `profile.last_uploaded_backup_id`.
- Cloud side: presence of `snapshot.json` + its `backup_id`.

| Local state | Cloud state | Scenario |
|---|---|---|
| Empty (no profile) | Empty (no snapshot.json) | Fresh user — Scenario A starts here. |
| Has data | Empty | Scenario A (upload). |
| Empty | Has data | Scenario B (restore). |
| Has data, `last_uploaded_backup_id == cloud.backup_id` | Has data, same `backup_id` | No conflict — already in sync. Normal operation. |
| Has data, `last_uploaded_backup_id != cloud.backup_id` | Has data, different `backup_id` | Scenario C (conflict). |
| Has data, `last_uploaded_backup_id` is null | Has data | Scenario C (conflict — local has never synced to this cloud account). |

### 6.4 Scenario A — local has data, cloud empty

1. Preview modal: "We'll back up N entries, M signatures, K assets." Confirm.
2. `cloudBackupService.backup()` runs (section 6.7).
3. Route to `LogbookScreen`.

### 6.5 Scenario B — local empty, cloud has data

1. Confirmation modal: "Restore your logbook from cloud? This will load N entries, M signatures, K assets."
2. On confirm: download `snapshot.json`, validate versions (section 5.2), download each asset listed in `binary_manifest` with sha256 verification, progress indicator shown.
3. Write rows to local DB in a single transaction. Rewrite path columns with the new device's absolute paths.
4. For each signed entry, run the integrity verification using the stored `hash_version` per signature. Signatures written by any v2-capable source device will verify successfully on the new device (v2 paths are portable). Signatures that still have `hash_version = 1` at migration time (v1 verification failed on the source device) will continue to fail on restore — this is the existing tamper-detection behavior surfacing, not a restore bug.
5. Route to `LogbookScreen`.

### 6.6 Scenario C — conflict

1. `CloudConflictScreen` shows two cards:
   - "Your cloud logbook — N entries, M signatures, last backed up at [ts]."
   - "This device — N entries, M signatures, last synced: [ts or never]."
2. Two buttons, no default:
   - **"Keep cloud, replace this device."** → Scenario B flow, overwriting the local DB in a transaction.
   - **"Replace cloud with this device."** → Scenario A flow, overwriting the cloud snapshot.json and deleting orphaned assets.
3. Closing the screen aborts sign-in; user returns to the signed-out state.

### 6.7 Backup trigger flow

1. Trigger fires via one of:
   - `useSignatures`'s signing mutation `onSuccess` handler.
   - `AppState` transitions to `background`.
   - User taps "Back up now" in `ProfileCloudSection`.
2. **Throttle check.** If the last backup completed <30 s ago AND no new signed entries have been created since that backup, no-op.
3. **Auth check.** If no session, silently skip.
4. **Mutex check.** If another backup is in flight, coalesce (no queue — the next trigger after completion sees the latest state).
5. Build `CloudSnapshot` by composing `exportService.exportAsJson()` + cloud metadata + `binary_manifest`.
6. Diff the new `binary_manifest` against the cached last-uploaded manifest (AsyncStorage). Upload only new or changed assets.
7. Delete orphaned assets (in cache but not in the new manifest) — covers the photos-toggle-off case.
8. Upload `snapshot.json` **last**, after all referenced assets exist.
9. Persist the new `binary_manifest` to AsyncStorage.
10. `UPDATE profile SET last_cloud_backup_at = ?, last_uploaded_backup_id = ? WHERE id = ?`.
11. Non-intrusive UI indicator updates (cloud-up icon on Logbook header).

### 6.8 Sign-out

- Confirmation: "Your on-device logbook will stay. You can sign in again anytime."
- Clear Supabase session. Do NOT clear `last_cloud_backup_at` or `last_uploaded_backup_id` (kept as honest history; if the user signs back in, Scenario C detection uses them).

### 6.9 Account deletion

1. "Delete cloud backup + account" button in `ProfileCloudSection`.
2. Two-step confirmation:
   - Modal: "This permanently deletes your cloud backup. Your on-device logbook will remain. Continue?"
   - Type-to-confirm: "Type DELETE to confirm."
3. Client calls Edge Function `delete-account`:
   - Function derives caller's `user_id` from JWT only.
   - Deletes all objects under `{user_id}/` via Storage admin API.
   - Deletes the Auth user via `auth.admin.deleteUser`.
4. Client clears Supabase session, clears `last_cloud_backup_at` and `last_uploaded_backup_id` locally.
5. User returns to `LogbookScreen`. App is indistinguishable from pre-signup.

## 7. Error handling

### 7.1 Backup-side failures

| Failure | Behavior |
|---|---|
| Offline | Silent skip; retries on next trigger. |
| Auth session expired, refresh succeeds | Transparent to user. |
| Auth session expired, refresh fails | Durable banner: "Backup paused — sign in again." |
| Storage quota exceeded | Durable banner: "Cloud storage full — manage your backup in Profile." |
| Asset upload fails mid-backup | `snapshot.json` is NOT uploaded. Prior snapshot still references existing assets (never a broken reference). Next trigger retries remaining deltas + snapshot. |
| Network interruption | Same as asset-upload-fails. |
| Concurrent trigger | Coalesced via in-memory mutex. |

### 7.2 Restore-side failures

| Failure | Behavior |
|---|---|
| `cloud_schema_version` or `schema_version` too new for app | Refuse restore; "Please update the app." Local DB untouched. |
| Asset missing from Storage but listed in manifest | Restore proceeds for other assets. Affected entry shows "Signature image missing from backup" banner. Entry hash still verifies (the hash is over entry content, not the image bytes). |
| Asset sha256 mismatch | Asset quarantined (not written locally); same banner as above. |
| Network interruption mid-download | Nothing is committed to the local DB. Retry starts fresh; partial downloads are discarded. |
| Hash verification fails post-restore for a specific signed entry | Integrity banner on `EntryDetailScreen` shows it (existing behavior); restore as a whole does not fail. |

### 7.3 Signup while offline

Not supported in v1. `AuthScreen` shows a non-blocking notice and disables auth buttons when offline. App remains fully functional without signup.

### 7.4 OAuth deep-linking in Expo

- Configure app scheme `logbook://` in `app.json`.
- Supabase redirect URL configured to match.
- `expo-auth-session` + Supabase PKCE for Apple and Google.
- Magic-link emails contain `logbook://auth-callback?token=...`. An `App.tsx` `Linking` listener consumes the token and resolves the pending session.
- Supabase client configured with `persistSession: true`, `autoRefreshToken: true`, AsyncStorage adapter.

### 7.5 Schema migration mechanics

- `src/db/client.ts` `initDb` adds idempotent guarded ALTER TABLE statements:
  - `profile.photos_in_backup BOOLEAN NOT NULL DEFAULT 0`
  - `profile.last_cloud_backup_at TEXT`
  - `profile.last_uploaded_backup_id TEXT`
  - `signatures.hash_version INTEGER NOT NULL DEFAULT 1`
- Each guarded by a `PRAGMA table_info` check before attempting the ALTER. Safe on repeat runs.
- After schema migration, the one-shot v1→v2 hash migration (section 4.2) runs.

### 7.6 `device_id` across devices

Unchanged from MVP. Each device has its own stable `device_id`. On restore, existing signatures preserve their original `device_id` (attests to the device that witnessed the signing). The new device generates its own `device_id` for future signings.

## 8. Security

- Storage RLS restricts every operation to the caller's own prefix. Verified at setup by attempting cross-user access from a second test account and confirming denial.
- `delete-account` Edge Function is the only code running with service-role privileges. It derives `user_id` from the request JWT only; it never accepts a `user_id` parameter.
- No client-side PII shipped to third-party analytics. Error reporting (if added) scrubs email and `user_id`.
- Client DB encryption-at-rest is delegated to OS disk encryption (carried forward from MVP).
- Supabase anon key lives in env / `expo-constants` config — not committed as a secret; this is fine per Supabase's threat model since RLS enforces access control.
- Server-side encryption-at-rest is provided by Supabase Storage.

## 9. Testing strategy

### 9.1 Test infrastructure

- `__tests__/cloudMock.ts` — in-memory `CloudClient` implementation. Stores uploads in `Map<string, Uint8Array>`. Simulates auth state, supports configurable failure modes (offline, 403, quota-exceeded, partial upload). Sits alongside the existing `__tests__/setup.ts` DB helper.
- `__tests__/fsMock.ts` — `FileSystemAbstraction` mock for deterministic path and I/O behavior.

### 9.2 Service-layer tests (TDD, same pattern as existing services)

**`__tests__/services/cloudBackupService.test.ts`:**

- Uploads `snapshot.json` with correct shape and `binary_manifest`.
- Delta-uploads: second backup with one new signature uploads only the new PNG + snapshot.
- Throttling: second backup within 30 s is a no-op when no new signed entries exist.
- Atomicity: asset upload failure → `snapshot.json` not uploaded; retry uploads remaining deltas and snapshot.
- Concurrent trigger coalescing.
- Auth absent → silent skip.
- Photos-toggle off→on: next backup uploads historical photos (backfill).
- Photos-toggle on→off: next backup deletes previously-uploaded photos (orphan cleanup).

**`__tests__/services/restoreService.test.ts`:**

- Scenario B: downloads snapshot, rewrites DB, writes assets, verifies hashes, rewrites path columns to new absolute paths.
- `cloud_schema_version` too new → refuses, DB untouched.
- `schema_version` too new → refuses, DB untouched.
- Asset missing in Storage but listed in manifest → rest of restore succeeds; affected entry flagged.
- Asset sha256 mismatch → affected asset quarantined; restore still succeeds.
- Partial download mid-restore → nothing committed, retry starts fresh.
- Hash verification on each signed entry uses v2 algorithm; passes with portable paths.

**`__tests__/services/authService.test.ts`:**

- Session round-trip (sign-in, get, sign-out).
- Sign-out clears session but not local DB.
- `deleteAccount()` calls the Edge Function and clears local cloud-related state.

**`__tests__/services/signingService.test.ts` (additions):**

- New signature → `hash_version = 2`, hash uses normalized paths.
- Verify v1 signature with v1 algorithm (backward compat).
- Verify v2 signature with v2 algorithm.

**`__tests__/db/migration.test.ts`:**

- Schema migration: idempotent over multiple runs, adds expected columns.
- V1→V2 hash migration: passes-v1-verification rows become `hash_version = 2` with recomputed hash; fails-v1 rows stay `hash_version = 1` with original hash.

### 9.3 Not in unit tests

- Real Supabase network round-trips.
- Real OAuth provider flows.
- Real deep-link resolution.
- Real Edge Function invocation.

These are covered by a manual QA checklist against a development Supabase project, produced as part of the implementation plan.

## 10. Rollout

- Single release introducing the whole sub-project. No feature flags — the local-app MVP doesn't have the infrastructure and YAGNI applies.
- Development Supabase project used during implementation. Manual end-to-end QA against it before cutting release.
- Production Supabase project provisioned at release time with same schema and policies.
- Config values (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) shipped in the app bundle via `expo-constants`. Service-role key lives only in deployed Edge Functions, never in the client.

## 11. Known risks and open implementation details

- **Apple Sign-In requires a paid Apple Developer account** for iOS distribution. If not yet available, v1 can ship with Google + email magic link; Apple added in a follow-up once the developer account is in place. Not a spec change — a release-time choice.
- **Edge Function cold start** adds ~1–2 s to account deletion. Acceptable for a confirmed destructive action.
- **`last_cloud_backup_at` / `last_uploaded_backup_id` on the `profile` row.** Arguably cloud-session state rather than profile identity, and could live in AsyncStorage. Keeping them on `profile` is pragmatic: React Query already reads the profile, the existing backup-reminder banner already reads `last_backup_at`, and the fields are useful for audit context. Tradeoff accepted.
- **Storage quota** — 1 GB free tier comfortably covers a tech's signatures-and-SPRAT-card lifetime (signatures ~100 KB each, SPRAT card one photo). If photos toggle is ON, heavy users can exceed free tier over a 3-year cert cycle and will need Pro tier ($25/mo). Surfaced via in-app banner when quota hits.

## 12. Reference material

- MVP spec (referenced in CLAUDE.md): `docs/superpowers/specs/2026-04-15-rope-access-logbook-design.md` (note: file not present in repo at time of writing; CLAUDE.md reference may be stale).
- Supabase docs — Storage, Auth with Expo, Edge Functions, Row Level Security. Pull via Context7 when implementing.
- Expo docs — `expo-auth-session`, `expo-file-system/legacy` (already in use), `AppState` lifecycle.
