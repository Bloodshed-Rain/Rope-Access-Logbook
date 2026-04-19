# Rope Access Logbook

A mobile app (iOS & Android) that replaces the paper SPRAT work-experience logbook for rope access technicians. Log hours, capture supervisor signatures on-screen, and export a professional PDF for re-certification.

## Features

- **Offline-first** -- works without signal at remote job sites
- **SPRAT-style log entries** -- date range, site, employer, client, work hours, type of work, description
- **On-screen supervisor signing** -- supervisor draws signature on the tech's device, captured with name and Level III cert number
- **Remote signing** -- send entries to a connected Level III supervisor for review and signature on their own device
- **Supervisor accounts** -- any Level III tech can opt in, appear in the searchable directory, receive sign requests from connected techs
- **Tamper-evident** -- every signed entry is SHA-256 hashed (v1/v2/v3 algorithms); any post-signing modification is detectable
- **Immutable signed entries** -- corrections are made via amendments, preserving the original record
- **PDF export** -- cover page, entry pages with signature blocks, summary page with amendment log
- **JSON backup** -- full round-trippable data export for safekeeping
- **Optional cloud backup** (Supabase) -- sign in with Apple, Google, or email magic link; auto-backup after signing; restore to a new device; conflict resolution; always opt-in
- **Backup reminders** -- monthly nudge if you haven't exported, post-signing nudge if backup is stale
- **Cert expiry warnings** -- amber at 60 days, red when expired
- **Glove-friendly UI** -- 48-56px touch targets, high contrast, industrial color palette

## Tech Stack

- **React Native + Expo** (TypeScript)
- **SQLite** via `expo-sqlite` (local-first)
- **React Query** (`@tanstack/react-query`) for data access
- **React Navigation** (bottom tabs + native stack)
- **Supabase** (`@supabase/supabase-js`) for cloud backup (auth + storage) and supervisor accounts (Postgres + Realtime)
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

132 tests across 17 suites covering all service-layer logic (profile, entries, signing, local backup, export, cloud backup, restore, auth, supervisor connections, sign requests, remote sign round-trip, path normalization, schema migration, hash migration, canonical serialization).

## Project Structure

```
src/
  types.ts              # All TypeScript types
  constants.ts          # APP_VERSION
  config.ts             # Env-var loader (Supabase URL/key)
  db/                   # SQLite schema, DbClient interface, migrations, initialization
  services/             # Domain logic (profile, entries, signing, backup, export, auth, cloudBackup, restore, supervisorConnections, signRequests)
  cloud/                # CloudClient interface, Supabase runtime, FileSystem abstraction
  utils/                # Canonical serialization, SHA-256 hash, path normalization, file storage, UUID, entry payload hash
  hooks/                # React Query hooks wrapping services (incl. useBackup, useRestore, useAuthSession, useSupervisorConnections, useSignRequests)
  theme/                # Design tokens (colors, spacing, typography) + ThemeProvider
  primitives/           # Reusable UI components (Button, Input, Card, Badge, etc.)
  components/           # Composite components (ProfileCloudSection, DeleteAccountModal, SupervisorsSection)
  screens/              # App screens (Onboarding, Logbook, EntryForm, Signature, EntryDetail, Profile, Auth, MagicLinkWait, CloudConflict, Inbox, SupervisorSearch, SignRequestDetail)
  navigation/           # Tab + stack navigator with onboarding gate + conditional Inbox tab
  templates/            # HTML/CSS templates for PDF export
__tests__/
  services/             # TDD tests for all services including remote sign round-trip (using better-sqlite3)
  db/                   # Schema migration and hash migration tests
  utils/                # Tests for canonical serialization and path normalization
  cloudMock.ts, fsMock.ts  # Test doubles for CloudClient and FileSystem abstraction
  testHash.ts           # Node crypto mirror of expo-crypto SHA-256
```

## Design

SPRAT / industrial rope access aesthetic:

- **SPRAT Blue** (#003366) -- headers, tab bar, selected chips
- **Safety Orange** (#FF6600) -- primary CTA buttons
- **IRATA Red** (#C8102E) -- errors, amendments
- **Steel Gray** (#4A4A4A) -- body text
- **Concrete Light** (#F2F2F2) -- backgrounds

Designed for outdoor use: high contrast, large touch targets, minimal typing.

## Not Yet Implemented

- Server-side plumbing for supervisor accounts (rate-limited search, request expiry, asset cleanup, account deletion cascade)
- Cryptographic keypair signing (true non-repudiation)
- Live multi-device sync
- Org / company accounts with admin roles
- Push notifications for pending signatures
- Hour milestone tracking for level upgrades
- Dark mode
- Saved entry templates
- Entry-logging enhancements (visible back navigation, form auto-save)

## License

Private -- all rights reserved.
