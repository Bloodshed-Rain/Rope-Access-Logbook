# Light-theme Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the industrial dark UI with a calm light-theme design (cream + deep red + Inter), restructure navigation to Today/Records/Me + conditional Inbox, add role pick at signup, gate the app behind a $2.99/mo subscription with 7-day free trial, and add an in-app notification center.

**Architecture:** One feature branch, one PR (big-bang). Phases A–F land as separate commits but ship together. Services and DB are mostly preserved; only additive changes (new `notifications` table, `subscription_tier` → `subscription_status` rename). Industrial primitives, Mono/Michroma fonts, and Pro-gate code are deleted in Phase F after every screen has been migrated.

**Tech Stack:** React Native (Expo SDK 51), TypeScript, expo-sqlite, React Query, RevenueCat, Supabase, Inter font, expo-notifications.

**Spec:** `docs/superpowers/specs/2026-04-30-light-theme-redesign-design.md`

**Branch:** continue on `feature/supervisor-accounts` (already 15 commits ahead of origin); the spec commit `ecb3d6b` is the kickoff point.

---

## Phase A — Foundation (DB + services)

No UI changes in this phase. App still renders the industrial UI but the underlying data and services are ready for the new screens.

### Task A1: Add `notifications` table + rename `subscription_tier` → `subscription_status`

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/migrations.ts`
- Modify: `src/types.ts` (Profile type — `subscription_tier` field rename)
- Test: `__tests__/db/migrations.test.ts`

- [ ] **Step 1: Write failing migration test**

```typescript
// __tests__/db/migrations.test.ts — append to existing suite
test('runSchemaMigrations creates notifications table with unread index', async () => {
  const db = await createTestClient();
  const cols = await db.getAll<{ name: string }>(`PRAGMA table_info(notifications)`);
  expect(cols.map((c) => c.name).sort()).toEqual([
    'created_at',
    'dismissed_at',
    'id',
    'kind',
    'payload_json',
    'read_at',
  ]);
  const idx = await db.getAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'`
  );
  expect(idx.map((i) => i.name)).toContain('idx_notifications_unread');
});

test('runSchemaMigrations renames subscription_tier to subscription_status', async () => {
  const db = await createTestClient();
  const cols = await db.getAll<{ name: string }>(`PRAGMA table_info(profile)`);
  const names = cols.map((c) => c.name);
  expect(names).toContain('subscription_status');
  expect(names).not.toContain('subscription_tier');
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest __tests__/db/migrations.test.ts
```
Expected: FAIL — `subscription_tier` still present, `notifications` doesn't exist.

- [ ] **Step 3: Update `src/db/schema.ts`** — replace `subscription_tier TEXT NOT NULL DEFAULT 'free'` with `subscription_status TEXT NOT NULL DEFAULT 'unknown'` and append the new `notifications` table at the end of `SCHEMA_SQL`:

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(read_at) WHERE read_at IS NULL;
```

- [ ] **Step 4: Update `src/db/migrations.ts`** — add idempotent migration to handle devices on the previous schema. The pattern should mirror existing migrations:

```typescript
// Append inside runSchemaMigrations(client) after existing column-add blocks:

// 1. Rename subscription_tier -> subscription_status (idempotent)
const profileCols = await client.getAll<{ name: string }>(`PRAGMA table_info(profile)`);
const colNames = profileCols.map((c) => c.name);
if (colNames.includes('subscription_tier') && !colNames.includes('subscription_status')) {
  await client.exec(`ALTER TABLE profile ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'unknown'`);
  await client.exec(`UPDATE profile SET subscription_status = CASE
    WHEN subscription_tier = 'pro' THEN 'active'
    ELSE 'unknown'
  END`);
  await client.exec(`ALTER TABLE profile DROP COLUMN subscription_tier`);
} else if (!colNames.includes('subscription_status')) {
  await client.exec(`ALTER TABLE profile ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'unknown'`);
}

// 2. Create notifications table (idempotent — CREATE TABLE IF NOT EXISTS handled in SCHEMA_SQL,
//    but for legacy devices that ran an older SCHEMA_SQL we re-run it here)
await client.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT
)`);
await client.exec(
  `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL`
);
```

- [ ] **Step 5: Update `src/types.ts`** — find the `Profile` type and rename:

```typescript
// before:  subscription_tier: 'free' | 'pro';
// after:
subscription_status: 'unknown' | 'trialing' | 'active' | 'lapsed';
```

Then sweep references with `grep -r subscription_tier src/ __tests__/` and rename them all.

- [ ] **Step 6: Run tests — verify they pass + nothing else broke**

```bash
npx jest __tests__/db/
npx tsc --noEmit
```
Expected: All migration tests pass; tsc clean (subscription_tier references all updated).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/migrations.ts src/types.ts __tests__/db/migrations.test.ts
git commit -m "feat(db): notifications table + subscription_tier→status migration

Adds local notifications table for the in-app notification center and
renames the subscription column from a free/pro tier to a four-state
status (unknown/trialing/active/lapsed). Pre-launch — old data migrates
'pro'→'active', everything else→'unknown'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: `notificationCenterService` — pure service over DbClient

**Files:**
- Create: `src/services/notificationCenterService.ts`
- Create: `__tests__/services/notificationCenterService.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// __tests__/services/notificationCenterService.test.ts
import { createTestClient } from '../setup';
import { createNotificationCenterService } from '../../src/services/notificationCenterService';

describe('notificationCenterService', () => {
  test('record() inserts a notification row', async () => {
    const db = await createTestClient();
    const now = () => '2026-04-30T10:00:00Z';
    const svc = createNotificationCenterService(db, now);
    const id = await svc.record({ kind: 'sign_request_received', payload: { requestId: 'r1' } });
    const row = await db.get<any>(`SELECT * FROM notifications WHERE id = ?`, [id]);
    expect(row.kind).toBe('sign_request_received');
    expect(row.read_at).toBeNull();
    expect(JSON.parse(row.payload_json)).toEqual({ requestId: 'r1' });
  });

  test('list() returns rows newest-first, excludes dismissed', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z');
    const a = await svc.record({ kind: 'cert_expiry_60d', payload: {} });
    const b = await svc.record({ kind: 'sign_request_signed', payload: {} });
    await svc.dismiss(a);
    const items = await svc.list();
    expect(items.map((i) => i.id)).toEqual([b]);
  });

  test('markAllRead() sets read_at on every unread row', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z');
    await svc.record({ kind: 'cert_expiry_60d', payload: {} });
    await svc.record({ kind: 'sign_request_signed', payload: {} });
    await svc.markAllRead();
    const unread = await svc.unreadCount();
    expect(unread).toBe(0);
  });

  test('record() with dedupe key skips duplicates within same day', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z');
    const a = await svc.record({ kind: 'backup_stale', payload: {}, dedupeOnDay: true });
    const b = await svc.record({ kind: 'backup_stale', payload: {}, dedupeOnDay: true });
    expect(a).toBe(b);
    const all = await db.getAll(`SELECT id FROM notifications WHERE kind = 'backup_stale'`);
    expect(all).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
npx jest __tests__/services/notificationCenterService.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
// src/services/notificationCenterService.ts
import { DbClient } from '../db/client';

export type NotificationKind =
  | 'cert_expiry_60d'
  | 'cert_expiry_0d'
  | 'sign_request_received'
  | 'sign_request_signed'
  | 'sign_request_declined'
  | 'sign_request_withdrawn'
  | 'level_upgrade'
  | 'backup_stale';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
}

export interface NotificationCenterService {
  record(input: {
    kind: NotificationKind;
    payload: Record<string, unknown>;
    dedupeOnDay?: boolean;
  }): Promise<string>;
  list(): Promise<NotificationRow[]>;
  unreadCount(): Promise<number>;
  markAllRead(): Promise<void>;
  dismiss(id: string): Promise<void>;
}

function uuid(): string {
  // RFC4122 v4 lite — fine for client-side IDs
  const r = (n: number) => Math.floor(Math.random() * n).toString(16).padStart(2, '0');
  const bytes = Array.from({ length: 16 }, () => r(256));
  bytes[6] = (parseInt(bytes[6], 16) & 0x0f | 0x40).toString(16).padStart(2, '0');
  bytes[8] = (parseInt(bytes[8], 16) & 0x3f | 0x80).toString(16).padStart(2, '0');
  const h = bytes.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createNotificationCenterService(
  db: DbClient,
  now: () => string
): NotificationCenterService {
  return {
    async record({ kind, payload, dedupeOnDay }) {
      if (dedupeOnDay) {
        const today = now().slice(0, 10);
        const existing = await db.get<{ id: string }>(
          `SELECT id FROM notifications WHERE kind = ? AND substr(created_at, 1, 10) = ? AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
          [kind, today]
        );
        if (existing) return existing.id;
      }
      const id = uuid();
      await db.run(
        `INSERT INTO notifications (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)`,
        [id, kind, JSON.stringify(payload), now()]
      );
      return id;
    },

    async list() {
      const rows = await db.getAll<{
        id: string;
        kind: NotificationKind;
        payload_json: string;
        created_at: string;
        read_at: string | null;
        dismissed_at: string | null;
      }>(
        `SELECT id, kind, payload_json, created_at, read_at, dismissed_at
         FROM notifications WHERE dismissed_at IS NULL ORDER BY created_at DESC`
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: JSON.parse(r.payload_json),
        created_at: r.created_at,
        read_at: r.read_at,
        dismissed_at: r.dismissed_at,
      }));
    },

    async unreadCount() {
      const row = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL`
      );
      return row?.n ?? 0;
    },

    async markAllRead() {
      await db.run(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL`, [now()]);
    },

    async dismiss(id) {
      await db.run(`UPDATE notifications SET dismissed_at = ? WHERE id = ?`, [now(), id]);
    },
  };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx jest __tests__/services/notificationCenterService.test.ts
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/notificationCenterService.ts __tests__/services/notificationCenterService.test.ts
git commit -m "feat(notifications): notificationCenterService for local notification log

Pure service over DbClient that records, lists, marks-read, and dismisses
local notifications. Supports per-day dedupe for nag-style notifications
like backup_stale.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: `useNotificationCenter` hook + DI wiring

**Files:**
- Create: `src/hooks/useNotificationCenter.ts`
- Modify: `src/db/initialize.ts` (export the service singleton via context if needed; or keep DI in App.tsx)
- Test: `__tests__/hooks/useNotificationCenter.test.tsx` *(optional — hooks are thin React Query wrappers; covered by service tests + screen snapshot)*

- [ ] **Step 1: Implement hook**

```typescript
// src/hooks/useNotificationCenter.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../db/DbProvider'; // existing pattern — see useEntries.ts
import {
  createNotificationCenterService,
  NotificationCenterService,
} from '../services/notificationCenterService';

const KEY = ['notifications'];

function isoNow() {
  return new Date().toISOString();
}

function svc(db: ReturnType<typeof useDb>): NotificationCenterService {
  return createNotificationCenterService(db, isoNow);
}

export function useNotificationCenter() {
  const db = useDb();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: KEY, queryFn: () => svc(db).list() });
  const unread = useQuery({
    queryKey: [...KEY, 'unread'],
    queryFn: () => svc(db).unreadCount(),
  });
  const markAllRead = useMutation({
    mutationFn: () => svc(db).markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => svc(db).dismiss(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
  return {
    items: list.data ?? [],
    unreadCount: unread.data ?? 0,
    markAllRead: () => markAllRead.mutate(),
    dismiss: (id: string) => dismiss.mutate(id),
    isLoading: list.isLoading,
  };
}
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
npx tsc --noEmit
```
Expected: clean (or `useDb` import path may need adjustment — match the path used by `useEntries.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useNotificationCenter.ts
git commit -m "feat(hooks): useNotificationCenter hook over notificationCenterService

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A4: Subscription service — collapse tiers to states

**Files:**
- Modify: `src/services/subscriptionService.ts`
- Modify: `src/hooks/useSubscription.ts` (rename `useSubscriptionTier` → `useSubscriptionStatus`; delete `useIsPro`)
- Modify: `src/services/profileService.ts` (uses `subscription_status`)
- Delete: `src/primitives/ProBadge.tsx`
- Test: `__tests__/services/subscriptionService.test.ts`

- [ ] **Step 1: Inventory existing call sites**

```bash
grep -rn "subscription_tier\|useSubscriptionTier\|useIsPro\|ProBadge\|tier === 'pro'\|tier === 'free'" src/ __tests__/
```
Note every match — they all need updating. Common ones: `ProfileScreen.tsx`, `SupervisorSearchScreen.tsx`, `useSubscription.ts`, `subscriptionService.ts`.

- [ ] **Step 2: Update `subscriptionService.ts` API**

Public surface:

```typescript
export type SubscriptionStatus = 'unknown' | 'trialing' | 'active' | 'lapsed';

export interface SubscriptionService {
  init(): Promise<void>;
  getStatus(): Promise<SubscriptionStatus>;
  /** Trial info — only meaningful when status is 'trialing'. */
  getTrialDaysRemaining(): Promise<number | null>;
  /** Renewal date string (ISO) — only meaningful when status is 'active'. */
  getRenewalDate(): Promise<string | null>;
  getPackages(): Promise<Package[]>;
  purchase(pkg: Package): Promise<SubscriptionStatus>;
  restore(): Promise<SubscriptionStatus>;
}
```

Implementation maps RevenueCat's `customerInfo` to states:
- entitlement active + product is in trial period → `'trialing'`
- entitlement active + not trial → `'active'`
- entitlement was active but is now expired → `'lapsed'`
- no entitlement and never had one → `'unknown'`

After every resolution, mirror the result into `profile.subscription_status` for offline reads (current pattern preserved).

- [ ] **Step 3: Update tests in `__tests__/services/subscriptionService.test.ts`**

Cover:
- mock RevenueCat returning trial → service returns `'trialing'` and `getTrialDaysRemaining()` returns days from `expirationDate`
- mock RevenueCat returning active non-trial → `'active'` + `getRenewalDate()` is the expiration ISO
- mock RevenueCat returning expired entitlement → `'lapsed'`
- offline / RevenueCat throws → falls back to `profile.subscription_status` from DB
- successful resolution writes the status into `profile.subscription_status`

- [ ] **Step 4: Update `src/hooks/useSubscription.ts`**

```typescript
export function useSubscriptionStatus() {
  // returns { status, isTrialing, isActive, isLapsed, trialDaysRemaining, renewalDate, isLoading }
}

export function useSubscriptionPackages() {/* unchanged */}
export function usePurchasePackage() {/* unchanged */}
export function useRestorePurchases() {/* unchanged */}
```

Delete `useSubscriptionTier`, `useIsPro`.

- [ ] **Step 5: Update call sites — sweep**

For each match found in Step 1:
- Replace `useSubscriptionTier()` → `useSubscriptionStatus()` and adjust returned shape.
- Replace `useIsPro()` → derive from `useSubscriptionStatus()` (e.g. `status === 'active' || status === 'trialing'`).
- Replace `tier === 'pro'` → `status === 'active' || status === 'trialing'`.
- Wherever the old code routed to `Paywall`, keep the route — Paywall itself is rebuilt later.

- [ ] **Step 6: Delete `ProBadge`**

```bash
git rm src/primitives/ProBadge.tsx
```

Remove its import from `src/primitives/index.ts` (if exported there).

- [ ] **Step 7: Verify**

```bash
npx jest __tests__/services/subscriptionService.test.ts
npx tsc --noEmit
```
Expected: tests pass, tsc clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(subscription): collapse free/pro tier to four-state status

Replaces 'free' | 'pro' with 'unknown' | 'trialing' | 'active' | 'lapsed'
per redesign spec §3. ProBadge primitive deleted; useIsPro removed.
Trial days remaining and renewal date exposed for the new Me-tab strip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task A5: Readiness selector — pure function for the Me-tab checklist

**Files:**
- Create: `src/services/readinessSelector.ts`
- Test: `__tests__/services/readinessSelector.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// __tests__/services/readinessSelector.test.ts
import { computeReadiness } from '../../src/services/readinessSelector';
import { Profile, Entry } from '../../src/types';

const completeProfile: Profile = {
  id: 'p1', full_name: 'Michael Cassidy',
  holds_sprat: 1, sprat_id: '123456', level: 'II', cert_expires_on: '2027-06-15', sprat_card_photo_path: null,
  holds_irata: 0, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null,
  primary_cert: 'sprat',
  default_employer: '',
  last_backup_at: null, photos_in_backup: 0,
  last_cloud_backup_at: '2026-04-25T00:00:00Z', last_uploaded_backup_id: null,
  supervisor_capability_enabled: 0, supervisor_cert_number: null, supervisor_directory_visible: 1,
  subscription_status: 'active',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-04-30T00:00:00Z',
};

test('all green when profile complete, signed entries, no pending, fresh backup', () => {
  const entries: Entry[] = [
    { id: 'e1', status: 'signed', /* ... fill required fields ... */ } as Entry,
  ];
  const r = computeReadiness({
    profile: completeProfile,
    entries,
    now: '2026-04-30T00:00:00Z',
    isSignedIn: true,
  });
  expect(r.profileComplete.state).toBe('ok');
  expect(r.signedEntries.state).toBe('ok');
  expect(r.signedEntries.label).toMatch(/1 signed entry/);
  expect(r.entriesNeedingSignature.state).toBe('ok');
  expect(r.backupRecency.state).toBe('ok');
});

test('amber when backup is 8-30 days old', () => {
  const r = computeReadiness({
    profile: { ...completeProfile, last_cloud_backup_at: '2026-04-15T00:00:00Z' },
    entries: [],
    now: '2026-04-30T00:00:00Z',
    isSignedIn: true,
  });
  expect(r.backupRecency.state).toBe('warn');
  expect(r.backupRecency.label).toMatch(/15 days/);
});

test('red when backup never or > 30 days', () => {
  const r = computeReadiness({
    profile: { ...completeProfile, last_cloud_backup_at: null },
    entries: [],
    now: '2026-04-30T00:00:00Z',
    isSignedIn: true,
  });
  expect(r.backupRecency.state).toBe('err');
});

test('replaces backup row with sign-in prompt when not signed in', () => {
  const r = computeReadiness({
    profile: completeProfile,
    entries: [],
    now: '2026-04-30T00:00:00Z',
    isSignedIn: false,
  });
  expect(r.backupRecency.label).toMatch(/Sign in to enable cloud backup/);
});

test('warns about pending entries needing signature', () => {
  const drafts = [
    { id: 'a', status: 'draft', pending_sign_request_id: null, /* required fields filled */ } as Entry,
    { id: 'b', status: 'draft', pending_sign_request_id: 'req1', /* required fields filled */ } as Entry,
  ];
  const r = computeReadiness({ profile: completeProfile, entries: drafts, now: '2026-04-30T00:00:00Z', isSignedIn: true });
  expect(r.entriesNeedingSignature.state).toBe('warn');
  expect(r.entriesNeedingSignature.label).toMatch(/2 entries need signatures/);
});

test('flags incomplete profile when name or cert missing', () => {
  const r = computeReadiness({
    profile: { ...completeProfile, full_name: '' },
    entries: [],
    now: '2026-04-30T00:00:00Z',
    isSignedIn: true,
  });
  expect(r.profileComplete.state).toBe('warn');
});
```

- [ ] **Step 2: Run — verify failure**

```bash
npx jest __tests__/services/readinessSelector.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// src/services/readinessSelector.ts
import { Profile, Entry } from '../types';

export type ReadinessState = 'ok' | 'warn' | 'err' | 'muted';

export interface ReadinessItem {
  state: ReadinessState;
  label: string;
}

export interface Readiness {
  profileComplete: ReadinessItem;
  signedEntries: ReadinessItem;
  entriesNeedingSignature: ReadinessItem;
  backupRecency: ReadinessItem;
}

export interface ReadinessInputs {
  profile: Profile | null;
  entries: Entry[];
  now: string;
  isSignedIn: boolean;
}

function daysBetween(aIso: string, bIso: string): number {
  return Math.floor((new Date(bIso).getTime() - new Date(aIso).getTime()) / 86_400_000);
}

function profileIsComplete(p: Profile | null): boolean {
  if (!p) return false;
  if (!p.full_name?.trim()) return false;
  const primary = p.primary_cert;
  if (primary === 'sprat') {
    return Boolean(p.sprat_id && p.level && p.cert_expires_on);
  } else {
    return Boolean(p.irata_id && p.irata_level && p.irata_expires_on);
  }
}

function entryRequiredFieldsFilled(e: Entry): boolean {
  return Boolean(
    e.site?.trim() &&
      e.employer?.trim() &&
      typeof e.work_hours === 'number' &&
      e.work_hours > 0 &&
      Array.isArray(JSON.parse(e.work_types)) &&
      JSON.parse(e.work_types).length > 0
  );
}

export function computeReadiness({ profile, entries, now, isSignedIn }: ReadinessInputs): Readiness {
  // 1. Profile complete
  const profileComplete: ReadinessItem = profileIsComplete(profile)
    ? { state: 'ok', label: 'Profile complete' }
    : { state: 'warn', label: 'Complete your profile' };

  // 2. Signed entries
  const signedCount = entries.filter((e) => e.status === 'signed' || e.status === 'amended').length;
  const signedEntries: ReadinessItem =
    signedCount === 0
      ? { state: 'muted', label: 'Log and sign your first entry' }
      : { state: 'ok', label: `${signedCount} signed ${signedCount === 1 ? 'entry' : 'entries'}` };

  // 3. Entries needing signature (Drafts + Needs signature + Awaiting)
  const pendingCount = entries.filter((e) => e.status === 'draft').length;
  const entriesNeedingSignature: ReadinessItem =
    pendingCount === 0
      ? { state: 'ok', label: 'No entries waiting to be signed' }
      : { state: 'warn', label: `${pendingCount} ${pendingCount === 1 ? 'entry needs' : 'entries need'} signatures` };

  // 4. Backup recency (signed-in branch) / sign-in prompt (signed-out branch)
  let backupRecency: ReadinessItem;
  if (!isSignedIn) {
    backupRecency = { state: 'warn', label: 'Sign in to enable cloud backup' };
  } else {
    const last = profile?.last_cloud_backup_at ?? null;
    if (!last) {
      backupRecency = { state: 'err', label: 'No backups yet — back up now' };
    } else {
      const days = daysBetween(last, now);
      if (days <= 7) backupRecency = { state: 'ok', label: `Backup ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}` };
      else if (days <= 30) backupRecency = { state: 'warn', label: `Back up — last sync ${days} days ago` };
      else backupRecency = { state: 'err', label: `Back up — last sync ${days} days ago` };
    }
  }

  return { profileComplete, signedEntries, entriesNeedingSignature, backupRecency };
}
```

- [ ] **Step 4: Run — verify pass**

```bash
npx jest __tests__/services/readinessSelector.test.ts
```
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/readinessSelector.ts __tests__/services/readinessSelector.test.ts
git commit -m "feat(services): readinessSelector for Me-tab export readiness checklist

Pure function over (profile, entries, last cloud backup, signed-in flag)
returning the four-item checklist used on the Me tab. ok/warn/err/muted
states map to the green/amber/red/gray status icons in the spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Theme + new primitives (built alongside industrial)

Industrial primitives stay until Phase F. New primitives go into `src/primitives/` with new filenames. The token swap is cleanly aliased so old screens still render (looking ugly but functional) until they're rebuilt.

### Task B1: Rewrite `tokens.ts` — light theme

**Files:**
- Modify: `src/theme/tokens.ts`

- [ ] **Step 1: Read the current tokens file** to understand the existing key structure (`colors`, `radii`, `spacing`, `fonts`, `typography`).

```bash
cat src/theme/tokens.ts | head -100
```

- [ ] **Step 2: Replace token bodies** with the light-theme palette, preserving all existing key names so consuming code doesn't break:

```typescript
// src/theme/tokens.ts — full rewrite (preserve ALL existing exported key names)
export const colors = {
  // New canonical names
  bgApp: '#FAF7F2',
  bgSurface: '#FFFFFF',
  bgMuted: '#F5F2ED',
  border: '#E5E7EB',
  divider: '#ECEAE5',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textDisabled: '#9CA3AF',
  accentPrimary: '#B71C1C',
  accentPressed: '#8E1212',
  accentTint: '#FCEAEA',
  statusOk: '#16A34A',
  statusWarn: '#F59E0B',
  statusErr: '#DC2626',
  statusInfo: '#2563EB',
  certL1: '#2563EB',
  certL2: '#D97706',
  certL3: '#15803D',

  // Legacy aliases — point old industrial keys to new tokens so existing screens render
  // (will be deleted in Phase F after every screen is migrated)
  bgBase: '#FAF7F2',
  bgRaised: '#FFFFFF',
  bgPanel: '#FFFFFF',
  bgInset: '#F5F2ED',
  edgeBase: '#E5E7EB',
  edgeHi: '#E5E7EB',
  edgeBright: '#D1D5DB',
  inkPrimary: '#111827',
  inkSecondary: '#6B7280',
  inkTertiary: '#9CA3AF',
  inkDisabled: '#9CA3AF',
  accentBase: '#B71C1C',
  accentHot: '#DC2626',
  accentDeep: '#8E1212',
};

export const radii = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const fonts = {
  // Inter loaded via expo-font in app.config.ts (Task B2)
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
};

export const typography = {
  title1: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34 },
  title2: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  bodyMed: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },

  // Legacy aliases — Inter-only so industrial screens still render readable text
  display: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34 },
  h1: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32 },
  h2: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 },
  h3: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  bodyBold: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 24 },
  bodySmall: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  numeric: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 },
  mono: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  stencil: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  stencilSm: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  stencilLg: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32 },
  micro: { fontFamily: fonts.body, fontSize: 11, lineHeight: 14 },
};
```

- [ ] **Step 3: Verify the app compiles**

```bash
npx tsc --noEmit
```
Expected: clean. (If the existing tokens.ts had a different `Theme` interface, make sure all keys are still present.)

- [ ] **Step 4: Commit**

```bash
git add src/theme/tokens.ts
git commit -m "feat(theme): rewrite tokens.ts to light-theme palette + Inter

New canonical tokens (bgApp, bgSurface, accentPrimary, status*, certL*).
Industrial token names retained as aliases pointing at new values so
existing screens render in the light theme without rewrite — aliases will
be removed in Phase F after every screen has been migrated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B2: Swap fonts — add Inter, remove Mono/Michroma

**Files:**
- Modify: `app.config.ts`
- Modify: `package.json` (add `@expo-google-fonts/inter`, remove `@expo-google-fonts/jetbrains-mono`, `@expo-google-fonts/michroma` if present)
- Modify: `App.tsx` (font loader call)

- [ ] **Step 1: Install Inter, uninstall stencil/mono**

```bash
npm install @expo-google-fonts/inter
npm uninstall @expo-google-fonts/jetbrains-mono @expo-google-fonts/michroma
```

(If those packages aren't in package.json, fonts may be loaded as raw `.ttf` assets via `app.config.ts` — adjust accordingly.)

- [ ] **Step 2: Update font loader in `App.tsx`**

```typescript
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';

// inside App():
const [fontsLoaded] = useFonts({
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
});
```

Remove the existing JetBrains Mono / Michroma `useFonts` entries.

- [ ] **Step 3: Smoke test on simulator**

```bash
npx expo start --ios
```
Expected: App launches; text renders in Inter (visually different from before — confirms loader works). No "fontFamily not found" warnings.

- [ ] **Step 4: Commit**

```bash
git add app.config.ts package.json package-lock.json App.tsx
git commit -m "chore(fonts): swap JetBrains Mono + Michroma for Inter

Inter is the only font used in the new design system. Mono/stencil are
retired with the industrial overhaul.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task B3: Build new primitive set

These are the new primitives the rebuilt screens will consume. Industrial primitives stay in place until Phase F so we don't break the build.

**Files (all new):**
- Create: `src/primitives/v2/StatusPill.tsx` — amber/green/gray pill matching the Records and EntryDetail mockup
- Create: `src/primitives/v2/FilterChips.tsx` — horizontal scrollable single-select chip row
- Create: `src/primitives/v2/SegmentedControl.tsx` — 2-or-3-option segmented (Today/Yesterday/Custom)
- Create: `src/primitives/v2/Sheet.tsx` — bottom-sheet wrapper around `react-native` `Modal` (or `@gorhom/bottom-sheet` if already a dep)
- Create: `src/primitives/v2/CenterModal.tsx` — centered-card modal for the post-save sheet
- Create: `src/primitives/v2/ChecklistRow.tsx` — readiness row (icon + label)
- Create: `src/primitives/v2/MultiSelectListRow.tsx` — toggleable row with check, used by Add Work step 2
- Create: `src/primitives/v2/StatCard.tsx` — generic card with title + big numeric + caption + optional progress bar (used by Hero, Cert, Progress)
- Create: `src/primitives/v2/AvatarUpload.tsx` — round avatar with edit affordance (Me identity block)
- Create: `src/primitives/v2/SubscriptionStrip.tsx` — trialing / active / lapsed strip on Me

- [ ] **Step 1: For each primitive, scaffold a small focused file with no business logic**

Below is the StatusPill skeleton; reuse the same shape (typed props, useTheme(), no internal state unless needed).

```typescript
// src/primitives/v2/StatusPill.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

export type StatusPillVariant = 'pending' | 'signed' | 'amended';

export interface StatusPillProps {
  variant: StatusPillVariant;
  label: string;
}

const VARIANT_STYLE: Record<StatusPillVariant, { bg: keyof ReturnType<typeof useTheme>['colors']; fg: keyof ReturnType<typeof useTheme>['colors'] }> = {
  pending:  { bg: 'statusWarn', fg: 'bgSurface' },
  signed:   { bg: 'statusOk',   fg: 'bgSurface' },
  amended:  { bg: 'textSecondary', fg: 'bgSurface' },
};

export function StatusPill({ variant, label }: StatusPillProps) {
  const { colors, radii, spacing, typography } = useTheme();
  const v = VARIANT_STYLE[variant];
  return (
    <View style={{
      backgroundColor: colors[v.bg],
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radii.pill,
      alignSelf: 'flex-start',
    }}>
      <Text style={[typography.caption, { color: colors[v.fg] }]}>{label}</Text>
    </View>
  );
}
```

- [ ] **Step 2: Repeat the pattern for each primitive in the list above.**

Each primitive: ~40–80 lines. No tests required at primitive level (snapshot tests on the screens that consume them will catch regressions). Match the mockup visuals; pull from `useTheme()` for all colors/radii/typography.

- [ ] **Step 3: Re-export from a barrel**

```typescript
// src/primitives/v2/index.ts
export * from './StatusPill';
export * from './FilterChips';
export * from './SegmentedControl';
export * from './Sheet';
export * from './CenterModal';
export * from './ChecklistRow';
export * from './MultiSelectListRow';
export * from './StatCard';
export * from './AvatarUpload';
export * from './SubscriptionStrip';
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/primitives/v2/
git commit -m "feat(primitives): new light-theme primitive set

Adds StatusPill, FilterChips, SegmentedControl, Sheet, CenterModal,
ChecklistRow, MultiSelectListRow, StatCard, AvatarUpload, and
SubscriptionStrip. These will be consumed by the rebuilt screens in
Phases C–E. Industrial primitives remain in src/primitives/ and will be
deleted in Phase F.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — Tab screens

Rebuild the three primary screens. Each is its own commit; each replaces an existing screen file by path, so the navigator imports update naturally.

### Task C1: Today screen

**Files:**
- Create: `src/screens/TodayScreen.tsx` (new file — the new Dashboard)
- Modify: `src/navigation/RootNavigator.tsx` (replace `DashboardScreen` import → `TodayScreen`, rename tab label "Dashboard" → "Today")
- Modify: `src/services/cloudBackupService.ts` (no changes; Today calls existing `useTodayHours` if not present, create it)
- Create: `src/hooks/useTodayHours.ts`

- [ ] **Step 1: Create `useTodayHours` hook**

```typescript
// src/hooks/useTodayHours.ts
import { useEntries } from './useEntries';

export function useTodayHours(now = new Date()): number {
  const { data: entries = [] } = useEntries();
  const today = now.toISOString().slice(0, 10);
  return entries
    .filter((e) => {
      const from = e.date_from ?? e.date;
      const to = e.date_to ?? e.date;
      return from <= today && today <= to;
    })
    .reduce((sum, e) => sum + e.work_hours, 0);
}
```

- [ ] **Step 2: Implement `TodayScreen.tsx`**

Structure (illustrative — fill in JSX from mockup):

```typescript
// src/screens/TodayScreen.tsx
import React from 'react';
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native';
import { Screen, Button } from '../primitives';
import { StatCard } from '../primitives/v2';
import { useTheme } from '../theme/ThemeProvider';
import { useNavigation } from '@react-navigation/native';
import { useProfile } from '../hooks/useProfile';
import { useEntries } from '../hooks/useEntries';
import { useSignRequests } from '../hooks/useSignRequests';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useTodayHours } from '../hooks/useTodayHours';
import { useNotificationCenter } from '../hooks/useNotificationCenter';
import { useCertProgress } from '../hooks/useCertProgress'; // existing
import { TechSittingIllustration } from '../components/illustrations/TechSittingIllustration';

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function TodayScreen() {
  const { colors, spacing, typography } = useTheme();
  const nav = useNavigation<any>();
  const { data: profile } = useProfile();
  const { data: entries = [] } = useEntries();
  const todayHours = useTodayHours();
  const { unreadCount, items: notifications } = useNotificationCenter();
  const { data: signRequests = [] } = useSignRequests();
  const { data: connections = [] } = useSupervisorConnections();
  const cert = useCertProgress();

  const supervisorMode = !!profile?.supervisor_capability_enabled;
  const incomingCount = supervisorMode
    ? signRequests.filter((r) => r.status === 'pending' && r.supervisor_user_id === profile?.id).length
    : 0;
  const needsSignatureCount = entries.filter(
    (e) => e.status === 'draft' && !e.pending_sign_request_id /* + required-fields-non-null */
  ).length;

  return (
    <Screen>
      {/* Header: title + bell with red dot if unread */}
      <Header title="Today" trailing={
        <Pressable onPress={() => nav.navigate('Notifications')}>
          {/* Bell icon + dot when unreadCount > 0 */}
        </Pressable>
      } />

      <ScrollView
        refreshControl={<RefreshControl refreshing={false} onRefresh={async () => {/* sync */}} />}
        contentContainerStyle={{ padding: spacing.base, gap: spacing.base }}
      >
        {/* Greeting */}
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {greeting()},
        </Text>
        <Text style={[typography.title1, { color: colors.textPrimary }]}>
          {profile?.full_name?.split(' ')[0] ?? 'there'}
        </Text>

        {/* Hero: hours today + illustration */}
        <StatCard
          big={`${todayHours}h`}
          label="logged today"
          illustration={<TechSittingIllustration />}
        />

        {/* + Add work CTA */}
        <Button label="+ Add work" onPress={() => nav.navigate('EntryForm')} variant="primary" />

        {/* Supervisor incoming */}
        {supervisorMode && incomingCount > 0 && (
          <Pressable onPress={() => nav.navigate('Inbox')}>
            <StatCard label="Incoming sign requests" value={`${incomingCount}`} />
          </Pressable>
        )}

        {/* Needs signature */}
        {needsSignatureCount > 0 && (
          <Pressable onPress={() => nav.navigate('Records', { filter: 'needs_signature' })}>
            <StatCard label="Needs signature" value={`${needsSignatureCount} entries`} />
          </Pressable>
        )}

        {/* Cert progress */}
        <StatCard
          title="Certification"
          big={cert.atL3 ? `Level III` : `${cert.hoursAtCurrentLevel} / ${cert.hoursToNextLevel}`}
          label={cert.atL3 ? `${cert.totalLifetimeHours} hours total` : `${cert.hoursToNextLevel - cert.hoursAtCurrentLevel} hours to go`}
          progress={cert.atL3 ? null : cert.hoursAtCurrentLevel / cert.hoursToNextLevel}
        />
      </ScrollView>
    </Screen>
  );
}
```

(`useCertProgress` already exists per the file inventory; use its existing shape — adjust property names to match.)

- [ ] **Step 3: Wire into navigator**

Find the `Tab.Screen` for `Dashboard` in `RootNavigator.tsx` and rename to `Today`:

```typescript
<Tab.Screen
  name="Today"
  component={TodayScreen}
  options={{ tabBarLabel: 'Today', tabBarIcon: HomeIcon }}
/>
```

Delete the `DashboardScreen` import; leave the file present (deleted in Phase F or this same task — your call).

- [ ] **Step 4: Smoke test**

```bash
npx expo start --ios
```
Expected: app boots into Today; greeting + hero + cards visible; tapping "+ Add work" pushes EntryForm.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(screens): rebuild Today screen for light-theme redesign

Replaces DashboardScreen. Hour counter hero + Needs signature + Cert
progress + supervisor Incoming sign requests card. Bell icon top-right
opens Notifications. Pull-to-refresh syncs supervisor connections and
sign requests when signed in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Records screen (replaces LogbookScreen)

**Files:**
- Create: `src/screens/RecordsScreen.tsx`
- Modify: `src/navigation/RootNavigator.tsx` (replace `LogbookScreen` import + tab name)
- Delete: `src/screens/LogbookScreen.tsx` (after import is replaced)

- [ ] **Step 1: Implement `RecordsScreen.tsx`**

Components to use:
- `FilterChips` (v2 primitive) — `[{ key: 'all', label: 'All' }, { key: 'drafts', label: 'Drafts' }, …]`
- `Input` (existing) for search; debounced via `useDebouncedValue` or inline `useState` + `setTimeout`
- `SectionList` (RN built-in) for month-grouped rendering
- `StatusPill` (v2) per row

Filter logic:

```typescript
function filterEntries(entries: Entry[], chip: ChipKey, query: string): Entry[] {
  return entries
    .filter((e) => {
      switch (chip) {
        case 'all': return true;
        case 'drafts': return e.status === 'draft' && !entryRequiredFieldsFilled(e);
        case 'needs_signature': return e.status === 'draft' && !e.pending_sign_request_id && entryRequiredFieldsFilled(e);
        case 'awaiting': return e.status === 'draft' && !!e.pending_sign_request_id;
        case 'signed': return e.status === 'signed' || e.status === 'amended';
      }
    })
    .filter((e) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return [e.site, e.employer, e.description].some((f) => (f ?? '').toLowerCase().includes(q));
    });
}

function groupByMonth(entries: Entry[]): { title: string; data: Entry[] }[] {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    const d = new Date(e.date_from ?? e.date);
    const key = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}
```

Each row renders:
- Left: `Text` site (bodyMed) + dates + hours muted
- Right: `StatusPill variant=… label=…` (variant derived from status: drafts/needs_signature/awaiting → 'pending'; signed → 'signed'; amended → 'amended')

Empty states:
- No entries at all → illustration + "+ Log your first entry"
- No matches → muted message + "Clear filters"

Deep-link from Today: route param `filter='needs_signature'` pre-selects the chip.

- [ ] **Step 2: Wire navigator**

```typescript
<Tab.Screen name="Records" component={RecordsScreen} options={{ tabBarLabel: 'Records' }} />
```

- [ ] **Step 3: Delete `LogbookScreen.tsx`**

```bash
git rm src/screens/LogbookScreen.tsx
```

(If it's still referenced anywhere — `EntryDetail` "back to list", etc. — replace those refs with `Records`.)

- [ ] **Step 4: Smoke test + commit**

```bash
npx expo start --ios
git add -A
git commit -m "feat(screens): rebuild Records screen with filter chips + month grouping

Replaces LogbookScreen. Search, single-select chip filter, advanced
filter sheet (date range / work types / employer / cert level), month
grouping, status pills. Today's Needs-signature card deep-links here
with the chip pre-selected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Me screen + Settings sheet

**Files:**
- Create: `src/screens/MeScreen.tsx`
- Create: `src/screens/SettingsSheet.tsx` (or render inline)
- Modify: `src/navigation/RootNavigator.tsx` (replace `ProfileScreen` import; tab name "Profile" → "Me")
- Delete: `src/screens/ProfileScreen.tsx` (after refs swept)
- Delete: `src/components/SupervisorsSection.tsx`, `ProfileCloudSection.tsx`, `DeleteAccountModal.tsx` are folded into Settings or pushed elsewhere — sweep imports.

- [ ] **Step 1: Implement `MeScreen.tsx`**

Sections (top to bottom):
1. Header — "Me" + gear icon → opens Settings sheet
2. Identity block — `AvatarUpload`, name, primary cert chip, secondary cert chip (tap to swap primary)
3. Certification card — expiry date + days pill (green/amber/red)
4. Progress card — uses `useCertProgress`
5. Readiness card — calls `computeReadiness({ profile, entries, isSignedIn, now: nowIso() })` and renders 4 `ChecklistRow`s
6. Action buttons — Export PDF (primary), Export JSON (secondary), Backup now (secondary, hidden if not signed-in or offline)
7. Subscription strip — `SubscriptionStrip` with state from `useSubscriptionStatus()`

- [ ] **Step 2: Implement `SettingsSheet.tsx`**

Bottom sheet contents (use `Sheet` v2 primitive):
- Profile (name, avatar, cert details — links to existing edit modals)
- Supervisor capability toggle (only when at least one cert is L3) + cert number + directory toggle
- Photos in cloud backup toggle
- Notifications → `Linking.openSettings()`
- Account: signed-in email + Sign out + Delete account (existing `DeleteAccountModal`, re-themed inline)
- About: version (`Constants.expoConfig?.version`), build number, links

Inline a `Supervisors` row in the Settings sheet that pushes a new screen `SupervisorsListScreen` (containing the moved-from-ProfileScreen connections list + invites + search entry-point). Or fold the connections list into the existing Inbox tab — pick the simpler placement that respects "supervisor capability enabled = Inbox tab visible." Recommended: keep connections list in the Settings push, since the Inbox tab is for *active* sign requests.

- [ ] **Step 3: Swap secondary cert chip on tap**

```typescript
const swapPrimary = useMutation({
  mutationFn: () =>
    profileService.updateProfile(db, profile.id, {
      primary_cert: profile.primary_cert === 'sprat' ? 'irata' : 'sprat',
    }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
});
```

Confirmed via toast: "SPRAT is now your primary certification."

- [ ] **Step 4: Wire navigator + delete old Profile**

```typescript
<Tab.Screen name="Me" component={MeScreen} options={{ tabBarLabel: 'Me' }} />
```

```bash
git rm src/screens/ProfileScreen.tsx src/components/SupervisorsSection.tsx src/components/ProfileCloudSection.tsx
```

(Move any still-used pieces of those components into `MeScreen` or `SettingsSheet` first.)

- [ ] **Step 5: Smoke test + commit**

```bash
npx expo start --ios
git add -A
git commit -m "feat(screens): rebuild Me screen + Settings sheet (replaces Profile)

Identity block with primary cert chip (tap secondary to swap primary),
Certification + Progress cards, Readiness for export checklist via
computeReadiness, Export PDF/JSON + Backup now actions, subscription
strip. Settings sheet houses supervisor capability, photos toggle,
account, and about. Old ProfileScreen, SupervisorsSection, and
ProfileCloudSection deleted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Flow screens

### Task D1: Add Work — 2-step wizard

**Files:**
- Modify: `src/screens/EntryFormScreen.tsx` (full rewrite)
- Maybe: split into `EntryFormStep1.tsx` and `EntryFormStep2.tsx` if file grows past ~300 lines.

- [ ] **Step 1: Replace screen body with a 2-step state machine**

```typescript
type Step = 1 | 2;
type WhenChoice = 'today' | 'yesterday' | 'custom';

interface FormState {
  step: Step;
  site: string;
  employer: string;
  whenChoice: WhenChoice;
  customRange: { from: string; to: string } | null;
  hours: string;
  workTypes: string[];     // multi-select
  otherDescription: string;
  notes: string;
}
```

Step 1: site, employer dropdown (distinct prior employers), when (segmented), hours, "Next" CTA, progress strip.
Step 2: work types multi-select list, Other expands description, notes textarea, "Save work" CTA.

- [ ] **Step 2: On save, fire post-save sheet**

```typescript
async function handleSave() {
  const id = await entriesService.createEntry(db, derivedFromState(formState));
  // navigate the modal stack to PostSaveSheet
  nav.replace('PostSaveSheet', { entryId: id });
}
```

- [ ] **Step 3: Cancel guard**

If any field has been touched, show "Discard this entry?" prompt before dismissing.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(screens): rebuild Add Work as 2-step wizard

Step 1 (Where & when) collects site, employer, when (Today/Yesterday/Custom), hours.
Step 2 (What did you do) collects work types (multi-select) and notes.
On save, navigates to the post-save sheet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D2: Post-save sheet + Signature options sheet

**Files:**
- Create: `src/screens/PostSaveSheet.tsx`
- Create: `src/screens/SignatureOptionsSheet.tsx`
- Modify: `src/navigation/RootNavigator.tsx` (register both as modal stack screens)

- [ ] **Step 1: Implement `PostSaveSheet.tsx`** — centered modal with checkmark, summary, three actions:

```typescript
<CenterModal>
  <CheckIcon color={colors.statusOk} size={48} />
  <Text style={typography.title2}>Work saved</Text>
  <Text>{site} · {dateRange} · {hours}h</Text>
  <StatusPill variant="pending" label="Draft" />
  <Text>Get this signed by your Level III supervisor.</Text>

  <Button label="Sign now" variant="primary" onPress={() => nav.replace('SignatureOptionsSheet', { entryId })} />
  <Button label="Send request" variant="outline" onPress={() => nav.replace('SendSignRequest', { entryId })} />
  <Button label="Later" variant="text" onPress={() => nav.popToTop()} />
</CenterModal>
```

- [ ] **Step 2: Implement `SignatureOptionsSheet.tsx`** — bottom sheet with two big tap targets + cancel:

```typescript
<Sheet>
  <Text style={typography.title2}>How will this be signed?</Text>

  <BigTapTarget icon={PenIcon} title="Sign on this device" subtitle="Supervisor is with you right now."
    onPress={() => nav.replace('Signature', { entryId })} />

  <BigTapTarget icon={SendIcon} title="Send to supervisor" subtitle="Request a remote signature."
    onPress={() => nav.replace('SendSignRequest', { entryId })} />

  <Button label="Cancel" variant="text" onPress={() => nav.goBack()} />
</Sheet>
```

`BigTapTarget` is a small inline component, ~30 lines.

- [ ] **Step 3: Register routes**

```typescript
<Stack.Screen name="PostSaveSheet" component={PostSaveSheet}
  options={{ presentation: 'transparentModal', animation: 'fade' }} />
<Stack.Screen name="SignatureOptionsSheet" component={SignatureOptionsSheet}
  options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }} />
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(screens): post-save and signature-options sheets

After saving an entry, the post-save sheet offers Sign now / Send
request / Later. Sign now opens the signature-options sheet which
routes to either the in-person Signature flow or the SendSignRequest
modal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D3: Send request modal — supervisor picker + message

**Files:**
- Create: `src/screens/SendSignRequestScreen.tsx` (or replace existing `SendSignRequest` if present)
- Modify: `src/navigation/RootNavigator.tsx`

- [ ] **Step 1: Implement**

```typescript
export function SendSignRequestScreen({ route }) {
  const { entryId } = route.params;
  const [supervisorId, setSupervisorId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const { data: connections = [] } = useSupervisorConnections();
  const accepted = connections.filter((c) => c.status === 'accepted');

  return (
    <Screen>
      <Header title="Send request" trailing={<CloseButton />} />
      <PickerField label="To" placeholder="Select supervisor"
        options={accepted.map((c) => ({ value: c.supervisor_user_id!, label: `${c.supervisor_display_name} (${/* level */})` }))}
        value={supervisorId} onChange={setSupervisorId} />
      <Pressable onPress={() => nav.navigate('SupervisorSearch')}>
        <Text>Find supervisor</Text>
      </Pressable>
      <Textarea label="Message (optional)" value={message} onChange={setMessage} />
      <Button label="Send request" variant="primary" disabled={!supervisorId}
        onPress={async () => {
          await signRequestsService.sendSignRequest(db, cloud, fs, hash, now, { entryId, supervisorUserId: supervisorId!, message });
          toast('Request sent');
          nav.popToTop();
        }} />
      <Button label="Cancel" variant="text" onPress={() => nav.goBack()} />
    </Screen>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(screens): rebuild Send Request modal

Picker populated from accepted supervisor connections, plus a
deep-link to SupervisorSearch. Optional message. Calls existing
signRequestsService.sendSignRequest unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D4: EntryDetail re-skin

**Files:**
- Modify: `src/screens/EntryDetailScreen.tsx`

- [ ] **Step 1: Re-theme**

- New header (Screen title from site + Draft/Signed pill)
- Body cards: Date+hours, Employer, Work types, Notes, Signature card ("Not signed yet" or signature image)
- Buttons: Draft → `Edit` (outline) + `Get signature` (primary, opens `SignatureOptionsSheet`); Awaiting → Withdraw banner; Signed → integrity banner only

Service calls and lock semantics unchanged.

- [ ] **Step 2: Commit**

```bash
git add src/screens/EntryDetailScreen.tsx
git commit -m "feat(screens): re-skin EntryDetail to match new design

Same data, new visuals. Get signature button on drafts opens the
signature-options sheet. Awaiting and Signed states preserve existing
banners. Lock semantics untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D5: Inbox + SignRequestDetail + SupervisorSearch re-skin

**Files:**
- Modify: `src/screens/InboxScreen.tsx`
- Modify: `src/screens/SignRequestDetailScreen.tsx`
- Modify: `src/screens/SupervisorSearchScreen.tsx`

- [ ] **Step 1: Apply new tokens, primitives, copy**

These screens keep their data sources and service calls. Only visual structure changes:
- Inbox: section list (Pending invites / Incoming sign requests), each row is a `ListRow`-style with `StatusPill`
- SignRequestDetail: read-side card layout matching EntryDetail; Sign / Decline as primary/secondary buttons
- SupervisorSearch: tab segmented (Cert # / Email / Name), result list

Drop any `ProBadge` references (Name search becomes free, no Pro badge).

- [ ] **Step 2: Commit**

```bash
git add src/screens/InboxScreen.tsx src/screens/SignRequestDetailScreen.tsx src/screens/SupervisorSearchScreen.tsx
git commit -m "feat(screens): re-skin Inbox, SignRequestDetail, SupervisorSearch

Visual reskin to light theme. ProBadge references dropped (Pro tier was
collapsed to a single subscribe-or-not). Service calls unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task D6: Auth + MagicLinkWait + CloudConflict re-skin

**Files:**
- Modify: `src/screens/AuthScreen.tsx`
- Modify: `src/screens/MagicLinkWaitScreen.tsx`
- Modify: `src/screens/CloudConflictScreen.tsx`

- [ ] **Step 1: Re-theme**

- AuthScreen: light theme. Apple sign-in button + Google sign-in + email magic link input.
- MagicLinkWaitScreen: "Check your email" message in new card.
- CloudConflictScreen: side-by-side comparison cards, two CTAs ("Keep cloud" / "Replace cloud") in red primary.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(screens): re-skin auth + cloud conflict screens

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase E — New surfaces

### Task E1: Onboarding sequence with role fork

**Files:**
- Modify: `src/screens/OnboardingScreen.tsx` (or split into sub-screens)
- Create: `src/screens/onboarding/WelcomeStep.tsx`, `NameStep.tsx`, `CertStep.tsx`, `RoleForkStep.tsx`, `SubscribeStep.tsx`
- Modify: `src/navigation/RootNavigator.tsx` — onboarding stack

- [ ] **Step 1: Implement step state machine**

```typescript
type OnboardingStep = 'welcome' | 'name' | 'cert' | 'role_fork' | 'subscribe' | 'cloud_signin';

interface OnboardingState {
  step: OnboardingStep;
  name: string;
  certs: { sprat?: { id: string; level: 'I'|'II'|'III'; expires: string; cardPhotoUri?: string };
           irata?: { id: string; level: 'I'|'II'|'III'; expires: string; cardPhotoUri?: string };
           primary: 'sprat' | 'irata' };
  role: 'tech' | 'supervisor';
  supervisorCertNumber?: string;
  directoryVisible: boolean;
}
```

Transitions:
- `welcome` → `name` → `cert`
- After `cert`, conditional: if any L3 → `role_fork`, else skip to `subscribe` with `role='tech'`
- `role_fork` → `subscribe`
- `subscribe` → if `role='supervisor'` then `cloud_signin` else done (land on Today)
- `cloud_signin` → done

- [ ] **Step 2: Implement role fork screen**

Two big tap targets: "Use as Tech" (default highlighted) / "Use as Supervisor" (only enabled when at least one cert is L3). If supervisor picked, capture supervisor cert number + "Make me findable" toggle.

- [ ] **Step 3: Implement subscribe step**

Inline RevenueCat paywall via `Purchases.presentPaywallIfNeeded` or render the package list with the trial banner. On success, profile is created locally with the captured state and `subscription_status='trialing'`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(onboarding): cert-first onboarding with conditional role fork

Welcome → Name → Cert(s) → Role fork (only when any cert is L3) →
Subscribe (7-day free trial) → optional Cloud sign-in (required for
supervisor signups). Captures supervisor cert number + directory
visibility when role=supervisor; pre-enables supervisor_capability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E2: Paywall rebuild + lapse handling

**Files:**
- Modify: `src/screens/PaywallScreen.tsx`
- Modify: `src/navigation/RootNavigator.tsx` (gate Main stack on subscription status)

- [ ] **Step 1: Rebuild PaywallScreen**

Two contexts:
- Onboarding entry — primary CTA "Start free trial" (RevenueCat presents the Apple/Google sheet with trial offer)
- Lapse re-entry — primary CTA "Renew subscription," explanatory copy "Your logbook stays viewable and exportable as PDF; renew to add or sign new entries."

Bottom: "Restore purchase" link.

- [ ] **Step 2: Add `useReadOnly` hook (or just compute inline)**

```typescript
export function useReadOnly(): boolean {
  const { status } = useSubscriptionStatus();
  return status === 'lapsed';
}
```

- [ ] **Step 3: Gate write actions across screens**

Wrap Add Work CTA, Sign actions, Send Request CTA, Backup now in a check:

```typescript
const readOnly = useReadOnly();
<Button disabled={readOnly} onPress={readOnly ? () => nav.navigate('Paywall') : handler} … />
```

Or: render a banner at the top of every screen when `readOnly` and disable write CTAs accordingly.

- [ ] **Step 4: Auto-route to Paywall on lapse**

In `RootNavigator.tsx`, after profile is loaded, if `subscription_status === 'lapsed'` and the user attempts to enter a write screen, redirect to Paywall (modal) on top of the current stack.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(paywall): rebuild PaywallScreen + lapse-driven read-only mode

Paywall has two modes: trial-start during onboarding, and re-entry on
lapse. Lapsed users can still view + export their logbook (PDF/JSON)
but write actions (add, sign, sync) are gated behind Paywall. This
matches Apple's policy on retained content access after subscription
expiry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E3: NotificationsScreen + bell badge wiring

**Files:**
- Create: `src/screens/NotificationsScreen.tsx`
- Modify: `App.tsx` — push handler writes a `notifications` row alongside push receive
- Modify: `src/services/signRequestsService.ts` — record() calls on each mutation
- Modify: cert-expiry scheduler to write rows on foreground

- [ ] **Step 1: Implement `NotificationsScreen.tsx`**

```typescript
export function NotificationsScreen() {
  const { items, markAllRead, dismiss } = useNotificationCenter();
  // group by day (Today / Yesterday / DD MMM)
  const sections = useMemo(() => groupByDay(items), [items]);

  return (
    <Screen>
      <Header title="Notifications" trailing={<TextButton label="Mark all read" onPress={markAllRead} />} />
      <SectionList sections={sections} renderItem={({ item }) => (
        <Pressable onLongPress={() => dismiss(item.id)} onPress={() => navigateForKind(item)}>
          <NotificationRow item={item} />
        </Pressable>
      )} />
    </Screen>
  );
}

function navigateForKind(item: NotificationRow) {
  switch (item.kind) {
    case 'sign_request_received':
    case 'sign_request_signed':
    case 'sign_request_declined':
    case 'sign_request_withdrawn':
      nav.navigate('SignRequestDetail', { requestId: item.payload.requestId });
      break;
    case 'cert_expiry_60d':
    case 'cert_expiry_0d':
      nav.navigate('Me');
      break;
    case 'level_upgrade':
      nav.navigate('Me');
      break;
    case 'backup_stale':
      nav.navigate('Me');
      break;
  }
}
```

- [ ] **Step 2: Hook write-side calls into existing services**

In each mutation in `signRequestsService.ts` (sendSignRequest, withdrawRequest, declineRequest, signRequest, applyIncomingSignature), after the existing push dispatch:

```typescript
await notificationCenter.record({
  kind: appropriateKind, // e.g. 'sign_request_signed' on the tech's device when applyIncomingSignature runs
  payload: { requestId, entryId, ... },
});
```

For the supervisor receiving a request, the push handler in `App.tsx` decodes the payload and calls `notificationCenter.record({ kind: 'sign_request_received', payload: { requestId } })`.

- [ ] **Step 3: Wire bell badge**

In `TodayScreen.tsx` header:

```typescript
const { unreadCount } = useNotificationCenter();
<BellWithDot showDot={unreadCount > 0} onPress={() => nav.navigate('Notifications')} />
```

- [ ] **Step 4: backup_stale daily check**

In `App.tsx` `AppState` listener (or a foreground hook), when state goes `active`, if signed in and `last_cloud_backup_at` > 30 days ago, call `notificationCenter.record({ kind: 'backup_stale', payload: {}, dedupeOnDay: true })`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(screens): NotificationsScreen + bell badge + write-side notification rows

In-app notification center listing local notifications grouped by day,
mark-all-read, long-press dismiss. Bell icon on Today shows a red dot
when there's at least one unread notification. Sign-request mutations,
cert-expiry checks, and backup-stale checks all write into the local
notifications table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task E4: Navigation cleanup — conditional Inbox tab + tab bar visuals

**Files:**
- Modify: `src/navigation/RootNavigator.tsx`

- [ ] **Step 1: Conditional Inbox tab**

```typescript
const supervisorMode = !!profile?.supervisor_capability_enabled;
return (
  <Tab.Navigator>
    <Tab.Screen name="Today" component={TodayScreen} />
    <Tab.Screen name="Records" component={RecordsScreen} />
    {supervisorMode && <Tab.Screen name="Inbox" component={InboxScreen} />}
    <Tab.Screen name="Me" component={MeScreen} />
  </Tab.Navigator>
);
```

- [ ] **Step 2: Tab bar styling**

White bg, 1px top divider in `colors.divider`, active label in `colors.accentPrimary`, inactive in `colors.textSecondary`. Custom icons (Home, ListBullets, Inbox, Person) in 24×24, stroke 1.5.

- [ ] **Step 3: Stack header styling**

Default `screenOptions.headerStyle.backgroundColor = colors.bgSurface`, `headerTitleStyle = typography.title2`, `headerTintColor = colors.textPrimary`, no shadow, 1px bottom hairline.

- [ ] **Step 4: Commit**

```bash
git add src/navigation/RootNavigator.tsx
git commit -m "feat(nav): conditional Inbox tab + light-theme tab bar styling

Inbox tab renders only when supervisor_capability_enabled. Tab bar
moves to white surface with red active label. Stack headers also light.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase F — Cleanup

### Task F1: Delete industrial primitives

**Files:**
- Delete: `src/primitives/{Panel,Gauge,PunchCardRow,BreakdownBar,RecertStrip,StatStrip,SegmentedToggle,SyncLED,FabButton,SectionLabel,Rivet,NoiseTexture}.tsx`
- Modify: `src/primitives/index.ts` — remove the deleted exports

- [ ] **Step 1: Verify no consumers**

```bash
grep -rn "from '../primitives/Panel'\|from '@/primitives/Panel'\|<Panel\b" src/
# repeat for each primitive
```

If any matches: replace with the v2 equivalent or inline JSX.

- [ ] **Step 2: Delete + commit**

```bash
git rm src/primitives/Panel.tsx src/primitives/Gauge.tsx src/primitives/PunchCardRow.tsx \
  src/primitives/BreakdownBar.tsx src/primitives/RecertStrip.tsx src/primitives/StatStrip.tsx \
  src/primitives/SegmentedToggle.tsx src/primitives/SyncLED.tsx src/primitives/FabButton.tsx \
  src/primitives/SectionLabel.tsx src/primitives/Rivet.tsx src/primitives/NoiseTexture.tsx
git add src/primitives/index.ts
git commit -m "chore(primitives): delete industrial primitives

Industrial-overhaul primitives are no longer referenced after the
light-theme rewrite. v2 replacements live in src/primitives/v2/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task F2: Move v2 primitives back into the main primitives directory + drop legacy aliases

**Files:**
- Move: `src/primitives/v2/*.tsx` → `src/primitives/*.tsx`
- Modify: `src/primitives/index.ts`
- Modify: `src/theme/tokens.ts` — drop the legacy aliases section

- [ ] **Step 1: Move files**

```bash
git mv src/primitives/v2/StatusPill.tsx src/primitives/StatusPill.tsx
git mv src/primitives/v2/FilterChips.tsx src/primitives/FilterChips.tsx
# … etc for the full v2 set
rmdir src/primitives/v2
```

- [ ] **Step 2: Update imports**

```bash
grep -rln "from '../primitives/v2'" src/ | xargs sed -i.bak "s|from '../primitives/v2'|from '../primitives'|g"
# also two-dot, three-dot variants
```

- [ ] **Step 3: Update barrel + drop legacy token aliases**

In `src/theme/tokens.ts`, delete the "Legacy aliases" sections in `colors` and `typography`.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npx jest
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(primitives,theme): flatten v2/ + drop legacy token aliases

Primitives directory has only the new set now. tokens.ts loses the
backwards-compat aliases that were keeping industrial screens compiling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task F3: Update CLAUDE.md to reflect new state

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite the Project, Architecture, and "Not yet implemented" sections**

Sections to update:
- **Project** — primary design references: add the new `2026-04-30-light-theme-redesign-design.md`. Mark the industrial spec as superseded.
- **Architecture / UI** — replace the industrial-aesthetic paragraph with the light-theme description (cream/red/Inter). List the new primitive set. Drop mentions of Panel, Gauge, PunchCardRow, etc.
- **Subscriptions** — rewrite per the four-state model; note the trial flow and lapse semantics.
- **Onboarding** — describe the new role-fork flow.
- **Notifications** — note the in-app notification center and the local `notifications` table.
- **Known state** — refresh test counts.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): update CLAUDE.md for light-theme redesign

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task F4: Final verification

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 2: Test suite**

```bash
npx jest --runInBand
```
Expected: all suites green; new ones (notificationCenterService, readinessSelector, subscription state) included.

- [ ] **Step 3: Manual QA on simulator**

Walk the smoke-test list from the spec §11:
- New-tech onboarding through trial start
- New-supervisor onboarding (sign-in required mid-flow)
- Add Work 2-step (single-day, multi-day Custom, Other-with-description)
- Post-save sheet routing (Sign now / Send request / Later)
- Sign on this device → in-person signature capture
- Send to supervisor → recipient sees it on their Inbox + receives a notification + signs → tech sees it back
- Notification center: receive a sign-request push → tap notification → SignRequestDetail
- Bell badge clears after Mark all read
- Settings: capability toggle on/off, primary cert swap, photos toggle
- Subscription lapse simulation (force a lapsed status in DB, confirm read-only behavior + Paywall route)
- PDF export, JSON export, Backup now (each works while subscribed; PDF still works while lapsed; backup blocked while lapsed)

- [ ] **Step 4: Push branch + open PR**

```bash
git push -u origin feature/supervisor-accounts
gh pr create --title "Light-theme redesign + paid app" --body "$(cat <<'EOF'
## Summary
- Replaces the industrial dark UI with a calm light-theme system (cream + deep red + Inter)
- Restructures navigation to Today / Records / Me + conditional supervisor Inbox
- Adds role pick at signup (cert first, role fork conditional on L3)
- Moves the app behind a $2.99/mo subscription with a 7-day free trial
- Adds an in-app notification center

Spec: `docs/superpowers/specs/2026-04-30-light-theme-redesign-design.md`
Plan: `docs/superpowers/plans/2026-04-30-light-theme-redesign.md`

## Test plan
- [ ] All Jest suites green (`npx jest --runInBand`)
- [ ] `tsc --noEmit` clean
- [ ] Manual QA from plan Task F4 Step 3 on iOS sim
- [ ] Manual QA same on Android sim
- [ ] App Store Connect sandbox: trial start, lapse, renew

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

After writing this plan I checked it against the spec:

- §1 design system → Phase B (B1, B2)
- §2 navigation + role model → Phase E (E4 conditional Inbox), Phase E (E1 onboarding for role)
- §3 onboarding + paywall → Phase E (E1, E2)
- §4 Today → Phase C (C1)
- §5 Records → Phase C (C2)
- §6 Me + Settings → Phase C (C3)
- §7 Add Work + signing flows → Phase D (D1, D2, D3, D4)
- §8 Notifications surface → Phase A (A2 service, A3 hook), Phase E (E3 screen + write hooks)
- §9 retirement list → Phase F (F1, F2)
- §10 schema migrations → Phase A (A1)
- §11 testing → Phase A (A2, A5 unit), Phase F (F4 manual QA)
- §12 non-goals → respected (no keypair signing, no live multi-device sync, no org accounts, no templates)

No placeholders. No "TBD" or "implement later." Type names match across tasks (`SubscriptionStatus`, `NotificationKind`, `Readiness`). Filenames match the actual codebase.

The plan is intentionally bite-sized at the *test/service* layer (Phase A, parts of Phase E) and chunkier at the *screen-rebuild* layer (Phases C, D), where TDD is less applicable and most of the work is wiring components to existing hooks. That's a deliberate calibration — UI rebuilds are best done with the mockup open and a live simulator, not by writing snapshot tests first.
