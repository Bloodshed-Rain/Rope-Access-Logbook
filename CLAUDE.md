# CLAUDE.md

This file orients Claude Code sessions working in this repository. Read it first; then read the specific file your task touches.

## Project

Rope Access Logbook is an offline-first iOS + Android app for SPRAT- and IRATA-certified rope access technicians. It replaces the paper work-experience logbook that techs carry to every job site: entries with hours and work descriptions, on-screen supervisor signatures captured at the end of each shift, and a PDF export suitable for re-certification audits. The app is a paid product distributed behind a $2.99/month subscription with a 7-day free trial; trial entry happens in onboarding via RevenueCat.

The app is one product being built incrementally. Do not describe the codebase as "MVP plus add-ons" or as a sequence of phases or sub-projects — that framing is planning-internal and the user has rejected it. When describing state, use plain "currently implemented" vs. "not yet implemented" language. The "Not yet implemented" section at the bottom of this file enumerates what's in scope but unbuilt.

Primary design references:

- Core app design: `docs/superpowers/specs/2026-04-15-rope-access-logbook-design.md` (referenced by later specs; check for presence before relying on it — it may not be in the repo).
- Cloud backup and restore: `docs/superpowers/specs/2026-04-16-cloud-backup-and-restore-design.md`. Section 4 (path normalization + v1→v2 hash migration) and section 6.3 (conflict scenarios A/B/C) are load-bearing.
- Implementation plan history: `docs/superpowers/plans/2026-04-16-cloud-backup-and-restore.md`. The spec is canonical; the plan is history.
- **Light-theme redesign + paid-app pivot (current)**: `docs/superpowers/specs/2026-04-30-light-theme-redesign-design.md`. Cream + deep-red light theme, Inter typography, Today/Records/Me tab structure, role-fork onboarding, four-state subscription with lapse-driven read-only mode, in-app notification center.
- UI/UX overhaul + dual-cert: `docs/superpowers/specs/2026-04-25-ui-overhaul-industrial-design.md` — **superseded** by the 2026-04-30 spec above. Kept for historical context on the prior industrial dark-theme aesthetic; do not use as the canonical UI reference.
- Entry-logging enhancements: `docs/superpowers/specs/2026-04-17-entry-logging-enhancements-design.md`.

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

Supabase provisioning (dev and prod project setup, runbook in `supabase/README.md`):

```bash
supabase db push --db-url postgres://...     # applies supabase/migrations/*.sql
supabase functions deploy delete-account          --no-verify-jwt
supabase functions deploy cleanup-request-assets  --no-verify-jwt
supabase functions deploy notify-sign-request     --no-verify-jwt
supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
```

`invite-supervisor` and `search-supervisors` also live under `supabase/functions/` but are invoked from the client with a normal JWT; deploy them the same way if you add or modify them. `--no-verify-jwt` on the three above is because each verifies the caller manually inside its handler.

`.env` at repo root supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `app.config.ts`; the app throws on missing config at `getConfig()` call time (`src/config.ts`). The app is fully usable offline without valid Supabase credentials until the user signs in.

## Architecture — three-layer structure

### Persistence (`src/db/`)

The `DbClient` interface in `client.ts` is the only DB abstraction. It exposes `run`, `get`, `getAll`, `exec` against parameterized SQL. The runtime implementation (`expoClient.ts`) wraps `expo-sqlite` and is instantiated by `initialize.ts`; tests use `better-sqlite3` in-memory via `__tests__/setup.ts`'s `createTestClient()`. Schema lives in `schema.ts` — six tables (`profile`, `entries`, `signatures`, `supervisor_connections_cache`, `sign_requests_cache`, `notifications`) plus indexes. New columns are added idempotently by `migrations.ts` via guarded `PRAGMA table_info` + `ALTER TABLE`; the profile table currently carries `photos_in_backup`, `last_cloud_backup_at`, `last_uploaded_backup_id`, `supervisor_capability_enabled`, `supervisor_cert_number`, `supervisor_directory_visible`, `subscription_status`; the entries table carries `pending_sign_request_id` (with a partial index); the signatures table carries `hash_version`.

Two migrations landed in the light-theme redesign (A1) and are guarded for idempotency:

- **`subscription_tier` → `subscription_status`**: legacy column (values `'free' | 'pro'`) is renamed to `subscription_status` (values `'unknown' | 'trialing' | 'active' | 'lapsed'`); pro-tier rows map to `'active'`, everything else to `'unknown'`. The old column is dropped in the same step — the app is pre-launch so there are no production rows to preserve.
- **`notifications` table**: added with `id, kind, payload_json, created_at, read_at, dismissed_at` and a partial index `idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL` for fast unread-count queries. See "Notifications" section below.

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
- `subscriptionService.ts` — `init`, `getStatus`, `getPackages`, `purchase`, `restore`. RevenueCat wrapper that resolves to `'unknown' | 'trialing' | 'active' | 'lapsed'` and mirrors the status into `profile.subscription_status` for offline reads. See "Subscriptions" below.
- `notificationCenterService.ts` — `record`, `list`, `unreadCount`, `markAllRead`, `dismiss`. Local-only notification store backed by the `notifications` table; not synced to the cloud. See "Notifications" below.

Invariants the service layer enforces (these are contract, not convention):

- Signed entries are immutable. `entriesService.updateEntry` and `deleteEntry` both throw on `status === 'signed'`. The UI gates signed entries but the service is the authority.
- Editing a signed entry goes through `entriesService.createAmendment`, which creates a new draft with `amends_entry_id` set. Both the original and the amendment remain in the logbook forever; the original's status flips to `amended` only when the amendment itself is signed.
- Canonical serialization in `utils/canonical.ts` sorts keys recursively, collapses runs of whitespace inside strings, and drops `created_at`/`updated_at` before JSON-stringifying. This is what gets hashed at signing time.
- `tech_level_snapshot` on an entry is set once at creation and never updated — it records the tech's SPRAT level at the time the work was done, independent of any later level change on the profile.
- **Signatures are content-hashed**. `signingService` dispatches on the `hash_version` column: v1 (`entryRowToHashInputV1`) is **frozen** — it hashes the raw absolute `photo_paths` exactly as written by the earliest code. v2 (`entryRowToHashInputV2`) parses `photo_paths` JSON, runs each path through `normalizeAppPath()`, and hashes the relative result so hashes survive reinstalls and cross-device restore. `CURRENT_HASH_VERSION = 2`; all new signatures write v2. `verifyIntegrity` dispatches on the stored `hash_version` so v1 rows keep verifying with the v1 algorithm forever. The v1→v2 migration (`db/hashMigration.ts`) runs on every boot but only upgrades rows whose v1 hash still verifies on the current device; rows whose v1 verification already fails stay at v1 with their failing hash so the integrity banner in `EntryDetailScreen` continues to surface them as tampered.

### UI (`src/primitives/`, `screens/`, `components/`, `navigation/`, `theme/`, `hooks/`)

Screens compose from the primitive set exported by `src/primitives/index.ts`. Existing primitives: `Screen`, `Button`, `IconButton`, `Input`, `Textarea`, `Card`, `Badge`, `Banner`, `Chip`, `ListRow`, `EmptyState`, `ProgressBar`, `SectionHeader`, `LoadingSpinner`, `Toast` (`ToastProvider` + `useToast`). Light-theme primitives (built in B3, promoted to the main set in F2): `StatusPill`, `FilterChips`, `SegmentedControl`, `Sheet`, `CenterModal`, `ChecklistRow`, `MultiSelectListRow`, `StatCard`, `AvatarUpload`, `SubscriptionStrip`. Primitives read tokens from `theme/ThemeProvider`'s `useTheme()` hook. Screens should not define their own style sheets for anything a primitive already covers.

Design tokens (`theme/tokens.ts`): **light theme — cream background, deep red CTAs, Inter typography.** Surface scale `bgApp #FAF7F2` (warm cream root), `bgSurface #FFFFFF` (cards/sheets), `bgMuted #F5F2ED` (insets, disabled fills); ink scale `inkPrimary` near-black on cream → `inkSecondary` → `inkTertiary` → `inkDisabled`. Accent **deep red** `accentPrimary #B71C1C` for primary CTAs, focus rings, and the lapsed-subscription strip. Status: `statusOk #16A34A` (signed, sync OK), `statusWarn #F59E0B` (pending, cert nearing expiry), `statusErr #DC2626` (lapsed, amendments, missing), `statusInfo #2563EB`. Cert level chips: `certL1` blue, `certL2` amber, `certL3` green. Spacing base 4px. Touch targets: 44pt minimum (Apple HIG). Typography is **Inter only** (JetBrains Mono and Michroma were retired in B2/F1) with roles `title1`, `title2`, `body`, `bodyMed`, `label`, `caption`. There are no legacy industrial aliases — F2 dropped them.

React Query hooks in `src/hooks/` wrap service calls: `useProfile`, `useEntries`, `useSignatures`, `useBackupReminder` (local reminders), `useAuthSession`, `useBackup`, `useBackupStatus`, `useRestore`, `useSupervisorConnections`, `useSupervisorSearch`, `useSignRequests`, `useSubscriptionStatus` / `useSubscriptionPackages` / `usePurchasePackage` / `useRestorePurchases`, `useReadOnly` (lapse gate — see "Subscriptions" below), `useNotificationCenter`, `useNotifications` (push handler). `useSignEntry` accepts an optional `afterSign` callback — `SignatureScreen` passes `() => backup.mutate()` to trigger a cloud backup as a post-sign side effect without any event-bus indirection.

Composite `src/components/` are wider than a primitive but narrower than a screen — currently `ProfileCloudSection`, `DeleteAccountModal`, and `SupervisorsSection`, all mounted inside `MeScreen`.

## Navigation

`src/navigation/RootNavigator.tsx` owns a single `NavigationContainer` with a native-stack of gated branches. If `useProfile()` returns no profile, the Onboarding branch is shown (the multi-step `OnboardingScreen` + Auth + MagicLinkWait screens — see "Onboarding" below). Once a profile exists and an authenticated session is present, the cloud-state preview runs; if `preview.data.backup_id !== backupStatus.last_uploaded_backup_id` and both local and cloud have data, the CloudConflict branch is the sole route until resolved (Scenario C). Otherwise the Main branch is rendered with bottom tabs — **Today** (primary), **Records**, **Me**, and **Inbox** (conditionally when supervisor capability is on) — plus stack screens for EntryForm, EntryDetail, Signature, Auth, MagicLinkWait, SupervisorSearch, SignRequestDetail, SupervisorsList, Notifications, SendSignRequest, and the modal sheets PostSaveSheet, SignatureOptionsSheet, and Paywall.

Tab mapping vs. previous structure: **Today** replaces the old Dashboard (work breakdown, year-over-year stats, cert progress all live here), **Records** replaces the old `LogbookScreen` / `LogbookList` (the standalone `LogbookList` stack route was removed in C2), **Me** replaces the old `ProfileScreen`. The standalone `AnalyticsScreen` and `DashboardScreen` are gone; their content was absorbed into Today and Me.

Cloud-related screens (`AuthScreen`, `MagicLinkWaitScreen`, `CloudConflictScreen`) are registered in the stack. The default stack header uses light-theme chrome (`bgSurface` background, `inkPrimary` Inter title, hairline divider). Individual screens opt out via `headerShown: false`.

`App.tsx` bootstraps in this order:

1. `react-native-url-polyfill/auto` sits above every other import (it must load before `@supabase/supabase-js` pulls in `URL`).
2. `initializeDatabase()` runs; while it's running a `LoadingSpinner` is shown.
3. On DB-ready, `createSubscriptionService(db).init()` configures RevenueCat with the platform-appropriate key from `app.config.ts`'s `extra` block.
4. The same effect bridges Supabase identity into RevenueCat: a one-shot `cloud.getSession()` for cold-boot session restore plus a live `cloud.onAuthStateChange` subscription. Both call `subscriptionService.identify(user_id)` on a present session and `subscriptionService.signOut()` on a null session, then invalidate the React Query `subscriptionStatus` cache so screens re-read.
5. An `AppState` listener is attached: `background` fires a best-effort `cloudBackupService.backup()`; `active` fires best-effort `supervisorConnectionsService.sync()` + `signRequestsService.sync()` so invites and incoming sign requests catch up after the app returns from the background.
6. An `expo-linking` listener consumes `logbook://auth-callback` URLs for magic-link completion.

## Cloud backup

The cloud-backup feature itself uses only Auth + Storage — no Postgres tables. (Postgres is used elsewhere in the project: supervisor accounts, `push_tokens`, pg_cron housekeeping. See those sections.) The single private bucket `logbook-backups` is RLS-gated by `(storage.foldername(name))[1] = auth.uid()::text`, provisioned via `supabase/migrations/20260416_storage_bucket_and_rls.sql`. The `delete-account` Edge Function (`supabase/functions/delete-account/index.ts`) runs with service-role privileges and derives the caller's `user_id` from the request JWT — never accepts it as a parameter.

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

One account type. Every user has a profile and a logbook; any Level III tech can opt into the "I supervise others" capability via the toggle in `MeScreen`'s `SupervisorsSection`. Opting in requires a supervisor cert number and publishes a row to the searchable supervisor directory; opting out tombstones the directory row and fails any in-flight inbound requests. Remote signing flips the signer: the supervisor signs on their own device, the tech's local entry is updated via `applyIncomingSignature`.

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

React Query hooks: `useSupervisorConnections`, `useSupervisorSearch`, `useSignRequests`. New screens: `InboxScreen` (pending invites + incoming sign requests; conditionally added as a bottom tab only when the user has supervisor capability enabled), `SignRequestDetailScreen` (supervisor-side review + sign), `SupervisorSearchScreen` (tech-side directory search). `MeScreen` gained `SupervisorsSection`. `EntryFormScreen`, `EntryDetailScreen`, and `RecordsScreen` gained send-for-signature surfaces plus pending/declined/awaiting status chips and banners.

### Local SQLite deltas

Two new cache tables: `supervisor_connections_cache` and `sign_requests_cache` — mirrors of the authoritative Postgres state, consulted by list screens for offline-read. New profile columns: `supervisor_capability_enabled`, `supervisor_cert_number`, `supervisor_directory_visible`. New entries column: `pending_sign_request_id` (partial index: `WHERE pending_sign_request_id IS NOT NULL`). All added idempotently via `runSchemaMigrations`.

### Invariants

- **Entry lock**: an entry with `pending_sign_request_id != null` is read-only. `entriesService.updateEntry` and `deleteEntry` both throw. Withdrawing or declining the request clears the lock.
- **Sign-request insert ordering (real Supabase)**: `sendSignRequest` generates a UUID client-side, INSERTs the `sign_requests` row **first** (so the Storage RLS join against `sign_requests.id` resolves), **then** uploads assets under `{request_id}/`. The mock reverses this for test simplicity — do not take the mock ordering as authoritative.
- **Realtime**: `subscribeConnections` and `subscribeSignRequests` use Supabase Realtime against the supervisor tables (added to the `supabase_realtime` publication in the migration). The mock fires sync callbacks synchronously.
- **Offline**: supervisor-accounts **writes require online** and fail fast with a "connection required" banner. Reads serve from the SQLite cache.

## Push notifications

Remote push is dispatched **from the device that performed the mutation**, not from a Postgres trigger. This was a deliberate change (`refactor(notifications): dispatch from client instead of DB trigger`) — no `pg_net`, no `ALTER DATABASE` config, no `after insert` triggers.

Wiring:

- `push_tokens` table (`supabase/migrations/20260420_push_tokens.sql`) stores per-user Expo push tokens. The client registers its token on login via `CloudClient.registerPushToken`.
- Every mutation in `signRequestsService` (send / withdraw / decline / sign) calls `cloud.notifySignRequest(type, record, oldRecord)` after the underlying Postgres write succeeds.
- `notifySignRequest` in `supabaseClient.ts` invokes the `notify-sign-request` Edge Function with the caller's authenticated session.
- The Edge Function (`supabase/functions/notify-sign-request/index.ts`) verifies the JWT, re-reads the `sign_requests` row with the service-role key, confirms the caller is a party to it, resolves the *other* party's push token from `push_tokens`, and POSTs to `https://exp.host/--/api/v2/push/send`.
- A failed `notifySignRequest` never fails the underlying sign-request mutation — it's fire-and-forget from the service's perspective.

Local notifications (cert expiry at 60 days and at-expiry, plus the supervisor-side "new request" tap target) go through `expo-notifications` and don't touch Supabase.

## Subscriptions

The app is paid: $2.99/month with a 7-day free trial, dispatched via RevenueCat. Onboarding ends at a `SubscribeStep` that starts the trial; there is no skip. `subscriptionService.ts` wraps `react-native-purchases` and resolves the user to one of four states — `'unknown' | 'trialing' | 'active' | 'lapsed'` — based on the `pro` entitlement (`ENTITLEMENT_ID = 'pro'`). Keys live in `app.config.ts`'s `extra` as `revenueCatAppleKey` / `revenueCatGoogleKey`, fed from `.env` at build time; `init()` picks the right one per platform and warns if absent. `getStatus()` falls back to `profile.subscription_status` on offline / RevenueCat failures, which is how status gating survives without network — every resolution writes the value back into `profile.subscription_status`. Dev/test currently uses RC's Test Store key (one `test_…` value pasted into both env vars); real `appl_` / `goog_` platform keys swap in once App Store Connect / Play Console products are wired. The full dashboard + per-store setup runbook is `docs/runbooks/revenuecat.md`. State semantics:

- **`unknown`** — pre-resolution / offline-with-no-prior-state. Read-only by default until resolution succeeds.
- **`trialing`** — entitlement active, customer info indicates a trial period. Full app access.
- **`active`** — entitlement active, paid period. Full app access.
- **`lapsed`** — entitlement was previously granted but is no longer active. Read-only mode (see below).

**Lapse semantics** — when `subscription_status === 'lapsed'`, the app enters **read-only mode**. The logbook is fully viewable; PDF and JSON export still work (Apple HIG / store policy: users keep access to their content). All write paths are blocked: Add Work CTA, Sign actions, Send-for-Signature, "Back up now," supervisor-mutation flows. The Paywall is re-presentable as a full-screen modal on next launch and on attempted writes. The `useReadOnly()` hook in `src/hooks/useSubscription.ts` returns a boolean derived from `useSubscriptionStatus()`; screens consume it to disable CTAs and show a "Subscription lapsed — renew to continue" banner. Treat `useReadOnly() === true` as the single authority for write-gating in the UI; services don't enforce this gate themselves (it lives in the UI layer because lapse is a user-experience concern, not a data invariant).

Surfaces:

- `PaywallScreen` is registered as a modal in the root stack and presents RevenueCat's packages with a Restore button.
- `MeScreen`'s `SubscriptionStrip` primitive renders state-specific copy — "Free trial · {N} days left" + manage link for trialing, "Logbook Pro · renews {date}" + manage link for active, a red "Subscription lapsed" strip with Renew CTA for lapsed.
- `ProfileCloudSection` continues to surface cloud-backup status alongside subscription state.
- Search by name (as opposed to cert number) in `SupervisorSearchScreen` remains a paid feature; non-subscribers route to Paywall.

Hooks in `src/hooks/useSubscription.ts`: `useSubscriptionStatus`, `useSubscriptionPackages`, `usePurchasePackage`, `useRestorePurchases`, `useReadOnly`. All purchase/restore mutations invalidate the `profile` query on success so the persisted status stays in sync with React Query cache. The subscription status is intentionally *not* part of the cloud backup snapshot — it's owned by RevenueCat and resolved per-device.

**Identity bridge** — `subscriptionService.identify(userId)` calls `Purchases.logIn(userId)` and `subscriptionService.signOut()` calls `Purchases.logOut()`. `App.tsx` subscribes to `cloud.onAuthStateChange` (plus a one-shot `cloud.getSession()` for cold-boot) and forwards every transition into the bridge so any RevenueCat entitlement granted under the user's Supabase id appears on this device automatically, and signing out reverts to an anonymous RC user. Both methods swallow RC failures and fall back to `resolveStatus()` so a network blip during sign-in never breaks the auth state listener. Without the bridge, every install would get a fresh anonymous RC profile and purchases wouldn't carry across reinstalls or to a second device.

## Onboarding

`OnboardingScreen.tsx` is a host component that drives a 6-step state machine; each step is a sibling component in `src/screens/onboarding/` with state shape declared in `onboarding/types.ts`. The canonical sequence is:

1. **welcome** — value prop + "Get started" CTA (`WelcomeStep.tsx`).
2. **name** — first + last name (`NameStep.tsx`).
3. **cert** — pick IRATA, SPRAT, or both; for each, level (L1/L2/L3) + cert number + expiry + optional card photo (`CertStep.tsx`).
4. **role_fork** — *conditional*: only shown when at least one captured cert is L3. Choice between "Use as Tech" (capability OFF) and "Use as Supervisor" (capability ON, requires supervisor cert number + directory visibility default ON). Skipped entirely when no L3 cert is present (`RoleForkStep.tsx`).
5. **subscribe** — RevenueCat sheet showing $2.99/mo + 7-day trial; CTA "Start free trial." No skip (`SubscribeStep.tsx`).
6. **cloud_signin** — Supabase magic-link / OAuth (`CloudSignInStep.tsx`). For tech-only signups this step is **deferred** — cloud screens prompt-then-route to sign-in when first used. For supervisor signups (capability ON from step 4) cloud sign-in is required because the supervisor directory row needs an authenticated `auth.uid()`; **steps 5 and 6 are swapped for this path** (cloud sign-in runs before subscribe — see spec §3 line 124).

On final success the host writes the profile, configures the supervisor directory row if applicable, and navigates to Today.

## Notifications

In-app notifications are recorded into a local `notifications` table (`id`, `kind`, `payload_json`, `created_at`, `read_at`, `dismissed_at`) added in A1. Eight kinds are currently emitted:

- `cert_expiry_60d`, `cert_expiry_0d` — local cert-expiry checks (60 days out, at expiry).
- `sign_request_received`, `sign_request_signed`, `sign_request_declined`, `sign_request_withdrawn` — supervisor / tech mutation echoes.
- `level_upgrade` — cert level promotion (e.g. lifetime hours threshold met).
- `backup_stale` — local-export reminder past the staleness threshold.

The kinds are an exhaustive union typed as `NotificationKind` in `src/services/notificationCenterService.ts`. The service exposes `record({ kind, payload, dedupeOnDay })` — dedupe-on-day collapses repeats of the same kind on the same calendar day (used for cert-expiry and backup-stale so we don't spam the bell every minute the app is open) — plus `list`, `unreadCount`, `markAllRead`, and `dismiss`.

Hook surface: `useNotificationCenter()` in `src/hooks/useNotifications.ts` returns `{ items, unreadCount, markAllRead, dismiss, isLoading }`. The bell icon on Today shows a red dot when `unreadCount > 0`. The full list lives at `NotificationsScreen.tsx` (registered in the root stack).

Write side, by source:

- **Sign-request mutations** record locally inside `signRequestsService` after the underlying Postgres write succeeds (mirrors the push-dispatch pattern — see "Push notifications" above).
- **Foreground checks** in `App.tsx` write `cert_expiry_*` and `backup_stale` rows on `AppState → active` transitions, deduped on `kind + day`.
- **Inbound push** is handled by `useNotifications` (in `src/hooks/useNotifications.ts`); the handler derives a `kind` from `sign_requests_cache` lookups and records into the notification center so the bell badge updates regardless of whether the OS-level notification was tapped.

Notifications are **local-only** — they are not part of the cloud backup snapshot. A device that restores from cloud starts with an empty notification list.

## Testing

The suite currently has **21 test files / 229 tests** (`__tests__/services/` × 16, `__tests__/db/` × 3, `__tests__/utils/` × 2). Real SQLite via `better-sqlite3` in-memory — not mocks — through `createTestClient()`. Every test exercises `runSchemaMigrations()` against the canonical schema so any drift between `schema.ts` and `migrations.ts` fails a test. `__tests__/testHash.ts` mirrors `expo-crypto`'s SHA-256 using Node's `crypto` module so hashes match between tests and production.

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
- `npx jest` is clean: 229 passed, 21 suites (run with `--runInBand` if you see flakes from parallel mock-cloud state).

## Not yet implemented

These features are part of this app's scope but not yet built. They are not deferred sub-projects or future add-ons — they are unfinished pieces of the same product. Requests to build any of them are in-scope work, not scope bumps.

- **Cryptographic keypair signing** — true non-repudiation (per-user or per-signature keypairs), replacing the current SHA-256 content-hash trust model. Paired device attestation is likely.
- **Live multi-device sync** — continuous sync rather than the current triggered snapshot backup. Concurrent edits on two devices currently produce Scenario C and require explicit resolution.
- **Org / company accounts with admin roles** — multi-user tenant model, admin dashboards, org-scoped policy.
- **Saved entry templates** — reusable entry presets for common work patterns.
