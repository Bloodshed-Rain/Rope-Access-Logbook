# Rope Access Logbook

A mobile app (iOS & Android) that replaces the paper SPRAT work-experience logbook for rope access technicians. Log hours, capture supervisor signatures on-screen, and export a professional PDF for re-certification.

## Features

- **Offline-first** -- works without signal at remote job sites
- **SPRAT-style log entries** -- date, site, employer, client, work hours, type of work, description
- **On-screen supervisor signing** -- supervisor draws signature on the tech's device, captured with name and Level III cert number
- **Tamper-evident** -- every signed entry is SHA-256 hashed; any post-signing modification is detectable
- **Immutable signed entries** -- corrections are made via amendments, preserving the original record
- **PDF export** -- cover page, entry pages with signature blocks, summary page with amendment log
- **JSON backup** -- full round-trippable data export for safekeeping
- **Optional cloud backup** (Supabase) -- sign in with Apple, Google, or email magic link; auto-backup after signing; restore to a new device; always opt-in
- **Backup reminders** -- monthly nudge if you haven't exported, post-signing nudge if backup is stale
- **Cert expiry warnings** -- amber at 60 days, red when expired
- **Glove-friendly UI** -- 48-56px touch targets, high contrast, industrial color palette

## Tech Stack

- **React Native + Expo** (TypeScript)
- **SQLite** via `expo-sqlite` (local-first)
- **React Query** (`@tanstack/react-query`) for data access
- **React Navigation** (bottom tabs + native stack)
- **Supabase** (`@supabase/supabase-js`) for opt-in cloud backup (auth + storage)
- **expo-auth-session** / **expo-web-browser** for OAuth
- **expo-print** / **expo-sharing** for PDF export
- **react-native-signature-canvas** for signature capture
- **expo-crypto** for SHA-256 hashing and UUID generation
- **Lucide** icons

## Getting Started

### Prerequisites

- Node.js 18+
- [Expo Go](https://expo.dev/go) on your iOS or Android device

### Install & Run

```bash
git clone <repo-url>
cd rope-access-logbook
npm install
cp .env.example .env   # fill in SUPABASE_URL and SUPABASE_ANON_KEY for cloud backup
npx expo start
```

Scan the QR code with Expo Go on your phone. The app works without Supabase credentials — only the optional cloud backup feature requires them.

### Run Tests

```bash
npx jest
```

92 tests across 12 suites covering all service-layer logic (profile, entries, signing, local backup, export, cloud backup, restore, auth, path normalization, schema migration, v1→v2 hash migration, canonical serialization).

## Project Structure

```
src/
  types.ts              # All TypeScript types
  constants.ts          # APP_VERSION
  config.ts             # Env-var loader (Supabase URL/key)
  db/                   # SQLite schema, DbClient interface, migrations, initialization
  services/             # Domain logic (profile, entries, signing, backup, export, auth, cloudBackup, restore)
  cloud/                # CloudClient interface, Supabase runtime, FileSystem abstraction
  utils/                # Canonical serialization, SHA-256 hash, path normalization, file storage, UUID
  hooks/                # React Query hooks wrapping services (incl. useBackup, useRestore, useAuthSession)
  theme/                # Design tokens (colors, spacing, typography) + ThemeProvider
  primitives/           # Reusable UI components (Button, Input, Card, Badge, etc.)
  components/           # Composite components (ProfileCloudSection, DeleteAccountModal)
  screens/              # App screens (Onboarding, Logbook, EntryForm, Signature, EntryDetail, Profile, Auth, MagicLinkWait, CloudConflict)
  navigation/           # Tab + stack navigator with onboarding gate
  templates/            # HTML/CSS templates for PDF export
__tests__/
  services/             # TDD tests for all services (using better-sqlite3)
  db/                   # Schema migration and v1→v2 hash migration tests
  utils/                # Tests for canonical serialization and path normalization
  cloudMock.ts, fsMock.ts  # Test doubles for CloudClient and FileSystem abstraction
```

## Design

SPRAT / industrial rope access aesthetic:

- **SPRAT Blue** (#003366) -- headers, tab bar, selected chips
- **Safety Orange** (#FF6600) -- primary CTA buttons
- **IRATA Red** (#C8102E) -- errors, amendments
- **Steel Gray** (#4A4A4A) -- body text
- **Concrete Light** (#F2F2F2) -- backgrounds

Designed for outdoor use: high contrast, large touch targets, minimal typing.

## Roadmap

### Phase B -- Connected Team
- Supervisor accounts with remote signing
- Cryptographic signing with key pairs (true non-repudiation)
- Multi-device sync (live, not just backup/restore)

### Phase C -- Full Product
- Org/company accounts with admin roles
- Push notifications for pending signatures
- Hour milestone tracking for level upgrades
- Dark mode
- Saved templates for common entries

## License

Private -- all rights reserved.
