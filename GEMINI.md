# GEMINI.md

## Project Overview

**Rope Access Logbook (RALB)** is an offline-first mobile application (iOS & Android) designed for SPRAT-certified rope access technicians. It replaces traditional paper work-experience logbooks, allowing technicians to log hours, capture on-screen supervisor signatures, and export professional PDF reports for re-certification.

### Core Technologies
- **Frontend:** React Native + Expo (TypeScript).
- **Local Persistence:** SQLite via `expo-sqlite` (using a custom `DbClient` abstraction).
- **State Management:** React Query (`@tanstack/react-query`) for data fetching and caching.
- **Cloud Backend:** Supabase (Auth, Storage for backups, Postgres for supervisor directory/connections, Realtime for notifications, and Edge Functions).
- **Testing:** Jest with `jest-expo` and `better-sqlite3` (for in-memory service-layer testing).
- **UI/UX:** Custom primitive-based design system with high-contrast, industrial aesthetic ("Safety Orange", "SPRAT Blue", "IRATA Red").

### Architecture
The project follows a strict three-layer architecture:
1.  **Persistence (`src/db/`):** Defines the SQLite schema and migrations. The `DbClient` interface abstracts the underlying database engine.
2.  **Services (`src/services/`):** Domain logic implemented as pure factory functions. Services handle CRUD, signing, integrity verification, and cloud synchronization.
3.  **UI (`src/screens/`, `src/components/`, `src/primitives/`, `src/hooks/`):** React components and hooks. Screens are composed of reusable primitives. React Query hooks in `src/hooks/` wrap service calls to manage UI state.

---

## Building and Running

### Development Commands
All commands should be run from the repository root:
- `npm install` - Install dependencies.
- `npx expo start` - Start the Expo development server.
- `npx expo start --ios` / `npx expo start --android` - Run on a specific platform.
- `cp .env.example .env` - Set up environment variables (requires `SUPABASE_URL` and `SUPABASE_ANON_KEY`).

### Testing
- `npx jest` - Run the full test suite (130+ tests).
- `npx jest __tests__/services/entriesService.test.ts` - Run a specific test file.
- `.\node_modules\.bin\jest.cmd --runInBand` - Reliable execution on Windows PowerShell.

### Supabase Management
- `supabase db push` - Apply migrations to the Supabase Postgres instance.
- `supabase functions deploy [function-name] --no-verify-jwt` - Deploy Edge Functions.

---

## Development Conventions

### Coding Style
- **Indentation:** 2 spaces.
- **Formatting:** Semicolons required.
- **Patterns:** Prefer named exports and factory functions (e.g., `createEntriesService`).
- **Naming:** `PascalCase` for Screens/Components, `camelCase` for functions/hooks, and `*.test.ts` for tests.
- **Indirection:** UI must consume logic through Hooks and Services; avoid embedding business logic directly in components.

### Integrity & Hashing
- **Tamper-Evidence:** Signed entries are hashed using SHA-256. The hashing logic uses `canonicalize` (`src/utils/canonical.ts`) to ensure deterministic output across devices.
- **Hash Versions:** The app supports multiple hash versions (v1, v2, v3). v2+ uses relative paths to ensure hashes remain valid after cloud restore.

### Cloud Synchronization
- **Backup:** Triggered on app backgrounding, post-signing, or manually. It uses a delta-upload strategy with a manifest to minimize bandwidth.
- **Restore:** Whole-logbook replacement (not a merge). Conflicts are handled via an explicit "Scenario C" resolution screen.

### Supervisor Accounts
- Uses Postgres tables in Supabase (`supervisor_connections`, `sign_requests`) for relational features.
- Remote signing allows supervisors to sign entries on their own devices.

---

## Key Files & Directories

- `src/db/schema.ts`: The canonical SQLite schema definition.
- `src/types.ts`: Centralized TypeScript type definitions.
- `src/services/`: Core domain logic (Entries, Signing, Profile, Backup).
- `src/hooks/`: React Query wrappers for all service operations.
- `src/utils/canonical.ts`: Load-bearing serialization for integrity hashing.
- `docs/superpowers/specs/`: Detailed design specifications for major features.
- `__tests__/services/`: Exhaustive TDD suites for all business logic.

---

## Known Constraints
- **Signed Immutability:** Once an entry is signed, it cannot be edited or deleted. Changes must be made via `amendments`.
- **Environment:** Supabase credentials are required for cloud features but the app is fully functional offline without them.
- **Type Checking:** `npx tsc --noEmit` is the source of truth for types; note that the `supabase/` folder is excluded from the main app's tsconfig as it uses Deno.
