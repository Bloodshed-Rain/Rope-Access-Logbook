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
- **Backup reminders** -- monthly nudge if you haven't exported, post-signing nudge if backup is stale
- **Cert expiry warnings** -- amber at 60 days, red when expired
- **Glove-friendly UI** -- 48-56px touch targets, high contrast, industrial color palette

## Tech Stack

- **React Native + Expo** (TypeScript)
- **SQLite** via `expo-sqlite` (local-only, no backend)
- **React Query** (`@tanstack/react-query`) for data access
- **React Navigation** (bottom tabs + native stack)
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
npx expo start
```

Scan the QR code with Expo Go on your phone.

### Run Tests

```bash
npx jest
```

48 tests across 6 suites covering all service-layer logic (profile, entries, signing, backup, export, canonical serialization).

## Project Structure

```
src/
  types.ts              # All TypeScript types
  db/                   # SQLite schema, DbClient interface, initialization
  services/             # Domain logic (profile, entries, signing, backup, export)
  utils/                # Canonical serialization, SHA-256 hash, file storage, UUID
  hooks/                # React Query hooks wrapping services
  theme/                # Design tokens (colors, spacing, typography) + ThemeProvider
  primitives/           # Reusable UI components (Button, Input, Card, Badge, etc.)
  screens/              # App screens (Onboarding, Logbook, EntryForm, Signature, EntryDetail, Profile)
  navigation/           # Tab + stack navigator with onboarding gate
  templates/            # HTML/CSS templates for PDF export
__tests__/
  services/             # TDD tests for all services (using better-sqlite3)
  utils/                # Tests for canonical serialization
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
- Supabase backend (auth + sync)
- Supervisor accounts with remote signing
- Cryptographic signing with key pairs (true non-repudiation)
- Multi-device sync

### Phase C -- Full Product
- Org/company accounts with admin roles
- Push notifications for pending signatures
- Hour milestone tracking for level upgrades
- Dark mode
- Saved templates for common entries

## License

Private -- all rights reserved.
