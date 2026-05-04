# Equipment Inventory & Inspection Tracker — Design

Status: design approved, awaiting written-spec review
Owner: feature/dashboard-tweaks branch (or successor)
Date: 2026-05-04

## 1. Overview

Adds a personal-equipment inventory and inspection-due tracker to the
Rope Access Logbook. A SPRAT- or IRATA-certified technician can record
their rope-access PPE and hardware (harnesses, helmets, ropes, lanyards,
descenders, ascenders, etc.), log periodic inspections against each
item, and receive local notifications when an inspection is approaching
or due. The feature is offline-first like the rest of the app, syncs
via the existing cloud-backup snapshot, and is read-only for users
whose subscription has lapsed.

This is a personal-tracking tool for the tech, not a substitute for the
competent inspector who actually performs and signs off the periodic
inspections. The app records the *fact* of inspection plus an optional
photo of the inspector's certificate.

## 2. Decisions captured during brainstorming

The following decisions were settled before writing this spec; the rest
of the document treats them as fixed.

| # | Question | Decision |
|---|---|---|
| 1 | How does the gear catalog reach the device? | Brand/model **autocomplete only** — a flat list of `{manufacturer, model, category}` rows fetched from a Supabase table and cached locally. Does not drive any logic. |
| 2 | Inspection cadence | **Per-category 6-month default + per-item override.** Industry standard. Per-shift "pre-use" checks not modelled. |
| 3 | Inspection record granularity | **Minimal** — date + result (pass / pass-with-concerns / fail) + inspector name + optional notes + optional photo. No category-specific checklists. |
| 4 | Notification timing | **Two-stage** — 30 days before inspection due + day-of. Mirrors the cert-expiry pattern (`cert_expiry_60d` / `cert_expiry_0d`). |
| 5 | Cloud sync | **Yes**, full sync. Gear and inspection records ride the existing cloud-backup snapshot. Photos follow the existing `photos_in_backup` toggle. |
| Arch | Implementation shape | **Mirror entries pattern** — new SQLite tables, new `gearService` factory, snapshot extension, `restoreService` rebuilds, `expo-notifications` for OS pushes plus in-app `notifications` table for the bell. |

## 3. User flows

**3.1 First-time setup.** No onboarding step. Discoverable from
MeScreen ("Gear" row added beneath Supervisors) and from a Dashboard
card that surfaces only when the inventory is non-empty AND has at
least one item due / overdue.

**3.2 Add an item.**
1. MeScreen → Gear → "+ Add gear".
2. AddGearScreen.
3. User picks a category (segmented control or list).
4. User types into "Make / model" — dropdown autocompletes from the
   catalog cache. Selecting a row pre-fills `manufacturer` + `model`
   and (if not already chosen) `category`. Free-form typing always
   works; nothing requires catalog match.
5. Optional fields: name (defaults to "{manufacturer} {model}" if
   blank), serial number, manufacture date, first-use date,
   inspection-interval-months override (defaults to 6), photo, notes.
6. Save → returns to GearScreen list with the new item at the top.
7. Service computes `next_inspection_due` from
   `first_use_date ?? manufacture_date ?? today` plus
   `inspection_interval_months`, schedules the two notifications, and
   records nothing in the bell yet (the bell rows fire on the
   30-day/day-of foreground checks like cert expiry).

**3.3 Log an inspection.**
1. GearScreen → tap an item → GearDetailScreen.
2. "Log inspection" CTA.
3. LogInspectionScreen captures: inspected-on date (defaults today),
   result (3-segment: pass / concerns / fail), inspector name, notes,
   optional cert photo.
4. Save → service inserts a `gear_inspections` row, advances
   `next_inspection_due` to `inspected_on + interval_months` (on pass
   or pass-with-concerns) or sets `retired_at = inspected_on,
   retirement_reason = 'failed inspection'` (on fail).
5. Re-schedules the local notifications around the new due date.
6. Returns to GearDetailScreen with the new record at the top of the
   inspection history.

**3.4 Retire an item manually.**
- GearDetailScreen → "Retire item" → reason input → confirm.
- Sets `retired_at = today`, `retirement_reason = <reason>`.
- Cancels future notifications for that item.
- Item is now read-only; appears in a "Retired" section at the bottom
  of GearScreen with grayed styling.

**3.5 Lapsed subscription.** All write paths in this feature consult
`useReadOnly()`. Add gear, edit gear, log inspection, retire, change
interval — every CTA bounces to Paywall when `status === 'lapsed'`.
Read paths (list, detail, history) work normally; the inventory is
their data, just like the existing entries.

## 4. Data model

### 4.1 Local SQLite

Two new tables. Both added in a new schema migration plus updated in
`src/db/schema.ts` to keep `__tests__/setup.ts`'s drift check green.

```sql
CREATE TABLE gear (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'harness','helmet','rope','lanyard','sling',
    'descender','ascender','carabiner','pulley','other'
  )),
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  manufacture_date TEXT,
  first_use_date TEXT,
  retired_at TEXT,
  retirement_reason TEXT,
  inspection_interval_months INTEGER NOT NULL DEFAULT 6,
  next_inspection_due TEXT,
  photo_path TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE gear_inspections (
  id TEXT PRIMARY KEY,
  gear_id TEXT NOT NULL REFERENCES gear(id),
  inspected_on TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass','pass_with_concerns','fail')),
  inspector_name TEXT,
  notes TEXT,
  cert_photo_path TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_gear_inspections_gear ON gear_inspections(gear_id);
-- Partial index: lookups are always for active items due soon, never retired.
CREATE INDEX idx_gear_due ON gear(next_inspection_due) WHERE retired_at IS NULL;
```

**Invariants:**
- A row in `gear` with `retired_at IS NOT NULL` is read-only. Service-
  layer guards on `updateGear`, `logInspection`, `retireGear`.
- `inspection_interval_months >= 1`. Default 6. UI clamp to 1-24 to
  prevent absurd values.
- `result='fail'` flips the parent gear row to retired in the same
  transaction as the insert (see §5).
- `next_inspection_due` is `NULL` only if the item is retired; on every
  active item this column carries a date.

### 4.2 Supabase — `gear_catalog` table

```sql
CREATE TABLE gear_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer text NOT NULL,
  model text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'harness','helmet','rope','lanyard','sling',
    'descender','ascender','carabiner','pulley','other'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manufacturer, model)
);

ALTER TABLE gear_catalog ENABLE ROW LEVEL SECURITY;

-- Public-readable, no client writes. Inserts/updates happen via the
-- Supabase SQL editor (admin only) or a future moderated submission flow.
CREATE POLICY gear_catalog_select ON gear_catalog
  FOR SELECT TO authenticated USING (true);
```

Catalog rows are seeded by running an `INSERT` script generated from a
JSON list. The list itself is being produced separately via Claude
Deep Research targeting the manufacturer catalogs (Petzl, CMC, DMM,
BlueWater, Sterling, Beal, ISC, Singing Rock, Skylotec, Edelrid,
Heightec). The catalog data is **not on the critical path** — the app
ships and works correctly with an empty catalog; the dropdown just
shows no suggestions until rows are inserted.

### 4.3 Type additions

```ts
// src/types.ts additions
export type GearCategory =
  | 'harness' | 'helmet' | 'rope' | 'lanyard' | 'sling'
  | 'descender' | 'ascender' | 'carabiner' | 'pulley' | 'other';

export type GearInspectionResult = 'pass' | 'pass_with_concerns' | 'fail';

export interface GearItem {
  id: string;
  name: string;
  category: GearCategory;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  manufacture_date: string | null;
  first_use_date: string | null;
  retired_at: string | null;
  retirement_reason: string | null;
  inspection_interval_months: number;
  next_inspection_due: string | null;
  photo_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface GearInspection {
  id: string;
  gear_id: string;
  inspected_on: string;
  result: GearInspectionResult;
  inspector_name: string | null;
  notes: string | null;
  cert_photo_path: string | null;
  created_at: string;
}

export interface GearCatalogEntry {
  id: string;
  manufacturer: string;
  model: string;
  category: GearCategory;
}
```

## 5. Service layer

New file: `src/services/gearService.ts`. Factory function in the same
shape as `entriesService` — takes a `DbClient` and returns an object of
async methods.

```ts
export function createGearService(db: DbClient, uuid: UuidFn = generateId) {
  return {
    listGear(): Promise<GearItem[]>;            // ORDER BY retired_at NULLS FIRST, next_inspection_due ASC
    getGear(id: string): Promise<GearItem | null>;
    createGear(input: CreateGearInput): Promise<GearItem>;
    updateGear(id: string, input: UpdateGearInput): Promise<GearItem>;
    retireGear(id: string, reason: string): Promise<GearItem>;
    deleteGear(id: string): Promise<void>;       // only allowed for items with no inspection history

    listInspections(gearId: string): Promise<GearInspection[]>;
    logInspection(input: LogInspectionInput): Promise<GearInspection>;

    // Returns active items due within N days, sorted by due date.
    listDue(withinDays: number): Promise<GearItem[]>;
  };
}
```

**`createGear`** computes `next_inspection_due`:
```
nextDue = (first_use_date ?? manufacture_date ?? today)
        + inspection_interval_months months
```

**`logInspection`** is transactional:
```
BEGIN;
  INSERT INTO gear_inspections (...);
  IF result IN ('pass', 'pass_with_concerns'):
    UPDATE gear SET next_inspection_due = inspected_on + interval, updated_at = now() WHERE id = ?;
  ELSE  -- 'fail'
    UPDATE gear
       SET retired_at = inspected_on,
           retirement_reason = 'failed inspection',
           next_inspection_due = NULL,
           updated_at = now()
     WHERE id = ?;
COMMIT;
```

The split-write pattern from `signRequestsService.applyIncomingSignature`
(post-audit fix) is the reference — INSERT + UPDATE in one BEGIN/COMMIT
so a process kill can't leave the inspection row without the matching
state change on the gear item.

**`retireGear`** sets `retired_at`, `retirement_reason`, clears
`next_inspection_due`. Idempotent — calling on an already-retired item
is a no-op. Cancels scheduled OS notifications for the item (see §7).

**`deleteGear`** is hard delete (no soft-delete pattern in this app).
Refuses if any `gear_inspections` row exists; tells the user to retire
instead so the audit trail is preserved.

### 5.1 Catalog service

New file: `src/services/gearCatalogService.ts`. Thin wrapper:

```ts
export function createGearCatalogService(cloud: CloudClient) {
  return {
    fetchAndCache(): Promise<GearCatalogEntry[]>;   // Supabase SELECT, AsyncStorage write
    getCached(): Promise<GearCatalogEntry[]>;        // AsyncStorage read; returns [] if missing/stale
    refreshIfStale(maxAgeMs: number): Promise<void>; // refetch when cache is older than maxAge
  };
}
```

AsyncStorage key: `logbook:gear_catalog`. Stores `{ items, fetched_at }`.
Two-layer cache strategy: a foreground-check throttle of 12 hours
(don't even *consider* refreshing more often than that, regardless of
cache age) plus a staleness threshold of 7 days (only fetch from
Supabase when the cache is older than this). Effect: at most one
network call per week per device. The check runs on `AppState→active`
in App.tsx alongside the existing supervisor-connections / sign-
requests sync calls.

`CloudClient` interface gains one method: `listGearCatalog()`. The
runtime implementation (`supabaseClient.ts`) does an unfiltered
`SELECT * FROM gear_catalog`. The mock returns a stub list.

## 6. Notifications

Two new kinds added to the existing `NotificationKind` union in
`src/services/notificationCenterService.ts`:

- `gear_inspection_30d` — fired 30 days before an item's
  `next_inspection_due`.
- `gear_inspection_0d` — fired on the due date.

Payload shape: `{ gearId: string, name: string, dueOn: string }`.

### 6.1 OS-level scheduling

`expo-notifications` schedules per-item notifications. New helper in
`src/utils/notifications.ts`:

```ts
export async function scheduleGearInspectionNotifications(
  gear: GearItem,
): Promise<void>;
export async function cancelGearInspectionNotifications(
  gearId: string,
): Promise<void>;
```

Scheduled identifiers are deterministic per gear:
`gear-${gearId}-30d` and `gear-${gearId}-0d`. Re-scheduling cancels
the old IDs first so a moved due date doesn't leave stale alerts.

Calls to schedule fire in `gearService.createGear`,
`updateGear` (when interval or first_use_date changes the due date),
and `logInspection`. Cancellation fires in `retireGear`, `deleteGear`,
and at the start of every reschedule.

### 6.2 In-app bell

Foreground checks in `App.tsx::recordForegroundReminders` extend to
include gear:

```ts
// pseudo-code added alongside the existing cert_expiry checks
const dueWithin30 = await gearService.listDue(30);
for (const item of dueWithin30) {
  const dueDate = new Date(item.next_inspection_due!);
  const daysUntil = ...;
  const kind = daysUntil <= 0 ? 'gear_inspection_0d' : 'gear_inspection_30d';
  await notif.record({
    kind,
    payload: { gearId: item.id, name: item.name, dueOn: item.next_inspection_due },
    dedupeOnDay: true,
  });
}
```

`dedupeOnDay: true` keeps the bell from accumulating multiple rows for
the same item on the same day across foreground transitions.

NotificationsScreen needs a row renderer for the two new kinds: tapping
a `gear_inspection_*` row navigates to GearDetailScreen for that item.

## 7. Cloud sync

### 7.1 Snapshot extension

`CloudSnapshot` (in `src/types.ts`) gains two arrays:

```ts
gear: GearItem[];
gear_inspections: GearInspection[];
```

`cloud_schema_version` bumps from 2 to 3. `MAX_CLOUD_SCHEMA_VERSION` in
`restoreService.ts` bumps to 3. `restoreService` is updated to
re-create the new tables in the same DELETE-then-INSERT transaction
that already handles entries / signatures / profile.

Snapshots from cloud_schema_version 2 (pre-feature) are accepted by
restore — the new tables come back empty. Snapshots from version 3 fail
the version-too-new check on a pre-feature client (the existing
fence already handles this).

### 7.2 Asset keys

Two new asset key conventions in `cloudBackupService.ts`:

- `assets/gearphoto_{gear_id}.{ext}` — for `gear.photo_path`
- `assets/inspcert_{inspection_id}.{ext}` — for `gear_inspections.cert_photo_path`

Both follow the photos-in-backup gate that already governs entry
photos. Same path-normalization rules apply (relative form in the
snapshot, absolute on-device, rehydrate on restore).

`restoreService.storageKeyToRelativePath` extends to recognise the two
new prefixes and write the bytes to the path the DB row references —
mirroring the photo round-trip invariant locked in by the recent audit
test.

### 7.3 Backup service deltas

`cloudBackupService.doBackup` extends the asset-collection loop to walk
gear photos and inspection-cert photos when `photos_in_backup` is on.
Manifest cleanup logic continues to handle orphans automatically —
deleting a gear item with `deleteGear` (or a retired item) removes the
asset from the next backup's manifest, and the existing cleanup path
deletes the orphan from cloud Storage.

## 8. UI surface

Five new screens, all stack-pushed (no tab change):

| Screen | Purpose |
|---|---|
| `GearScreen` | List of all gear, sorted by due date; "+ Add gear"; retired items below a divider |
| `GearDetailScreen` | Header (name, photo, badges), inspection history list, "Log inspection" / "Retire" / "Edit" CTAs |
| `AddGearScreen` | Form for creating an item; catalog autocomplete on Make/model |
| `EditGearScreen` | Same form, hydrated from existing item |
| `LogInspectionScreen` | Form for inspection record |

Entry points:
- **MeScreen**: new "Gear" row above "Supervisors" → navigates to GearScreen.
- **DashboardScreen**: new conditional card "N items due for inspection"
  when `gearService.listDue(30).length > 0` → tap → GearScreen.
- **NotificationsScreen**: tapping a `gear_inspection_*` row → GearDetailScreen.

### 8.1 Catalog autocomplete UX

Inside AddGearScreen / EditGearScreen, the Make/model field is a single
free-text input. On every keystroke past 2 characters:

1. In-memory `Array.filter` against the cached catalog.
2. Filter: `(item.manufacturer + ' ' + item.model).toLowerCase().includes(query.toLowerCase())`.
3. Render up to 8 matches as an absolute-positioned dropdown beneath
   the input.
4. Tapping a match writes `manufacturer` + `model` (and `category` if
   not yet set) into form state.
5. Empty cache or zero matches → no dropdown (free-form continues).

Catalog cache is loaded once at screen mount via `getCached()`; refresh
happens elsewhere (App.tsx foreground listener), not gated on this UI.

### 8.2 New stack routes

```ts
// RootStackParamList additions
GearList: undefined;
GearDetail: { gearId: string };
AddGear: undefined;
EditGear: { gearId: string };
LogInspection: { gearId: string };
```

Standard light-theme stack header for all of them.

## 9. Backward compatibility

- Pre-migration databases get the two new tables via the idempotent
  `runSchemaMigrations` pass.
- `Profile` and `Entry` types are unchanged.
- Snapshots from pre-feature clients (cloud_schema_version 2) restore
  cleanly; gear tables come back empty.
- Snapshots from feature-enabled clients fail the version-too-new gate
  on pre-feature clients — same protection that exists today.
- The catalog table can ship to production unseeded; the autocomplete
  is silently empty until rows are inserted.

## 10. Testing

New unit-test files mirroring the existing service-test pattern:

- `__tests__/services/gearService.test.ts`:
  - createGear computes next_inspection_due from first_use_date
  - falls back to manufacture_date, then today
  - logInspection (pass) advances next_inspection_due by interval
  - logInspection (fail) flips item to retired in same transaction
  - logInspection rolls back BOTH writes if the gear_inspections INSERT
    fails (mirror the `applyIncomingSignature` rollback test that uses
    a pre-seeded PK collision to force the failure path)
  - retireGear cancels scheduled notifications + clears due date
  - listDue returns only active items within window, sorted asc
  - deleteGear refuses when inspections exist
  - listGear sort order: active by due date, retired below
- `__tests__/services/gearCatalogService.test.ts`:
  - fetchAndCache writes to AsyncStorage
  - getCached returns [] when missing
  - refreshIfStale honours maxAge
- `__tests__/services/restoreService.test.ts` (extend):
  - cloud_schema_version 2 snapshot restores with empty gear tables
  - round-trip: backup → wipe → restore preserves gear and inspections
  - photo paths for `gearphoto_*` and `inspcert_*` write to entry-row
    target paths (mirrors the existing photo round-trip invariant)
- `__tests__/services/notificationCenterService.test.ts` (extend):
  - new kinds dedupe on (kind+gearId+day)

No UI-level tests — matches existing convention.

## 11. Out of scope (for this spec)

These are intentionally deferred:

- **Inspection checklists** — category-specific inspection forms
  (decision in §2). The minimal record is enough for v1.
- **User-submitted catalog additions** — admins seed the catalog via
  the SQL editor for now. A moderated submission flow is a future
  feature.
- **Multi-photo per item** — gear has a single photo; inspections have
  a single cert photo. Multi-photo can come later if users ask.
- **Pre-use checks** — daily / per-shift checklists are part of the
  tech's routine, not the app's job.
- **Service-life retirement automation** — the textile vs metal
  retirement-date logic (10 years from manufacture for textiles, etc.)
  is intentionally not modelled. Manual retirement and inspection-
  result-driven retirement cover the audit-relevant cases.
- **Gear sharing / team inventory** — every gear item belongs to one
  technician; team-level inventory is its own product.
- **Manufacturer recall awareness** — would require a recall feed;
  not in scope.

## 12. Migration ordering and rollout

1. **Migration**: client-side `runSchemaMigrations` adds the two
   SQLite tables (idempotent guards), bumps `cloud_schema_version`
   constant, updates `MAX_CLOUD_SCHEMA_VERSION` in `restoreService`.
2. **Supabase migration** (separate `supabase/migrations/` SQL file):
   creates `gear_catalog` table + RLS policy.
3. **Catalog seed** (separate, non-blocking): the JSON list produced
   by Deep Research is wrapped in an INSERT script and run in the
   Supabase SQL editor. Can happen before or after the app code ships
   — the app degrades cleanly to free-form when the catalog is empty.
4. **App code** ships: services, screens, navigation, notifications.
5. Existing cloud users keep working — their old snapshots restore
   cleanly into the new schema with empty gear tables.
