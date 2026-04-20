# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the app code. Use `src/screens/` for route-level UI, `src/components/` for composite UI, `src/primitives/` for reusable building blocks, `src/hooks/` for React Query wrappers, `src/services/` for domain logic, `src/db/` for SQLite schema and migrations, and `src/cloud/` for Supabase and file-system abstractions. Tests live under `__tests__/` and mirror the service/db/utils split. Supabase SQL and Edge Functions live in `supabase/`. Static assets are in `assets/`, and implementation notes/specs are in `docs/superpowers/`.

## Build, Test, and Development Commands

Run from the repository root:

- `npm install` installs dependencies.
- `npx expo start` starts the Expo dev server.
- `npx expo start --android` runs the Android target.
- `npx expo start --ios` runs the iOS target.
- `.\node_modules\.bin\jest.cmd --runInBand` runs the full Jest suite reliably on Windows PowerShell.
- `npx jest __tests__/services/entriesService.test.ts` runs a focused test file.
- `npx tsc --noEmit` runs a TypeScript check.

## Coding Style & Naming Conventions

This codebase uses TypeScript with 2-space indentation and semicolons. Prefer named exports and factory functions such as `createEntriesService`. Use `PascalCase` for screens/components, `camelCase` for functions and hooks, and `*.test.ts` for tests. Keep domain rules in `src/services/`; UI should consume hooks/services rather than embed business logic. There is no committed lint config, so match the surrounding file style closely.

## Testing Guidelines

Jest with `jest-expo` is the test framework. Add or update tests for service, migration, hash, and remote-signing changes. Keep new tests beside the relevant area under `__tests__/services`, `__tests__/db`, or `__tests__/utils`. Prefer deterministic tests using the existing mocks in `__tests__/cloudMock.ts`, `__tests__/fsMock.ts`, and the in-memory DB setup.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit style, for example `feat(signrequest): ...`, `fix(signrequest): ...`, and `test(e2e): ...`. Continue using `type(scope): summary` with a narrow scope. PRs should state the user-visible change, note schema or Supabase impacts, link the relevant issue/spec when applicable, and include screenshots for screen/UI changes. Do not merge without passing tests.

## Security & Configuration Tips

Root `.env` supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Never commit secrets. Client code must not embed service-role credentials; those belong only in deployed Supabase function secrets.
