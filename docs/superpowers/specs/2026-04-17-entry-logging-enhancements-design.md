# Entry logging enhancements — design

**Status:** approved 2026-04-17
**Scope:** single feature branch, sits on top of `feature/cloud-backup` after merge
**Dependencies:** schema migration infrastructure (`src/db/migrations.ts`) and hash versioning (`src/services/signingService.ts`) already in place from the cloud-backup plan.

## Problem

Three friction points in the current entry form:

1. One entry = one calendar date. Technicians often do the same kind of work for days or weeks (e.g., two-week shutdown on a plant); today that means creating fourteen nearly identical entries.
2. "Other" is an opaque work-type chip with no way to say *what* the other work was.
3. "Save as draft" requires every field to be filled. Users can't capture partial data mid-job and come back later.

Additional UX issue surfaced during review: several screens (`EntryForm`, `EntryDetail`, `Signature`, `Onboarding`, etc.) have no visible back button and no cue that iOS edge-swipe navigation exists.

## Goals

- An entry can span a date range (`date_from` → `date_to`) with a single `work_hours` total across the span.
- Selecting the "Other" work-type chip reveals an inline text field for describing the work.
- Any entry can be saved at any level of completeness; signing is what enforces a minimum viable work record.
- Back navigation is visible and obvious on every screen that pushes onto a stack.

## Non-goals

- Splitting a range into N individual entries (we rejected this — option A in brainstorming was chosen).
- Adding a custom free-text *category* alongside the fixed work-type list (rejected — just `other_work_description`).
- Re-signing or migrating existing v2-signed entries to the new hash algorithm.

## Design

### 1. Form behavior

- "Save" button is always enabled. No client-side required-field gate.
- Each of the four sign-required fields (`date_from`, `date_to`, `work_hours`, `description`) gets a subtle "*needed to sign*" cue below its label so users understand what a complete, signable record looks like without being blocked from saving.
- Validation lives in `signingService.signEntry()`, not in the form. Error surfaces on the Signature screen as a pre-flight message.

### 2. Date pickers

- Two native date pickers via `@react-native-community/datetimepicker`: "From" and "To".
- Default: both = today. Single-day entries are a range where `date_from === date_to`.
- No calendar library dependency.

### 3. "Other" custom text

- When the "Other" chip is selected, an `Input` appears directly beneath the chip row (placeholder: *"Describe the work"*).
- Text stored in a new `other_work_description TEXT` column on `entries`. `NULL` when "Other" is not selected or the field is empty.

### 4. Signing validation

- `signEntry()` rejects if any of the four required fields is empty:
  - `date_from` null/empty
  - `date_to` null/empty
  - `work_hours <= 0`
  - `description` null or whitespace-only
- Error code: `'missing_required'`. UI translates to "Fill in dates, hours, and a description before signing."
- All other fields (`employer`, `site`, `client`, `work_types`, `equipment_notes`, `weather`, `photos`, `other_work_description`) are optional at sign time.

### 5. Navigation affordance

- Flip the app-wide default on the root `Stack.Navigator` from `headerShown: false` to `headerShown: true`.
- Per-screen titles via `options={{ title: '...' }}`.
- Modal presentations (`EntryForm`) get a "Close" header button (left side) instead of the inherited back chevron.
- This single change makes iOS edge-swipe-back discoverable (users see the `<` cue) and gives Android users an explicit back target.
- Tab-navigator screens (Logbook, Profile) keep their own headerless layout — no change there.

### 6. Data model

- **Domain type (`Entry`)** — adds `date_from: string`, `date_to: string`, `other_work_description: string | null`. Removes `date` from the domain type so new code never reads it.
- **DB row type (`EntryRow`)** — keeps the legacy `date` column so existing v2 hashes remain verifiable. New writes set `date = date_from` to keep the column populated for any remaining legacy readers.
- **New hash input for v3** — `entryRowToHashInputV3(row)` uses `date_from`, `date_to`, `other_work_description` in place of `date`; other fields unchanged from v2.

### 7. Hash versioning

- `CURRENT_HASH_VERSION = 3`. v2 stays frozen (same policy as v1 was frozen after v2 shipped).
- Existing v2-signed entries continue to verify against their v2 hash algorithm (`entryRowToHashInputV2`).
- New signings compute and store a v3 hash.
- No forced migration, no re-signing required.

### 8. Cloud backup/restore

- Bump `CLOUD_SCHEMA_VERSION` from 1 → 2.
- `restoreService.restore()` gains a back-compat branch: when importing a v1 snapshot (which lacks `date_from`/`date_to`), backfill `date_from = date_to = snapshot.date` on each row before insert.
- Forward-compat: a v2 snapshot imported by a v1-era client already returns `version_too_new` via the existing guard — no change needed there.

### 9. PDF templates

- Entry page: render `date_from` when `date_from === date_to`, otherwise `date_from → date_to`.
- Work-type line appends `(Other: <text>)` when `work_types` contains `'other'` AND `other_work_description` is non-null. If `'other'` is not selected, the column is ignored by both the PDF and the form display (rendered only on-save state, not stripped on unselect — keeps the text if the user re-selects "Other" later).

## Migration

- **Schema migration** — idempotent `ALTER TABLE ADD COLUMN` guarded by the existing `hasColumn()` helper in `src/db/migrations.ts`. Adds `date_from`, `date_to`, `other_work_description`. Runs on `initializeDatabase()` startup.
- **Backfill** — single `UPDATE entries SET date_from = date, date_to = date WHERE date_from IS NULL`. Idempotent; only touches unmigrated rows.
- **No code path depends on `date` for reads** after migration; domain type omits it, hashes use v3, form uses the range. The column persists solely so v2 hashes of old signed entries remain verifiable.

## Testing strategy

All tests use the existing TDD pattern — real SQLite via `better-sqlite3` in-memory, fixtures in `__tests__/`.

- **`entriesService.test.ts`** — create entry with only `date_from`/`date_to` filled (rest null) succeeds; create fully-blank draft succeeds; create entry with `other_work_description` persists it; update entry to clear the field back to null works.
- **`signingService.test.ts`** — signing fails with `'missing_required'` for each of the four required fields being missing; signing succeeds with just the four required fields filled and everything else null; new signings are stamped `hash_version = 3`.
- **`hashMigration.test.ts`** (existing) — no regressions; a pre-existing v2-signed entry still verifies after the schema change.
- **`dateRangeMigration.test.ts`** (new) — existing row with `date = '2026-04-01'` gets `date_from = date_to = '2026-04-01'` after migration; second migration run is a no-op; rows that already have `date_from` set are untouched.
- **`restoreService.test.ts`** — restoring a v1 cloud snapshot populates `date_from = date_to = snapshot.date`; restoring a v2 snapshot passes `date_from`/`date_to` through unchanged.

Existing tests that construct entry fixtures with only `date` get updated to include `date_from`/`date_to` as part of the change.

## Rollout

- Ships on a single feature branch, merged after review.
- No feature flag — the schema migration and new form are both live as soon as the build lands on a device.
- Existing users: their entries are backfilled on next app launch; their signed entries keep verifying.

## Open questions

None — all four clarifying questions resolved in brainstorming (options A, D, A, A).
