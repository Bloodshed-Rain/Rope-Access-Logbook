# CLAUDE.md

This file orients Claude Code sessions working in this repository. Read it first; then read the specific file your task touches.

## Project

Rope Access Logbook is an offline-first iOS + Android app for SPRAT-certified rope access technicians. It replaces the paper work-experience logbook that techs carry to every job site: entries with hours and work descriptions, on-screen supervisor signatures captured at the end of each shift, and a PDF export suitable for re-certification audits.

The app is one product being built incrementally. Do not describe the codebase as "MVP plus add-ons" or as a sequence of phases or sub-projects — that framing is planning-internal and the user has rejected it. When describing state, use plain "currently implemented" vs. "not yet implemented" language. The "Not yet implemented" section at the bottom of this file enumerates what's in scope but unbuilt.

Primary design references:

- Core app design: `docs/superpowers/specs/2026-04-15-rope-access-logbook-design.md` (referenced by later specs; check for presence before relying on it — it may not be in the repo).
- Cloud backup and restore: `docs/superpowers/specs/2026-04-16-cloud-backup-and-restore-design.md`. Section 4 (path normalization + v1→v2 hash migration) and section 6.3 (conflict scenarios A/B/C) are load-bearing.
- Implementation plan history: `docs/superpowers/plans/2026-04-16-cloud-backup-and-restore.md`. The spec is canonical; the plan is history.
- Entry-logging enhancements (in-flight, not yet implemented): `docs/superpowers/specs/2026-04-17-entry-logging-enhancements-design.md`.

## Commands

All commands run from the repo root.

```bash
npx expo start                       # dev server
npx expo start --ios
npx expo start --android
npx expo start --tunnel              # requires @expo/ngrok (already a devDep)

npx jest                             # full test suite
npx jest __tests__/services/entriesService.test.ts
npx jest --testNamePattern="creates a draft entry"

npx tsc --noEmit                     # type check (see "Known state" below — `supabase/` folder breaks this)
```

Supabase provisioning (dev and prod project setup, documented in `supabase/README.md`):

```bash
supabase db push --db-url postgres://...     # applies supabase/migrations/*.sql
supabase functions deploy delete-account --no-verify-jwt
supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
```

`.env` at repo root supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `app.config.ts`; the app throws on missing config at `getConfig()` call time (`src/config.ts`). The app is fully usable offline without valid Supabase credentials until the user signs in.

## Architecture — three-layer structure

### Persistence (`src/db/`)

The `DbClient` interface in `client.ts` is the only DB abstraction. It exposes `run`, `get`, `getAll`, `exec` against parameterized SQL. The runtime implementation (`expoClient.ts`) wraps `expo-sqlite` and is instantiated by `initialize.ts`; tests use `better-sqlite3` in-memory via `__tests__/setup.ts`'s `createTestClient()`. Schema lives in `schema.ts` — five tables (`profile`, `entries`, `signatures`, `supervisor_connections_cache`, `sign_requests_cache`) plus indexes. New columns are added idempotently by `migrations.ts` via guarded `PRAGMA table_info` + `ALTER TABLE`; the profile table currently carries `photos_in_backup`, `last_cloud_backup_at`, `last_uploaded_backup_id`, `supervisor_capability_enabled`, `supervisor_cert_number`, `supervisor_directory_visible`; the entries table carries `pending_sign_request_id` (with a partial index); the signatures table carries `hash_version`.

Boot sequence, `initialize.ts::initializeDatabase()`:

1. Open SQLite with WAL pragma.
2. Exec `SCHEMA_SQL` statement-by-statement (one-statement-per-exec is a workaround for `execAsync` being unreliable with multi-statement payloads on some devices).
3. `runSchemaMigrations(client)` — idempotent column adds.
4. `runHashMigration(client, sha256)` — one-shot v1→v2 upgrade of existing signatures (see "Signatures" below).

`__tests__/setup.ts` deliberately calls `runSchemaMigrations()` on the already-correct canonical schema so any drift between `schema.ts` and `migrations.ts` fails a test. `createLegacyTestClient()` exists for exercising pre-cloud-column schema states.

### Services (`src/services/`)

Pure functions taking a `DbClient` (and, for cloud services, a `CloudClient` + `FileSystemAbstraction` + `HashFn` + clock). Each file exports a factory function, not a class.

- `profileService.ts` — `createProfile`, `getProfile`, `updateProfile`, `updateLastBackupAt`.
- `entriesService.ts` — CRUD for entries plus `createAmendment`, `getTotalWorkHours`, `getAmendmentForEntry`, `getOriginalEntry`, `getLifetimeHoursByLevel`.
- `signingService.ts` — `signEntry`, `verifyIntegrity`, `getSignatureForEntry`, `getAllSignatures`, `computeEntryHashForVersion`.
- `exportService.ts` — `exportAsJson`, `exportAsPdf`; used directly by ProfileScreen and by `cloudBackupService` to compose snapshots.
- `backupService.ts` — reminder and cert-expiry logic only (pure, no DB). Not related to cloud backup despite the name; `cloudBackupService` is the cloud counterpart.
- `authService.ts` — thin façade over `CloudClient` for auth flows (`signInWithMagicLink`, `signInWithProvider`, `signOut`, `getSession`, `onAuthStateChange`, `deleteAccount`). Exists so UI never imports `CloudClient` directly.
- `cloudBackupService.ts` — `backup()`, `getLastBackupStatus()`. See "Cloud backup" below.
- `restoreService.ts` — `previewCloudState()`, `restore()`, `uploadCurrentAsCloud()`. See "Cloud backup" below.
- `supervisorConnectionsService.ts` — `inviteSupervisor`, `acceptInvite`, `declineInvite`, `revokeConnection`, `searchDirectory`, `syncConnections`. See "Supervisor accounts" below.
- `signRequestsService.ts` — `sendSignRequest`, `withdrawRequest`, `declineRequest`, `signRequest`, `applyIncomingSignature`, `syncSignRequests`. See "Supervisor accounts" below.

Invariants the service layer enforces (these are contract, not convention):

- Signed entries are immutable. `entriesService.updateEntry` and `deleteEntry` both throw on `status === 'signed'`. The UI gates signed entries but the service is the authority.
- Editing a signed entry goes through `entriesService.createAmendment`, which creates a new draft with `amends_entry_id` set. Both the original and the amendment remain in the logbook forever; the original's status flips to `amended` only when the amendment itself is signed.
- Canonical serialization in `utils/canonical.ts` sorts keys recursively, collapses runs of whitespace inside strings, and drops `created_at`/`updated_at` before JSON-stringifying. This is what gets hashed at signing time.
- `tech_level_snapshot` on an entry is set once at creation and never updated — it records the tech's SPRAT level at the time the work was done, independent of any later level change on the profile.
- **Signatures are content-hashed**. `signingService` dispatches on the `hash_version` column: v1 (`entryRowToHashInputV1`) is **frozen** — it hashes the raw absolute `photo_paths` exactly as written by the earliest code. v2 (`entryRowToHashInputV2`) parses `photo_paths` JSON, runs each path through `normalizeAppPath()`, and hashes the relative result so hashes survive reinstalls and cross-device restore. `CURRENT_HASH_VERSION = 2`; all new signatures write v2. `verifyIntegrity` dispatches on the stored `hash_version` so v1 rows keep verifying with the v1 algorithm forever. The v1→v2 migration (`db/hashMigration.ts`) runs on every boot but only upgrades rows whose v1 hash still verifies on the current device; rows whose v1 verification already fails stay at v1 with their failing hash so the integrity banner in `EntryDetailScreen` continues to surface them as tampered.

### UI (`src/primitives/`, `screens/`, `components/`, `navigation/`, `theme/`, `hooks/`)

Screens compose from the fixed primitive set in `src/primitives/index.ts` (`Screen`, `Button`, `IconButton`, `Input`, `Textarea`, `Card`, `Badge`, `Banner`, `Chip`, `ListRow`, `EmptyState`). Primitives read tokens from `theme/ThemeProvider`'s `useTheme()` hook. Screens should not define their own style sheets for anything a primitive already covers.

Design tokens (`theme/tokens.ts`): spacing base 4px with an `xs|sm|md|base|lg|xl|xxl` scale, safety-orange `#FF6600` accent (primary CTAs, focus rings), SPRAT-navy `#003366` chrome (tab bar, headers), IRATA-red `#C8102E` for errors and amendments, Steel Gray `#4A4A4A` body text, Concrete Light `#F2F2F2` background. Touch targets: 48px minimum, 56px preferred — glove use is assumed. Typography is System-font-based with explicit `h1/h2/body/bodyBold/bodySmall/caption/mono` variants; `display` is the onboarding hero size.

React Query hooks in `src/hooks/` wrap service calls: `useProfile`, `useEntries`, `useSignatures`, `useBackupReminder` (local reminders), `useAuthSession`, `useBackup`, `useBackupStatus`, `useRestore`, `useSupervisorConnections`, `useSupervisorSearch`, `useSignRequests`. `useSignEntry` accepts an optional `afterSign` callback — `SignatureScreen` passes `() => backup.mutate()` to trigger a cloud backup as a post-sign side effect without any event-bus indirection.

Composite `src/components/` are wider than a primitive but narrower than a screen — currently `ProfileCloudSection` and `DeleteAccountModal`, both mounted inside `ProfileScreen`.

## Navigation

`src/navigation/RootNavigator.tsx` owns a single `NavigationContainer` with a native-stack of gated branches. If `useProfile()` returns no profile, the Onboarding branch is shown (Onboarding + Auth + MagicLinkWait screens). Once a profile exists and an authenticated session is present, the cloud-state preview runs; if `preview.data.backup_id !== backupStatus.last_uploaded_backup_id` and both local and cloud have data, the CloudConflict branch is the sole route until resolved (Scenario C). Otherwise the Main branch is rendered with bottom tabs (Logbook, Profile) plus stack screens for EntryForm, EntryDetail, Signature, Auth, and MagicLinkWait.

All three cloud-related screens (`AuthScreen`, `MagicLinkWaitScreen`, `CloudConflictScreen`) are registered in the stack. `AuthScreen` and `MagicLinkWaitScreen` opt into header display with titles; the rest of the stack runs with `headerShown: false`. The top-level headerless default is a known UX gap captured in the entry-logging enhancements spec — several screens have no visible back chevron and no cue that iOS edge-swipe-back is available.

`App.tsx` bootstraps: the `react-native-url-polyfill/auto` import sits above every other import (it must load before `@supabase/supabase-js` pulls in `URL`). After `initializeDatabase()` succeeds, an `AppState` listener fires a best-effort cloud backup on every transition to `background`, and an `expo-linking` listener consumes `logbook://auth-callback` URLs for magic-link completion.

## Cloud backup

Supabase hosts Auth + Storage only — no Postgres tables are used. The single private bucket `logbook-backups` is RLS-gated by `(storage.foldername(name))[1] = auth.uid()::text`, provisioned via `supabase/migrations/20260416_storage_bucket_and_rls.sql`. The only server-side code is the `delete-account` Edge Function (`supabase/functions/delete-account/index.ts`), which runs with service-role privileges and derives the caller's `user_id` from the request JWT — never accepts it as a parameter.

Config is read from `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars via `app.config.ts`'s `extra` block; `src/config.ts::getConfig()` throws if either is missing. The service-role key lives only in deployed Edge Function secrets, never in the client bundle.

`src/cloud/cloudClient.ts` defines the `CloudClient` interface (auth, storage, edge functions, `isOnline`). `src/cloud/supabaseClient.ts` is the runtime implementation using `@supabase/supabase-js` with AsyncStorage session persistence, PKCE flow, and `expo-auth-session` + `expo-web-browser` for OAuth. `__tests__/cloudMock.ts`'s `createMockCloudClient()` is the in-memory test double with configurable offline/quota/fail-upload simulation. `src/cloud/fsAbstraction.ts` plays the same role for file I/O — runtime wraps `expo-file-system/legacy`, tests use `__tests__/fsMock.ts`.

### Storage layout per user

```
{uid}/snapshot.json                       single CloudSnapshot, replaced each backup
{uid}/assets/sig_{signature_id}.png
{uid}/assets/spratcard_{profile_id}.{ext}
{uid}/assets/photo_{entry_id}_{index}.{ext}
```

Asset filenames are content-keyed to their owning DB row, decoupling cloud storage from device-local paths. Photos are gated behind `profile.photos_in_backup` (defaults OFF — paper logbooks don't carry photos).

### Snapshot shape

`CloudSnapshot` in `src/types.ts` extends `JsonBackup` with `cloud_schema_version: 1`, `backup_id`, `binary_manifest`, `photos_included`. Every path column inside the snapshot (`entries.photo_paths`, `signatures.signature_png_path`, `profile.sprat_card_photo_path`) is stored **relative**, normalized via `normalizeAppPath()` before upload. `binary_manifest` keys are Storage paths (e.g. `assets/sig_abc123.png`) and carry `sha256`, `size_bytes`, `created_at` for integrity checks on restore.

### Backup triggers and semantics

Three triggers fire `cloudBackupService.backup()`: post-sign (`useSignEntry` `afterSign` callback in `SignatureScreen`), `AppState` → `background` (in `App.tsx`), and the manual "Back up now" button in `ProfileCloudSection`. Inside the service:

- **Throttle**: 30 seconds; a repeat trigger within the window is a no-op unless the signatures count has changed.
- **Mutex**: in-memory `inFlight` promise coalesces concurrent triggers. No queue — the next trigger after completion sees the latest state.
- **Delta upload**: the previous manifest is cached in AsyncStorage (`logbook:last_uploaded_manifest`). Assets are uploaded only when their sha256 differs from the cached entry.
- **Orphan cleanup**: keys present in the cached manifest but absent from the new manifest are deleted from Storage — this is how the photos-toggle off→on path backfills and the on→off path cleans up.
- **Atomicity**: `snapshot.json` uploads last, after every referenced asset exists. If any earlier step fails, the previous snapshot still references existing assets — a broken reference is never committed to Storage. On next trigger, remaining deltas and the snapshot retry.
- On success, `profile.last_cloud_backup_at` and `profile.last_uploaded_backup_id` are updated in the local DB.

### Restore semantics

`restoreService.restore()` refuses to proceed if `snap.cloud_schema_version > MAX_CLOUD_SCHEMA_VERSION` or `snap.schema_version > MAX_DB_SCHEMA_VERSION` (both currently 1) with a `version_too_new` result — local DB is untouched. Assets are downloaded one by one with sha256 verification; mismatches are quarantined (deleted locally) and listed in `assets_failed`, while the rest of the restore proceeds. Affected entries show a "Signature image missing" banner on `EntryDetailScreen`, but hashes still verify because the hash is over entry content, not the PNG bytes. DB rows are written inside a single transaction that first `DELETE`s everything locally — restore is whole-logbook replacement, not merge. Path columns are rewritten with the new device's absolute paths via `rehydrateAppPath()` before insertion.

`restoreService.uploadCurrentAsCloud()` implements Scenario C "replace cloud": it `deletePrefix('{uid}/')` and clears the manifest cache. Callers (`CloudConflictScreen`) are expected to trigger a fresh `useBackup()` immediately after.

### Conflict scenarios

Detection happens in `RootNavigator` using `useAuthSession`, `useCloudStatePreview`, `useEntries`, and `useBackupStatus`. Three scenarios:

- **A — local has data, cloud empty**: upload the current state. No UI friction.
- **B — local empty, cloud has data**: download and rebuild the local DB. Presented as a restore prompt.
- **C — both have data, `last_uploaded_backup_id != cloud.backup_id`** (or `last_uploaded_backup_id` is null): `CloudConflictScreen` blocks all other navigation until the user picks "Keep cloud, replace this device" or "Replace cloud with this device." No merge is offered — signed entries are immutable so merging is meaningless.

## Supervisor accounts

One account type. Every user has a profile and a logbook; any Level III tech can opt into the "I supervise others" capability via the toggle in `ProfileScreen`'s `SupervisorsSection`. Opting in requires a supervisor cert number and publishes a row to the searchable supervisor directory; opting out tombstones the directory row and fails any in-flight inbound requests. Remote signing flips the signer: the supervisor signs on their own device, the tech's local entry is updated via `applyIncomingSignature`.

Unlike cloud backup, this feature uses Postgres. Three tables in Supabase — the first server-side relational state in the project — provisioned by `supabase/migrations/20260418_supervisor_accounts.sql`:

- `supervisor_connections` — tech↔supervisor pair, status `pending | accepted | declined | revoked`. RLS: both parties can read, only the initiating tech can insert, either party can update the status column per side-specific rules.
- `sign_requests` — one entry awaiting a remote signature, carries a snapshot of entry content so the supervisor can review without the tech's DB. Status `pending | signed | declined | withdrawn | expired`. RLS: both parties can read; tech inserts; supervisor signs/declines; tech withdraws.
- `supervisor_directory` — opt-in search surface. RLS: any authenticated user can SELECT visible rows; only owner can upsert/delete their own row.

A second Storage bucket `sign-requests` holds request-scoped assets (signature PNG after signing, entry photos attached to the request). RLS joins against `sign_requests` so only the two parties to a given request can read/write under `{request_id}/`. Provisioned in the same migration.

### Services

Both factory-pattern, pure functions over `DbClient + CloudClient + FileSystemAbstraction + HashFn + clock`:

- `supervisorConnectionsService.ts` — `inviteSupervisor`, `acceptInvite`, `declineInvite`, `revokeConnection`, `searchDirectory`, `syncConnections`. Directory search hits the cloud; everything else mutates Postgres and mirrors into the local cache.
- `signRequestsService.ts` — `sendSignRequest`, `withdrawRequest`, `declineRequest`, `signRequest`, `applyIncomingSignature`, `syncSignRequests`. `applyIncomingSignature` is the tech-side counterpart: fetches a signed request, downloads the signature PNG from the `sign-requests` bucket to local storage, and writes the local `signatures` row.

`utils/entryPayloadHash.ts::computeEntryHashFromPayload` mirrors `entryRowToHashInputV3` for hashing entries from the remote-signing payload rather than a local row. **It forces `status: 'signed'` on the hash input because `verifyIntegrity` rehashes the local row *after* `applyIncomingSignature` flips status to 'signed'** — without this forcing, every remote-signed entry would appear tampered on the tech's device.

### Hooks and UI

React Query hooks: `useSupervisorConnections`, `useSupervisorSearch`, `useSignRequests`. New screens: `InboxScreen` (pending invites + incoming sign requests; conditionally added as a bottom tab only when the user has supervisor capability enabled), `SignRequestDetailScreen` (supervisor-side review + sign), `SupervisorSearchScreen` (tech-side directory search). `ProfileScreen` gained `SupervisorsSection`. `EntryForm`, `EntryDetail`, and `LogbookScreen` gained send-for-signature surfaces plus pending/declined/awaiting status chips and banners.

### Local SQLite deltas

Two new cache tables: `supervisor_connections_cache` and `sign_requests_cache` — mirrors of the authoritative Postgres state, consulted by list screens for offline-read. New profile columns: `supervisor_capability_enabled`, `supervisor_cert_number`, `supervisor_directory_visible`. New entries column: `pending_sign_request_id` (partial index: `WHERE pending_sign_request_id IS NOT NULL`). All added idempotently via `runSchemaMigrations`.

### Invariants

- **Entry lock**: an entry with `pending_sign_request_id != null` is read-only. `entriesService.updateEntry` and `deleteEntry` both throw. Withdrawing or declining the request clears the lock.
- **Sign-request insert ordering (real Supabase)**: `sendSignRequest` generates a UUID client-side, INSERTs the `sign_requests` row **first** (so the Storage RLS join against `sign_requests.id` resolves), **then** uploads assets under `{request_id}/`. The mock reverses this for test simplicity — do not take the mock ordering as authoritative.
- **Realtime**: `subscribeConnections` and `subscribeSignRequests` use Supabase Realtime against the supervisor tables (added to the `supabase_realtime` publication in the migration). The mock fires sync callbacks synchronously.
- **Offline**: supervisor-accounts **writes require online** and fail fast with a "connection required" banner. Reads serve from the SQLite cache.

## Testing

The suite currently has **17 test files / 132 tests** (`__tests__/services/` × 12, `__tests__/db/` × 3, `__tests__/utils/` × 2). Real SQLite via `better-sqlite3` in-memory — not mocks — through `createTestClient()`. Every test exercises `runSchemaMigrations()` against the canonical schema so any drift between `schema.ts` and `migrations.ts` fails a test. `__tests__/testHash.ts` mirrors `expo-crypto`'s SHA-256 using Node's `crypto` module so hashes match between tests and production.

Cloud tests use `createMockCloudClient()` + `createMockFs()`. The jest config (`jest.config.js`) uses the `jest-expo` preset and `transformIgnorePatterns` tuned to leave RN / Expo packages untransformed. Individual service test files mock `expo-file-system/legacy` with a stable `documentDirectory` (see the top of `signingService.test.ts`) so `normalizeAppPath` behaves deterministically; `@react-native-async-storage/async-storage` is mocked with an in-memory map as part of the jest-expo preset.

What isn't in unit tests: real Supabase network round-trips, real OAuth flows, real deep-link resolution, real Edge Function invocation. These are manual QA work against a dev Supabase project.

## File storage convention

All persistent images live under `FileSystem.documentDirectory/logbook/` with subdirs `photos/`, `signatures/`, `cards/` (`src/utils/fileStorage.ts`). The DB stores absolute paths for runtime use; the cloud snapshot stores normalized relative paths; `restoreService` rehydrates to absolute on restore. Camera-roll URIs and `content://` URIs are never persisted — `copyPhotoToAppStorage` / `saveSignaturePng` / `saveCardPhoto` always copy into the logbook directory first.

## Key domain concepts

- **Entry statuses**: `draft` (editable), `signed` (immutable, has signature and hash), `amended` (original that has a signed amendment).
- **Amendment chain**: amending a signed entry creates a new draft with `amends_entry_id`. Both entries stay in the logbook. The original flips to `amended` once the amendment itself is signed; while the amendment is still a draft it can be deleted, unlocking the original.
- **Tamper detection**: SHA-256 over canonical entry content, stored in `signatures.entry_hash` with a `hash_version`. Re-verified on `EntryDetailScreen` load. Same trust model as paper — not cryptographic non-repudiation. Keypair signing is in "Not yet implemented" below.
- **Backup reminders**: `profile.last_backup_at` tracks the last *local* export (JSON/PDF); cloud backup state is separate on `profile.last_cloud_backup_at`. A banner shows if >30 days since last local export; a toast nudges post-sign if >7 days stale.
- **`photos_in_backup`**: opt-in toggle on profile, defaults OFF. Toggling on backfills on next backup; toggling off orphan-cleans previously-uploaded photos on next backup.
- **`last_uploaded_backup_id`**: the `backup_id` from the last snapshot this device uploaded. Scenario C detection compares it to the cloud snapshot's `backup_id`; a mismatch (or null) means the cloud has data this device never produced.
- **Work types**: fixed set in `types.ts` — `inspection`, `ndt`, `welding`, `painting`, `window_cleaning`, `rescue`, `training`, `rigging`, `other`.

## Known state

- `npx tsc --noEmit` is clean. `supabase/` is excluded from the app's tsconfig — the `delete-account` Edge Function is Deno code (URL imports, `Deno` global) and doesn't participate in the app type check.
- `npx jest` is clean: 132 passed, 17 suites (run with `--runInBand` if you see flakes from parallel mock-cloud state).

## Not yet implemented

These features are part of this app's scope but not yet built. They are not deferred sub-projects or future add-ons — they are unfinished pieces of the same product. Requests to build any of them are in-scope work, not scope bumps.

- **Cryptographic keypair signing** — true non-repudiation (per-user or per-signature keypairs), replacing the current SHA-256 content-hash trust model. Paired device attestation is likely.
- **Live multi-device sync** — continuous sync rather than the current triggered snapshot backup. Concurrent edits on two devices currently produce Scenario C and require explicit resolution.
- **Org / company accounts with admin roles** — multi-user tenant model, admin dashboards, org-scoped policy.
- **Dark mode** — full themed dark variant.
- **Saved entry templates** — reusable entry presets for common work patterns.
