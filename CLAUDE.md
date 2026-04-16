# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Rope Access Logbook — an offline-first mobile app (iOS + Android) that replaces the paper SPRAT work-experience logbook for rope access technicians. MVP is local-only: one user, one device, no backend, no accounts.

Design spec: `docs/superpowers/specs/2026-04-15-rope-access-logbook-design.md`
Implementation plan: `docs/superpowers/plans/2026-04-15-rope-access-logbook.md`

## Commands

All commands run from project root.

```bash
# Dev server
npx expo start

# Platform-specific
npx expo start --ios
npx expo start --android

# Tests (uses jest-expo preset with better-sqlite3 for in-memory DB)
npx jest
npx jest __tests__/services/entriesService.test.ts   # single file
npx jest --testNamePattern="creates a draft entry"    # single test

# Type check
npx tsc --noEmit
```

## Architecture

### Stack
React Native + Expo SDK 54 (managed workflow), TypeScript, expo-sqlite for local persistence, @tanstack/react-query v5 for data access, @react-navigation (bottom-tabs + native-stack), lucide-react-native for icons, react-native-signature-canvas for supervisor signatures, expo-print for PDF generation.

### Three-layer structure (`src/`)

1. **Persistence** (`db/`) — `DbClient` interface (`client.ts`) abstracts SQLite access. `expoClient.ts` is the runtime implementation (expo-sqlite); tests use `better-sqlite3` in-memory via `__tests__/setup.ts`. Schema lives in `schema.ts` (3 tables: `profile`, `entries`, `signatures`).

2. **Services** (`services/`) — Pure business logic that accepts a `DbClient`. Each service is a set of functions, not a class. Key invariants:
   - Signed entries are immutable — mutations must fail at the service layer, not just be hidden in UI.
   - Editing a signed entry creates an amendment (new entry with `amends_entry_id` pointing to the original).
   - Canonical entry serialization (for SHA-256 hashing at signing time) is in `utils/canonical.ts` — sorted keys, normalized whitespace, excludes `created_at`/`updated_at`.
   - `tech_level_snapshot` is set once at entry creation and never updated.

3. **UI** (`primitives/`, `screens/`, `navigation/`, `theme/`, `hooks/`) — Screens compose from a fixed set of themed primitives (`Screen`, `Button`, `Input`, `Card`, `Badge`, `Banner`, `Chip`, `ListRow`, `EmptyState`, etc.). No raw style rules outside primitives. Design tokens in `theme/tokens.ts` (4px spacing base, safety-orange accent, navy chrome). React Query hooks in `hooks/` wrap service calls.

### Navigation
`RootNavigator.tsx` — if no profile exists, shows Onboarding; otherwise shows bottom tabs (Logbook, Profile) with stack screens for EntryForm, EntryDetail, and Signature.

### Testing
Tests in `__tests__/` use real SQLite (better-sqlite3 in-memory), not mocks. `__tests__/setup.ts` provides `createTestClient()`. `__tests__/testHash.ts` provides a Node.js crypto SHA-256 implementation (mirroring expo-crypto in production).

### PDF Export
HTML templates in `src/templates/` (cover page, entry page, summary page) rendered via expo-print. Shared CSS in `pdfStyles.ts`.

### File storage convention
All images (photos, signatures, SPRAT card) are copied to `FileSystem.documentDirectory/logbook/` and the DB stores app-scoped paths. Never reference camera-roll or content:// URIs.

## Key domain concepts

- **Entry statuses**: `draft` (editable), `signed` (immutable, has signature + hash), `amended` (original that has a signed amendment).
- **Amendment chain**: Amending a signed entry creates a new draft with `amends_entry_id` set. Both entries remain in the logbook. Signed amendments lock the chain; draft amendments can be deleted.
- **Tamper detection**: SHA-256 hash of canonical entry content stored in `signatures.entry_hash`. Re-verified on entry detail load. Not cryptographic non-repudiation — same trust model as paper.
- **Backup reminders**: App tracks `profile.last_backup_at`. Banner shown if >30 days since last export; toast nudge if >7 days after signing.
- **Work types**: Multi-select from a fixed set defined in `types.ts` (`inspection`, `ndt`, `welding`, `painting`, `window_cleaning`, `rescue`, `training`, `rigging`, `other`).
