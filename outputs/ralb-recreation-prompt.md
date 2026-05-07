# Build "Rope Access Logbook" — recreation prompt

You are building a mobile app called **Rope Access Logbook (RALB)**. Treat this document as your only spec; produce a working, fully-typed Expo project that matches the architecture, data model, conventions, and feature set described below. When choices aren't pinned, pick the simplest option that fits the rest of the doc.

---

## 1. Product

An offline-first iOS + Android app for **SPRAT- and IRATA-certified rope access technicians**. It replaces the paper work-experience logbook techs carry to job sites: shift entries with hours and work descriptions, on-screen supervisor signatures captured at the end of a shift, and a PDF export suitable for re-certification audits.

- **Primary user:** a working tech logging entries on-site, often offline.
- **Secondary user:** a Level III tech who supervises others, signs entries on their own device.
- **Distribution:** paid app, $2.99/month with a 7-day free trial via RevenueCat. Onboarding ends at a paywall; no skip.
- **Lapsed subscribers:** read-only mode (logbook viewable, PDF/JSON export still works, all writes blocked).

Build it as one cohesive product, not as MVP + add-ons.

---

## 2. Stack — exact versions

```
expo                ~54.0.33     (SDK 54, new architecture ON)
react-native        0.81.5
react               19.1.0
typescript          ~5.9.2       (strict: true, extends expo/tsconfig.base)
node                18+
```

Key libraries (use these specific ones, not alternates):

- **Local DB:** `expo-sqlite` ~16.0.10 — single SQLite file, WAL mode.
- **Cloud:** `@supabase/supabase-js` ^2.103.3 (Auth + Storage + Postgres + Realtime + Edge Functions).
- **State:** `@tanstack/react-query` ^5.99.0.
- **Navigation:** `@react-navigation/native` ^7.x + `@react-navigation/native-stack` + `@react-navigation/bottom-tabs`.
- **Subscriptions:** `react-native-purchases` ^10.x (RevenueCat).
- **Auth:** `expo-auth-session`, `expo-web-browser`, `expo-apple-authentication` (Sign in with Apple), Supabase magic links via `expo-linking` deep links.
- **Storage helpers:** `@react-native-async-storage/async-storage`, `expo-file-system` (use the legacy module surface).
- **Crypto / hashing:** `expo-crypto` (SHA-256, UUID v4).
- **Camera & media:** `expo-image-picker`, `expo-haptics`, `expo-location`.
- **Signature capture:** `react-native-signature-canvas` (uses `react-native-webview`).
- **PDF / sharing:** `expo-print` + `expo-sharing`.
- **Notifications:** `expo-notifications` (local + remote push via Expo Push).
- **Updates:** `expo-updates` (channel-based, runtime version policy: `fingerprint`).
- **Fonts:** `@expo-google-fonts/inter` (Inter 400 / 500 / 600 only — no other typefaces).
- **Icons:** `lucide-react-native`.
- **SVG / polyfill:** `react-native-svg`, `react-native-url-polyfill` (load `react-native-url-polyfill/auto` as the *first* import in `App.tsx` and in `supabaseClient.ts`).

Dev / test:

- `jest` ^29 + `jest-expo` ~54 + `@testing-library/react-native` ^13 + `better-sqlite3` ^12 (in-memory DB for service-layer tests).

---

## 3. Project structure

```
app.config.ts            # ExpoConfig — name "Rope Access Logbook", slug "ralb",
                         # bundle/package "com.ropeaccess.logbook", scheme "logbook",
                         # newArchEnabled: true, runtimeVersion: { policy: "fingerprint" }
                         # iOS supportsTablet, usesAppleSignIn,
                         # Info.plist: NSCameraUsageDescription, NSPhotoLibraryUsageDescription,
                         #             NSLocationWhenInUseUsageDescription, ITSAppUsesNonExemptEncryption=false
                         # Android edgeToEdgeEnabled, predictiveBackGestureEnabled=false
                         # plugins: ['expo-sqlite','expo-web-browser',
                         #          '@react-native-community/datetimepicker',
                         #          'expo-notifications','expo-apple-authentication']
                         # extra: { supabaseUrl, supabaseAnonKey,
                         #          revenueCatAppleKey, revenueCatGoogleKey,
                         #          eas: { projectId } } — all fed from process.env

eas.json                 # cli.appVersionSource=remote
                         # build profiles: development (devClient+internal),
                         #                 preview (internal, channel "preview"),
                         #                 production (autoIncrement, channel "production")

index.ts                 # registerRootComponent(App)

App.tsx                  # Boot order:
                         #   (1) load Inter fonts
                         #   (2) initializeDatabase() → set dbReady
                         #   (3) once dbReady: subscriptionService.init() (RevenueCat)
                         #   (4) bridge Supabase auth → RC: cold-boot getSession +
                         #       onAuthStateChange both call subSvc.identify(uid)/signOut()
                         #       and invalidate the 'subscriptionStatus' react-query key
                         #   (5) shared cloud-backup service singleton (used by post-sign,
                         #       AppState→background, and the manual button)
                         #   (6) AppState listener:
                         #         background → cloudBackup.backup() (best-effort)
                         #         active     → supervisorConnections.sync() +
                         #                      signRequests.sync() +
                         #                      recordForegroundReminders()
                         #   (7) expo-linking listener for logbook://auth-callback
                         #       (cold + warm) → cloud.exchangeAuthCode(code)

src/
  types.ts               # All domain TypeScript types (see §4 below)
  constants.ts           # APP_VERSION
  config.ts              # getConfig() — reads Constants.expoConfig?.extra,
                         # throws "Missing required config: <name>" if missing
  db/
    client.ts            # DbClient interface: run, get, getAll, exec
    expoClient.ts        # expo-sqlite-backed DbClient
    schema.ts            # SCHEMA_SQL string (see §4)
    migrations.ts        # runSchemaMigrations(client) — idempotent ALTER TABLE/ADD COLUMN
                         # guarded by PRAGMA table_info introspection
    hashMigration.ts     # runHashMigration(client, sha256) — one-shot v1→v2 upgrade
                         # of existing signatures whose v1 hash still verifies on this device
    initialize.ts        # initializeDatabase(): open WAL, exec SCHEMA_SQL one-statement-at-a-time,
                         # run schema migrations, run hash migration. Singleton client.
  services/              # Pure functions over (DbClient [, CloudClient, FileSystemAbstraction,
                         #                       HashFn, clock]). Factory pattern: createXService(...)
    profileService.ts
    entriesService.ts          # CRUD + createAmendment + getTotalWorkHours +
                               # getAmendmentForEntry + getOriginalEntry +
                               # getLifetimeHoursByLevel
    signingService.ts          # signEntry, verifyIntegrity, getSignatureForEntry,
                               # getAllSignatures, computeEntryHashForVersion
                               # — dispatches on hash_version (v1, v2, v3); CURRENT_HASH_VERSION=2
    exportService.ts           # exportAsJson, exportAsPdf
    backupService.ts           # local-export reminder + cert-expiry helpers (pure, no DB)
    authService.ts             # thin façade over CloudClient (signInWithMagicLink,
                               # signInWithProvider, signOut, getSession,
                               # onAuthStateChange, deleteAccount)
    cloudBackupService.ts      # backup(), getLastBackupStatus()
    restoreService.ts          # previewCloudState(), restore(), uploadCurrentAsCloud()
    supervisorConnectionsService.ts
    signRequestsService.ts
    subscriptionService.ts     # RevenueCat wrapper, status union 'unknown'|'trialing'|
                               # 'active'|'lapsed', mirrors into profile.subscription_status
    notificationCenterService.ts
  cloud/
    cloudClient.ts             # CloudClient interface (auth/storage/edge functions/isOnline)
    supabaseClient.ts          # createSupabaseCloudClient() — runtime impl with
                               # AsyncStorage session persistence + PKCE flow
    fsAbstraction.ts           # FileSystemAbstraction interface + expo-file-system impl
  utils/
    canonical.ts               # canonicalize(obj) — recursive key sort, whitespace collapse
                               # inside strings, drop created_at/updated_at, JSON.stringify
    hash.ts                    # sha256(input) using expo-crypto
    paths.ts                   # normalizeAppPath / rehydrateAppPath — strip
                               # FileSystem.documentDirectory prefix on backup,
                               # re-add on restore
    fileStorage.ts             # copyPhotoToAppStorage, saveSignaturePng, saveCardPhoto
                               # — all copy into documentDirectory/logbook/{photos,signatures,cards}/
    uuid.ts                    # generateId() — UUID v4 via expo-crypto
    entryPayloadHash.ts        # computeEntryHashFromPayload(payload, hashVersion)
                               # — mirrors entryRowToHashInputV3 from a remote-sign payload;
                               # FORCES status='signed' on the hash input
    dateRange.ts, entryComplete.ts, entryStatusPill.ts, notifications.ts
  hooks/                       # React Query wrappers — one hook per service operation,
                               # plus useReadOnly() (lapse gate)
    useProfile, useEntries, useSignatures, useBackupReminder,
    useAuthSession, useBackup, useBackupStatus, useRestore,
    useSupervisorConnections, useSupervisorSearch, useSignRequests,
    useSubscription (useSubscriptionStatus, useSubscriptionPackages,
                     usePurchasePackage, useRestorePurchases, useReadOnly),
    useNotificationCenter, useNotifications,
    useTodayHours, useCertProgress, useMilestones, useDebouncedValue
  primitives/                  # Reusable building blocks. Read tokens via useTheme().
    Screen, Button, IconButton, Input, Textarea, Card, Badge, Banner,
    Chip, ListRow, EmptyState, ProgressBar, SectionHeader, LoadingSpinner,
    Toast (ToastProvider + useToast),
    StatusPill, FilterChips, SegmentedControl, Sheet, CenterModal,
    ChecklistRow, MultiSelectListRow, StatCard, AvatarUpload,
    SubscriptionStrip, KeyboardDoneAccessory
    index.ts                   # barrel
  components/                  # Composite (wider than primitive, narrower than screen)
    SettingsSheet, illustrations/
  screens/                     # Route-level screens (see §5 for tabs/stack mapping)
    OnboardingScreen + onboarding/{Welcome,Name,Cert,RoleFork,Subscribe,CloudSignIn}Step + types.ts
    DashboardScreen, RecordsScreen, MeScreen, InboxScreen,
    EntryFormScreen + entryForm/ helpers,
    EntryDetailScreen, SignatureScreen,
    AuthScreen, MagicLinkWaitScreen, CloudConflictScreen,
    SupervisorSearchScreen, SupervisorsListScreen, SignRequestDetailScreen,
    PaywallScreen, NotificationsScreen, SendSignRequestScreen,
    PostSaveSheet, SignatureOptionsSheet,
    EditNameScreen, EditCertsScreen, EditAvatarScreen,
    PrivacyPolicyScreen, TermsOfServiceScreen
  navigation/
    RootNavigator.tsx          # Single NavigationContainer, native-stack of gated branches
                               # (Onboarding | CloudConflict | Main); see §5
  theme/
    tokens.ts                  # colors, spacing, radii, borders, shadows, typography (§6)
    ThemeProvider.tsx          # ThemeProvider + useTheme()
  templates/                   # HTML/CSS for PDF export (cover, entry pages, summary)

__tests__/
  setup.ts                     # createTestClient() — better-sqlite3 in-memory + run schema
                               # migrations against canonical schema (drift fails tests)
  testHash.ts                  # Node crypto SHA-256 mirror of expo-crypto
  cloudMock.ts                 # createMockCloudClient() with offline/quota/fail-upload knobs
  fsMock.ts                    # createMockFs()
  services/   db/   utils/

supabase/
  README.md                    # Provisioning runbook
  migrations/                  # SQL migrations (storage bucket + RLS, supervisor accounts,
                               # cron jobs, push_tokens, RLS hardening)
  functions/                   # Deno Edge Functions
    delete-account             # service-role; derives uid from JWT, never accepts as param
    cleanup-request-assets     # cron-driven asset GC for expired sign_requests
    invite-supervisor          # caller-authenticated invite resolution
    search-supervisors         # caller-authenticated directory search
    notify-sign-request        # caller-authenticated push dispatch
                               # (verifies caller is a party to the sign request)

assets/                        # icon, adaptive-icon, splash-icon, favicon
docs/superpowers/              # specs and plans (design docs)
```

`tsconfig.json` extends `expo/tsconfig.base` with `strict: true` and **excludes `supabase/`** from the app type check (Edge Functions are Deno code with URL imports).

---

## 4. Data model

### Local SQLite (six tables + indexes)

```sql
-- profile (single row enforced by app logic)
CREATE TABLE profile (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  -- SPRAT block (legacy column names kept; nullable so IRATA-only users are first-class)
  holds_sprat INTEGER NOT NULL DEFAULT 1,
  sprat_id TEXT,
  level TEXT CHECK (level IN ('I','II','III')),
  cert_expires_on TEXT,
  sprat_card_photo_path TEXT,
  avatar_path TEXT,
  -- IRATA block
  holds_irata INTEGER NOT NULL DEFAULT 0,
  irata_id TEXT,
  irata_level TEXT CHECK (irata_level IN ('I','II','III')),
  irata_expires_on TEXT,
  irata_card_photo_path TEXT,
  primary_cert TEXT NOT NULL DEFAULT 'sprat' CHECK (primary_cert IN ('irata','sprat')),
  default_employer TEXT NOT NULL DEFAULT '',
  last_backup_at TEXT,                          -- last LOCAL export
  photos_in_backup INTEGER NOT NULL DEFAULT 0,
  last_cloud_backup_at TEXT,
  last_uploaded_backup_id TEXT,                 -- compared against cloud snapshot for Scenario C
  supervisor_capability_enabled INTEGER NOT NULL DEFAULT 0,
  supervisor_cert_number TEXT,
  supervisor_directory_visible INTEGER NOT NULL DEFAULT 1,
  subscription_status TEXT NOT NULL DEFAULT 'unknown',  -- 'unknown'|'trialing'|'active'|'lapsed'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,                           -- == date_from for new rows; kept for v1 hash
  date_from TEXT, date_to TEXT,
  employer TEXT NOT NULL, site TEXT NOT NULL, client TEXT NOT NULL,
  description TEXT NOT NULL,
  work_hours REAL NOT NULL,
  tech_level_snapshot TEXT NOT NULL CHECK (tech_level_snapshot IN ('I','II','III')),  -- SPRAT
  irata_level_snapshot TEXT CHECK (irata_level_snapshot IN ('I','II','III')),
  work_types TEXT NOT NULL DEFAULT '[]',        -- JSON array of WorkType
  other_work_description TEXT,
  equipment_notes TEXT,
  weather TEXT,
  photo_paths TEXT NOT NULL DEFAULT '[]',       -- JSON array of file paths
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','amended')),
  amends_entry_id TEXT REFERENCES entries(id),
  amendment_reason TEXT,
  pending_sign_request_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE signatures (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id),
  supervisor_name TEXT NOT NULL,
  supervisor_cert_number TEXT NOT NULL,
  signature_png_path TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  gps_lat REAL, gps_lon REAL,
  entry_hash TEXT NOT NULL,
  hash_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_entries_status   ON entries(status);
CREATE INDEX idx_entries_date     ON entries(date);
CREATE INDEX idx_entries_amends   ON entries(amends_entry_id);
CREATE INDEX idx_signatures_entry ON signatures(entry_id);

CREATE TABLE supervisor_connections_cache ( ... );  -- mirror of Postgres, for offline read
CREATE TABLE sign_requests_cache          ( ... );  -- mirror of Postgres, for offline read

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                           -- see kinds below
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT
);
CREATE INDEX idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL;

-- Add via runSchemaMigrations (NOT in SCHEMA_SQL):
CREATE INDEX idx_entries_pending_sign_request
  ON entries(pending_sign_request_id) WHERE pending_sign_request_id IS NOT NULL;
```

`WorkType`: `'inspection' | 'ndt' | 'welding' | 'painting' | 'window_cleaning' | 'rescue' | 'training' | 'rigging' | 'other'`.

`NotificationKind`: `'cert_expiry_60d' | 'cert_expiry_0d' | 'sign_request_received' | 'sign_request_signed' | 'sign_request_declined' | 'sign_request_withdrawn' | 'level_upgrade' | 'backup_stale'`.

### Supabase (Postgres + Storage)

Two private Storage buckets:

- `logbook-backups` — RLS: `(storage.foldername(name))[1] = auth.uid()::text`. Layout: `{uid}/snapshot.json`, `{uid}/assets/sig_{signature_id}.png`, `{uid}/assets/spratcard_{profile_id}.{ext}`, `{uid}/assets/photo_{entry_id}_{index}.{ext}`. Photos opt-in via `profile.photos_in_backup`.
- `sign-requests` — RLS joins against the `sign_requests` row so only the two parties can read/write under `{request_id}/`.

Postgres tables:

- `supervisor_connections` — `(tech_user_id, supervisor_user_id, status, invited_email, supervisor_display_name, ...)`. Status: `pending|accepted|declined|revoked`. RLS: both parties read; tech inserts; either updates status per side-specific rules.
- `sign_requests` — one entry awaiting remote signature with a frozen entry-content snapshot. Status: `pending|signed|declined|withdrawn|expired`. RLS: both parties read; tech inserts; supervisor signs/declines; tech withdraws.
- `supervisor_directory` — opt-in search surface. RLS: any authenticated user SELECTs visible rows; only owner upserts/deletes their own row.
- `push_tokens` — per-user Expo push tokens. Client registers on login.

Realtime is enabled on `supervisor_connections` and `sign_requests` (added to the `supabase_realtime` publication). pg_cron drives sign-request expiry + Storage asset GC.

### Cloud snapshot

```ts
interface CloudSnapshot extends JsonBackup {
  cloud_schema_version: 1 | 2 | 3;
  backup_id: string;
  binary_manifest: { [storage_key: string]: { sha256: string; size_bytes: number; created_at: string } };
  photos_included: boolean;
}
```

All path columns inside the snapshot are stored **relative** (normalized via `normalizeAppPath()` before upload). On restore, `rehydrateAppPath()` rewrites them to the new device's absolute paths.

---

## 5. Navigation

Single `NavigationContainer` containing a native-stack of three gated branches:

1. **Onboarding** — shown when no profile exists. 6-step state machine in `OnboardingScreen`:
   1. Welcome (value prop + "Get started").
   2. Name (first + last).
   3. Cert (pick IRATA / SPRAT / both → for each: level L1/L2/L3, cert number, expiry, optional card photo).
   4. **Role fork** *(conditional — only when at least one captured cert is L3)* — "Use as Tech" vs. "Use as Supervisor" (capability ON, requires supervisor cert number + directory visibility default ON).
   5. Subscribe (RevenueCat sheet, $2.99/mo + 7-day trial, no skip).
   6. Cloud sign-in (Supabase magic-link / Apple / Google).
   - Tech-only path: cloud sign-in is **deferred** — cloud screens prompt-then-route to sign-in when first used.
   - Supervisor path: **steps 5 and 6 are swapped** (cloud sign-in before subscribe), because the supervisor directory row needs an authenticated `auth.uid()`.
2. **CloudConflict** — sole route when both local and cloud have data and `last_uploaded_backup_id != cloud.backup_id`. User picks "Keep cloud, replace this device" or "Replace cloud with this device." No merge offered.
3. **Main** — bottom-tab navigator wrapped in the stack:
   - **Dashboard** (Home icon) — total-hours hero, work-type breakdown, year-over-year stats, cert progress.
   - **Records** (BookOpen) — entry list with filter chips (`all|drafts|needs_signature|awaiting|signed`).
   - **Inbox** (Inbox) — *conditional tab* shown only when `profile.supervisor_capability_enabled`. Pending invites + incoming sign requests.
   - **Me** (User) — profile, certs, supervisors, subscription strip, cloud-backup section, edit links.
   - Plus stack screens: `EntryForm` (modal), `EntryDetail`, `Signature`, `Auth`, `MagicLinkWait`, `SupervisorSearch`, `SupervisorsList`, `SignRequestDetail`, `Paywall` (modal), `Notifications`, `SendSignRequest` (modal), `EditName`, `EditCerts`, `EditAvatar`, `PrivacyPolicy`, `TermsOfService`, plus transparent-modal sheet routes `PostSaveSheet` and `SignatureOptionsSheet`.

Themed default header: `bgSurface` background, Inter `title2` title in `textPrimary`, no shadow, 1px hairline divider rendered via `headerBackground`. Individual screens opt out via `headerShown: false`.

---

## 6. Styling — design tokens

**Light theme. Cream background, deep red CTAs, Inter typography only — no other typefaces, no dark mode.**

```ts
colors = {
  bgApp:     '#FAF7F2',  // warm cream root
  bgSurface: '#FFFFFF',  // cards / sheets / headers
  bgMuted:   '#F5F2ED',

  border:       '#E5E7EB',  borderStrong: '#D1D5DB',  divider: '#ECEAE5',
  textPrimary:  '#111827',  textSecondary: '#6B7280',  textDisabled: '#9CA3AF',  textInverse: '#FFFFFF',

  accentPrimary: '#B71C1C',  accentPressed: '#8E1212',  accentTint: '#FCEAEA',  // deep red

  statusOk:   '#16A34A',  statusWarn: '#F59E0B',
  statusErr:  '#DC2626',  statusInfo: '#2563EB',
  statusOkTint: '#DCFCE7', statusWarnTint: '#FEF3C7',
  statusErrTint: '#FEE2E2', statusInfoTint: '#DBEAFE', statusNeutralTint: '#F3F4F6',

  certL1: '#2563EB',  certL2: '#D97706',  certL3: '#15803D',

  overlay: 'rgba(0,0,0,0.4)',
};

spacing  = { xs:4, sm:8, md:12, base:16, lg:24, xl:32, xxl:48,
             s1:4, s2:8, s3:12, s4:16, s5:20, s6:24, s8:32, s10:40, s12:48, s16:64 };
radii    = { none:0, xs:4, sm:8, md:12, lg:16, pill:999, full:999 };
borders  = { hair:1, rule:1.5, block:2, heavy:3 };
shadows  = { sm, md, accentGlow };  // accentGlow uses accentPrimary at 0.18 opacity
touchTarget = { min: 44, preferred: 44 };  // Apple HIG

typography = {
  title1:  { fontFamily:'Inter_600SemiBold', fontSize:28, lineHeight:34, fontWeight:'600' },
  title2:  { fontFamily:'Inter_600SemiBold', fontSize:20, lineHeight:28, fontWeight:'600' },
  body:    { fontFamily:'Inter_400Regular',  fontSize:16, lineHeight:24, fontWeight:'400' },
  bodyMed: { fontFamily:'Inter_500Medium',   fontSize:16, lineHeight:24, fontWeight:'500' },
  label:   { fontFamily:'Inter_500Medium',   fontSize:14, lineHeight:20, fontWeight:'500' },
  caption: { fontFamily:'Inter_400Regular',  fontSize:12, lineHeight:16, fontWeight:'400' },
};
```

Screens **must not** define their own StyleSheets for anything a primitive already covers — compose from primitives. All primitives read tokens via `useTheme()`. No legacy industrial / dark-theme aliases.

---

## 7. Architecture — three-layer

### a) Persistence — `src/db/`

`DbClient` is the only DB abstraction (`run` / `get` / `getAll` / `exec` against parameterized SQL). Runtime impl wraps `expo-sqlite`; tests use `better-sqlite3` in-memory via `createTestClient()`. New columns are added idempotently in `runSchemaMigrations` (guarded `PRAGMA table_info` + `ALTER TABLE`).

### b) Services — `src/services/`

Pure factory functions (`createXService(db, ...)`) — never classes. Cloud services additionally take `CloudClient + FileSystemAbstraction + HashFn + clock`. Services own all domain rules; UI consumes hooks/services and embeds zero business logic.

### c) UI — primitives → components → screens

Composable hierarchy. Hooks (`src/hooks/`) wrap services in React Query; screens consume hooks. The `useReadOnly()` hook is the **single authority for write-gating in the UI** when a subscription has lapsed; services don't enforce the lapse gate (it's a UX concern, not a data invariant).

---

## 8. Invariants — these are contract, not convention

1. **Signed entries are immutable.** `entriesService.updateEntry` and `deleteEntry` throw on `status === 'signed'`. The UI gates them but the service is the authority.
2. **Editing a signed entry goes through `createAmendment`** — creates a new draft with `amends_entry_id` set. Both rows remain forever. Once the amendment is signed, the original is *treated as superseded* (its hours excluded from `getTotalWorkHours` / `getLifetimeHoursByLevel` via `NOT EXISTS (SELECT 1 FROM entries a WHERE a.amends_entry_id = e.id AND a.status='signed')`). The original's `status` column **stays `'signed'` and is never mutated** — `status` is in the canonical hash input, so changing it would invalidate the original's signature.
3. **At most one amendment per signed entry.** `createAmendment` enforces this.
4. **Canonical serialization** (`utils/canonical.ts`): recursive key sort, collapse whitespace runs inside strings, drop `created_at` / `updated_at`, then `JSON.stringify`. This is what gets hashed at signing time.
5. **`tech_level_snapshot`** is set once at entry creation and never updated — it captures the tech's SPRAT level at the time the work was done.
6. **Signatures are content-hashed and version-dispatched.** `CURRENT_HASH_VERSION = 2`. v1 (`entryRowToHashInputV1`) is **frozen** — it hashes raw absolute `photo_paths` exactly as the earliest code wrote them. v2 (`entryRowToHashInputV2`) parses `photo_paths` JSON and runs each path through `normalizeAppPath()` so hashes survive reinstalls and cross-device restore. v1→v2 boot migration only upgrades rows whose v1 hash still verifies on this device; rows whose v1 verification already fails stay at v1 with their failing hash so the integrity banner surfaces them as tampered.
7. **Entry lock (supervisor):** an entry with `pending_sign_request_id != null` is read-only. `updateEntry` and `deleteEntry` throw. Withdrawing or declining the request clears the lock.
8. **`computeEntryHashFromPayload` forces `status: 'signed'`** on the hash input because `verifyIntegrity` rehashes the local row *after* `applyIncomingSignature` flips status to `'signed'`. Without this, every remote-signed entry would appear tampered.
9. **Supervisor-account writes require online** and fail fast with a "connection required" banner. Reads serve from the SQLite cache.
10. **Sign-request insert ordering (real Supabase):** `sendSignRequest` generates a UUID client-side, INSERTs the `sign_requests` row first (so the Storage RLS join resolves), **then** uploads assets under `{request_id}/`. The mock reverses this for test simplicity.
11. **Cloud backup atomicity:** `snapshot.json` uploads **last**, after every referenced asset exists. If any earlier step fails, the previous snapshot still references existing assets — a broken reference is never committed to Storage.
12. **Lapse gate:** `subscription_status === 'lapsed'` ⇒ logbook viewable, PDF/JSON export still works, all writes blocked. Paywall is re-presentable as a modal.
13. **Path columns:** the DB stores **absolute** paths for runtime; the cloud snapshot stores **relative** paths; restore rehydrates to absolute. Camera-roll URIs and `content://` URIs are never persisted — `copyPhotoToAppStorage` always copies into `documentDirectory/logbook/{photos,signatures,cards}/` first.

---

## 9. Cloud backup — semantics

Triggers (all funnel through one shared service singleton):

- Post-sign — `useSignEntry` accepts an optional `afterSign` callback; `SignatureScreen` passes `() => backup.mutate()`.
- `AppState → background` (best-effort).
- Manual "Back up now" button in `MeScreen`'s cloud section.

Behavior:

- **Throttle 30 s**, in-memory mutex (`inFlight` promise) coalesces concurrent triggers.
- **Delta upload** keyed by sha256 — previous manifest cached in AsyncStorage (`logbook:last_uploaded_manifest`); only changed assets re-upload.
- **Orphan cleanup** — keys present in cached manifest but absent from new manifest are deleted from Storage (this is how `photos_in_backup` toggle off→on backfills and on→off cleans up).
- `snapshot.json` uploads last (atomicity).
- On success update `profile.last_cloud_backup_at` and `profile.last_uploaded_backup_id`.

Restore:

- Refuses if `snap.cloud_schema_version > MAX_CLOUD_SCHEMA_VERSION` or `snap.schema_version > MAX_DB_SCHEMA_VERSION` with `version_too_new` (local DB untouched).
- Assets downloaded one by one with sha256 verification; mismatches quarantined and listed in `assets_failed` while the rest proceeds. Affected entries show a "Signature image missing" banner but hashes still verify (hash is over entry content, not PNG bytes).
- DB rows written inside a single transaction that first `DELETE`s everything locally — restore is whole-logbook **replacement**, not merge. Path columns rewritten with the new device's absolute paths via `rehydrateAppPath()` before insertion.

`uploadCurrentAsCloud()` (Scenario C "replace cloud") runs `deletePrefix('{uid}/')` and clears the manifest cache. Caller triggers a fresh `useBackup()` immediately after.

---

## 10. Push notifications

**Dispatched from the device that performed the mutation, not from a Postgres trigger.** Every mutation in `signRequestsService` (send / withdraw / decline / sign) calls `cloud.notifySignRequest(type, record, oldRecord)` after the underlying Postgres write succeeds. The `notify-sign-request` Edge Function verifies the JWT, re-reads the `sign_requests` row with the service role, confirms the caller is a party to it, resolves the *other* party's push token from `push_tokens`, and POSTs to `https://exp.host/--/api/v2/push/send`. Failed dispatches never fail the underlying mutation — fire-and-forget.

Local notifications (cert expiry at 60 days and at-expiry; supervisor-side new-request tap target) go through `expo-notifications` and don't touch Supabase.

In-app notification center (the `notifications` table + bell on Dashboard) is **local-only** — not part of the cloud snapshot. A device that restores from cloud starts with an empty bell. `record({ kind, payload, dedupeOnDay })` collapses repeats of the same kind on the same calendar day (used by `cert_expiry_*` and `backup_stale` foreground checks in `App.tsx`).

---

## 11. Subscriptions

Four-state RevenueCat-driven status union: `'unknown' | 'trialing' | 'active' | 'lapsed'`. `ENTITLEMENT_ID = 'pro'`.

- `init()` reads `extra.revenueCatAppleKey` / `extra.revenueCatGoogleKey`, picks the right one per platform, calls `Purchases.configure({ apiKey })`. Missing keys warn but don't throw.
- `getStatus()` resolution: live `Purchases.getCustomerInfo()` → `deriveStatus(info)` → write-back to `profile.subscription_status` → return. On RC failure, falls back to the persisted `profile.subscription_status` (offline gate works).
- **Identity bridge** in `App.tsx` — every Supabase auth-state transition forwards to `subscriptionService.identify(userId)` (calls `Purchases.logIn(userId)`) or `subscriptionService.signOut()` (`Purchases.logOut()`). Without this, every install would get a fresh anonymous RC profile and purchases wouldn't carry across reinstalls or to a second device. Both methods swallow RC failures.
- Subscription status is intentionally **NOT** part of the cloud backup snapshot — it's owned by RevenueCat and resolved per-device.
- Surfaces: `PaywallScreen` (modal), `MeScreen.SubscriptionStrip` with state-specific copy.
- "Search by name" in `SupervisorSearchScreen` is a paid-only feature; non-subscribers route to Paywall.

---

## 12. Auth

Supabase Auth with PKCE flow, `AsyncStorage` session persistence. Providers: magic-link (email), Apple (`expo-apple-authentication`), Google (`expo-auth-session` OAuth via `expo-web-browser`). The redirect URI is `logbook://auth-callback` — handle both cold-launch (`Linking.getInitialURL()`) and warm (`Linking.addEventListener('url', ...)`) cases, then `cloud.exchangeAuthCode(code)`.

`react-native-url-polyfill/auto` MUST be the first import in `App.tsx` and in `supabaseClient.ts` (it must load before `@supabase/supabase-js` pulls in `URL`).

---

## 13. Build & deploy

`eas.json`:

```json
{
  "cli": { "version": ">= 18.7.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview":     { "distribution": "internal", "channel": "preview" },
    "production":  { "autoIncrement": true, "channel": "production" }
  },
  "submit": { "production": {} }
}
```

`app.config.ts` is a function returning `ExpoConfig`. **Critical:** `extra` reads from `process.env.SUPABASE_URL`, `process.env.SUPABASE_ANON_KEY`, `process.env.REVENUECAT_APPLE_KEY`, `process.env.REVENUECAT_GOOGLE_KEY` at config-evaluation time. EAS builds run remotely — wire these via `eas env:create` (or the EAS dashboard) for each environment, **not just `.env`**, or the bundled config evaluates them to `undefined` and the app crashes at boot with `Missing required config: supabaseUrl`. Document this in the README.

Local dev: copy `.env.example` to `.env` and fill `SUPABASE_URL` + `SUPABASE_ANON_KEY` (RevenueCat keys are optional in dev). The app is fully usable offline without Supabase credentials until the user signs in.

`expo-updates`: runtime version policy `fingerprint`, channel-based.

Supabase provisioning (`supabase/README.md`):

```bash
supabase db push --db-url postgres://...
supabase functions deploy delete-account          --no-verify-jwt
supabase functions deploy cleanup-request-assets  --no-verify-jwt
supabase functions deploy notify-sign-request     --no-verify-jwt
# invite-supervisor and search-supervisors are caller-authenticated; deploy normally.
supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
```

`--no-verify-jwt` is used because each of those three functions verifies the caller manually. The service-role key lives only in deployed Edge Function secrets — **never** in the client bundle.

---

## 14. Testing

`jest-expo` preset; `transformIgnorePatterns` tuned to leave RN / Expo packages untransformed. Real SQLite via `better-sqlite3` in-memory through `createTestClient()` — **not mocks**. Every test exercises `runSchemaMigrations()` against the canonical schema so any drift between `schema.ts` and `migrations.ts` fails a test. `__tests__/testHash.ts` mirrors `expo-crypto` SHA-256 using Node's `crypto` so hashes match between tests and production. Cloud tests use `createMockCloudClient()` + `createMockFs()` (in-memory, configurable offline / quota / fail-upload knobs).

Aim for: a service-layer test file per service, a migration test file, a hash-migration test file, a canonical-serialization test, a path-normalization test, and a remote-sign round-trip test. Don't unit-test real Supabase / OAuth / deep links — those are manual QA against a dev project.

`tsconfig.json` excludes `supabase/`. Run with `npx jest --runInBand` if parallel mock-cloud state causes flakes.

---

## 15. Conventions

- TypeScript strict, 2-space indent, semicolons.
- Named exports + factory functions (`createEntriesService`, never `class EntriesService`).
- `PascalCase` for screens/components, `camelCase` for functions and hooks, `*.test.ts` for tests.
- Conventional Commits with narrow scope: `feat(signrequest): ...`, `fix(dashboard): ...`, `refactor(primitives): ...`.
- Domain rules belong in `src/services/` — UI consumes hooks/services and never embeds business logic.
- Don't write CLAUDE.md / README content the code can't back up. Don't introduce abstractions before the third similar use case.
- Don't commit `.env` (gitignored). Don't put service-role keys in the client bundle.

---

## 16. Domain glossary

- **SPRAT** — Society of Professional Rope Access Technicians (US-based certifying body). Levels I, II, III.
- **IRATA** — Industrial Rope Access Trade Association (UK / international). Levels 1, 2, 3.
- **Logbook entry** — one shift's record: dates, employer, site, client, work types, hours, description, optional photos, optional weather/equipment notes.
- **Supervisor signature** — Level III tech endorses the entry on-screen at end of shift; captures their name, cert number, date, and the entry's content hash. This is the legal artifact a re-cert audit requires.
- **Amendment** — a corrected re-issue of a signed entry. The original stays in the logbook forever (immutable) but is treated as superseded once the amendment is signed.
- **Remote signing** — the supervisor signs on their own device. Supervisor capability is opt-in for any L3 tech.
- **Re-certification** — recurring SPRAT/IRATA exam where the auditor reviews the candidate's logbook hours.

---

## 17. Out of scope (don't build these)

- Cryptographic keypair signing — true non-repudiation. Current trust model is SHA-256 content-hash, same as paper.
- Live multi-device sync — current model is triggered snapshot backup with explicit Scenario A/B/C resolution.
- Org / company accounts with admin roles.
- Saved entry templates.
- Dark mode.

---

## 18. What "done" looks like

- `npx tsc --noEmit` clean.
- `npx jest` all green (target: a test per service, plus migration / hash-migration / canonical / path-normalization / remote-sign round-trip).
- `npx expo start` boots on iOS + Android simulators, onboarding completes, an entry can be created, signed (locally), exported as PDF + JSON, restored from cloud.
- `eas build --profile preview` produces a runnable internal-distribution build with all env vars baked in (verified via `eas env:list --environment preview`).
- All invariants in §8 hold.

Build it.
