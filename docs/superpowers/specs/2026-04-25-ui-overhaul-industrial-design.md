# UI/UX Overhaul — Industrial Aesthetic + Dual-Cert Support — Design Spec

**Date:** 2026-04-25
**Status:** Draft — awaiting user review
**Supersedes:** `docs/superpowers/specs/2026-04-21-ui-overhaul-sprat-rope-aesthetic.md`

## 1. Purpose & success criteria

Replace the existing rope-and-stamp light theme with a dark "industrial gauge panel" aesthetic; introduce dual-cert (IRATA + SPRAT) support across the data model and UI; promote a new Dashboard tab to primary; demote the existing Logbook list to a "View all" sub-screen; absorb the standalone Analytics screen's features into the dashboard.

**In scope:**

- Full visual repaint: every screen gets re-themed (medium-depth panel/rivet treatment).
- Theme tokens, fonts (Michroma + JetBrains Mono), and primitive-set internals — full rewrite.
- Schema migration adds IRATA cert columns to `profile`, renames `entries.tech_level_snapshot` → `entries.sprat_level_snapshot`, and adds `entries.irata_level_snapshot`. Idempotent via `runSchemaMigrations`. SQLite table rebuild for `profile` to drop NOT NULL on existing SPRAT columns. Canonical hash function aliases the renamed column back to the legacy key `tech_level_snapshot` so v2 hashes remain stable.
- New primitives: `Panel`, `Gauge`, `PunchCardRow`, `BreakdownBar`, `RecertStrip`, `StatStrip`, `SegmentedToggle`, `SyncLED`, `FabButton`, `Rivet`, `NoiseTexture`, plus rename `SectionHeader` → `SectionLabel`.
- Navigation: `Dashboard` replaces `Logbook` as the primary tab; `LogbookList` becomes a stack-pushed sub-screen; `Analytics` screen file deleted.
- Onboarding gains a cert-selection step (IRATA / SPRAT / both) and per-cert sub-forms. Existing SPRAT-only users get a one-time dismissible "Add IRATA?" nudge on Dashboard.
- Hours-to-next-level math is per-scheme (IRATA 1000h thresholds; SPRAT 500h thresholds); new "projected eligible" forecast based on a 90-day moving average; new "recert countdown" derived from per-cert expiry.
- `CloudSnapshot` and `JsonBackup` bump `cloud_schema_version` and `schema_version` to 2; v1 → v2 backwards-compat translation in `restoreService`.
- `CLAUDE.md` rewritten to reflect the new aesthetic, IA, and primitive set.

**Out of scope:**

- Light-mode variant. Dropped from "Not yet implemented" in CLAUDE.md.
- Additional cert schemes beyond IRATA + SPRAT.
- Auth changes. Existing Apple / Google / magic-link flow re-skinned only; no flow / provider changes.
- Supervisor flows, push notifications, sign-request mutations, cloud-backup mechanics, signing/integrity logic, RevenueCat / Pro-tier behavior — all re-themed but logic untouched.
- Canonical entry hashing, signature verification, backup snapshot binary-manifest shape — untouched.

**Success criteria:**

- Every screen renders in the new aesthetic without layout regressions on iOS + Android.
- An existing SPRAT-only user upgrades the app, sees their data intact, gets the "Add IRATA?" nudge, and can opt in without data loss.
- A new user can onboard as IRATA-only, SPRAT-only, or dual-cert; the dashboard hides the SegmentedToggle for single-cert users.
- The Dashboard's gauge math is correct per-scheme; recert countdown reflects each cert's expiry; projection forecast uses a 90-day moving average.
- All existing tests still pass; new tests cover dual-cert profile CRUD, per-scheme threshold math, projection forecast, schema migration of legacy SPRAT-only profiles, and v1→v2 snapshot translation.
- Existing v2 entry signatures continue to verify across the migration; existing v1 signatures untouched.
- `npx tsc --noEmit` and `npx jest` clean.

## 2. Key decisions

| Decision | Chosen option | Rationale |
|---|---|---|
| Visual aesthetic | Full repaint to dark industrial-gauge | User-supplied mockup; commits to a single visual language across the app. |
| Coexistence with rope-and-stamp | None — retire it | Avoids the "two aesthetics living in the codebase" cost of a flagged migration. |
| Cert model | Both IRATA and SPRAT supported per user (either, both, or one) | Matches reality: many techs hold both; hours count toward both schemes simultaneously. |
| Schema migration approach | SQLite table rebuild for `profile`; idempotent column adds + rename for `entries` | Drops NOT NULL on legacy SPRAT columns cleanly; rebuild is one-shot, transactional. |
| Hours threshold per scheme | IRATA: L1→L2=1000h, L2→L3=1000h. SPRAT: L1→L2=500h, L2→L3=500h | Canonical industry values. |
| Hours-to-next-level scope | Hours at current level only (filter on `${scheme}_level_snapshot`) | Matches rope-access progression rules; promotion does not double-count past hours. |
| Projection algorithm | 90-day moving average; `<30 days` history → "INSUFFICIENT DATA"; rate=0 → "PROJECTION PAUSED"; ≥target → "ELIGIBLE NOW"; max-level → no projection | Simple, deterministic, explainable to the user. |
| Recert reval-window threshold | 6 months (180 days) before expiry | Matches IRATA practice; close enough to SPRAT to use one rule. |
| Navigation | Bottom tabs preserved; Dashboard | Profile (+ Inbox conditional). Logbook list demoted to stack push from Dashboard's "ALL N →" link | Familiar to existing users; iOS-friendly; supervisor Inbox keeps a persistent home. |
| Header chrome | Brand + version + sync LED. No hamburger. | Hamburger duplicates the Profile tab; SN/serial-number is fake-data flavor. |
| Cert toggle persistence | In-memory only (per-session); default = `profile.primary_cert` | Toggle is a view affordance; primary cert is the source of truth. |
| Entry-related screens redesign depth | Medium — sticky panel header + dark theme tokens; layouts stay close to current | Avoids cramming forms into "instrument-panel" chrome. |
| Analytics screen | Deleted; features absorbed into Dashboard, no Pro gate on dashboard | Standalone analytics screen no longer earns its place once dashboard owns the math. |
| Dark mode planning | Dark-only forever | Aesthetic only works dark; light variant explicitly out of scope. |
| Rollout strategy | Single feature branch, staged commits (schema → tokens → primitives → dashboard → re-theme → cleanup) | Reviewable per commit; bisect-friendly; no runtime theme-flag complexity. |
| Cert hash version | Stays at v2; new `irata_level_snapshot` excluded from canonical hash; renamed `sprat_level_snapshot` aliased back to legacy `tech_level_snapshot` key in canonical input | Either change alone would invalidate every existing v2 signature. v3 is a future spec. |
| Cloud snapshot version | Bump to `cloud_schema_version: 2` and `schema_version: 2` | Older clients refuse v2 snapshots via existing `version_too_new` safety. |
| v1 cloud snapshot restore | Backwards-compat translation in `restoreService.restore()` | Never-upgraded device's cloud is always restorable on an upgraded device. |

## 3. Architecture overview

### 3.1 Theme tokens + fonts

`theme/tokens.ts` and `theme/typography.ts` are rewritten. `ThemeProvider`'s public API stays the same — screens call `useTheme()` and destructure `{ colors, spacing, typography, radii }`. Token keys under those buckets are renamed; one search/replace pass migrates call sites.

**Fonts.**
- **Michroma** (display/stencil) — section labels, brand mark, button labels, gauge unit text. Add `@expo-google-fonts/michroma`. Loaded eagerly at app boot.
- **JetBrains Mono** — already a dep. Weights 400, 500, 700, 800. Numeric values use `font-variant-numeric: tabular-nums`.
- No third font; the existing system-font fallback is dropped.

**Color tokens** (`theme/tokens.ts` exports under `colors.*`):

| key | hex | role |
|---|---|---|
| `bg.base` | `#0a0b0d` | page background |
| `bg.raised` | `#111418` | raised surfaces (e.g., sticky tab bar) |
| `bg.panel` | `#181c22` | panel face (cards, inputs) |
| `bg.inset` | `#1f242b` | inset within panel (e.g., progress track inner) |
| `edge.base` | `#262c34` | default border / divider |
| `edge.hi` | `#3a4048` | highlighted border (panel top, focused inputs) |
| `edge.bright` | `#515864` | rivet highlight, machined-metal edge |
| `ink.primary` | `#dde3eb` | primary text |
| `ink.secondary` | `#a3abb6` | secondary text (entry meta, body small) |
| `ink.tertiary` | `#616977` | labels, hints, dimmed metadata |
| `ink.disabled` | `#3f4650` | placeholders, disabled |
| `accent.base` | `#ff5a1f` | primary CTA, focus ring, gauge progress mid |
| `accent.hot` | `#ff7a3d` | gauge needle, glow highlight, hover |
| `accent.deep` | `#c63f10` | gauge progress start, pressed state |
| `status.warn` | `#f5a524` | recert strip, pending sig, projected-eligible |
| `status.ok` | `#3fb950` | sync LED active, signed sig, "ELIGIBLE NOW" |
| `status.err` | `#e5484d` | missing sig, hash failure, error banners |
| `cert.l1` | `#6fb7ff` | chip color for L1 entries |
| `cert.l2` | `#ffb857` | chip color for L2 entries |
| `cert.l3` | `#ff7a3d` | chip color for L3 entries (== accent.hot) |

**Type scale** (`theme/typography.ts`):

| token | font | size | weight | letter-sp | use |
|---|---|---|---|---|---|
| `display` | JBM | 46 | 800 | -0.02em | gauge numerator |
| `h1` | JBM | 24 | 800 | -0.02em | screen title |
| `h2` | JBM | 18 | 700 | -0.01em | sub-section title |
| `body` | JBM | 14 | 400 | 0 | default body |
| `bodyBold` | JBM | 14 | 700 | 0 | emphasis body |
| `bodySmall` | JBM | 12 | 400 | 0.02em | dense meta |
| `numeric` | JBM | 22 | 700 | -0.02em | stat values; tabular-nums |
| `caption` | JBM | 10 | 500 | 0.04em | secondary meta |
| `mono` | JBM | 13 | 500 | 0 | code, IDs, hashes |
| `stencil` | Michroma | 9.5 | 400 | 0.22em | section labels |
| `stencilSm` | Michroma | 8.5 | 400 | 0.20em | meta labels |
| `stencilLg` | Michroma | 11 | 400 | 0.18em | brand, button labels |

**Spacing** — keep the existing 4px-base `xs(4) sm(8) md(12) base(16) lg(20) xl(24) xxl(32)` scale. No API change.

**Radii** — industrial aesthetic = sharp.

| key | px | use |
|---|---|---|
| `none` | 0 | panels, cards, inputs, buttons |
| `xs` | 2 | chips |
| `sm` | 4 | toggle thumb |
| `pill` | 999 | sync LED, rivets, gauge needle hub |

The existing `md(12)` and `lg(16)` radii are dropped (no rounded surfaces survive).

**Touch targets** — preserve the 48px-minimum / 56px-preferred glove-use guarantee. Dense visual rows pad hit area to 48×48 via invisible touchable wrappers.

**Effects.**
- **Machined-metal noise**: 1-bit static SVG noise overlay at ~2% opacity on raised surfaces. Reusable `<NoiseTexture/>` primitive.
- **Accent glow** on the gauge progress arc and FAB: `react-native-svg` `<filter>` on web; on RN native, layered semi-transparent stroke + `shadowColor: accent.base` + `shadowOpacity: 0.35`.
- **LED pulse** on sync status: `Animated.Value` 2.2s loop, opacity 1↔0.55.
- **Rivets** at panel corners: 5×5 px circles with radial-gradient inner highlight via small SVG component.

### 3.2 Primitive set (`src/primitives/`)

**Kept (rebuilt internals; same name + same public API):**
`Screen`, `Button`, `IconButton`, `Input`, `Textarea`, `Card`, `Badge`, `Banner`, `Chip`, `ListRow`, `EmptyState`, `ProgressBar`, `LoadingSpinner`, `ProBadge`.

**Renamed:**
- `SectionHeader` → `SectionLabel`. New API: `<SectionLabel index="01" label="CERTIFICATION STATUS" />`. One search/replace pass migrates call sites.

**Retired (deleted):**
- `RopeDivider`, `StampBadge`. The rope-and-stamp motifs are gone.

**New:**
- `Panel` — heavy industrial container (rivet at each corner, top-edge highlight, optional corner-mark, optional header strip with stencil label + tag chip).
- `Gauge` — semi-circular SVG: background arc, gradient progress arc with glow filter, tick ring (41 ticks, 5-major), needle, center number slot.
- `PunchCardRow` — entry row with day/month "punch" tile + body + chip + sig status.
- `BreakdownBar` — label + `ProgressBar` + value-with-unit; `emphasis?: boolean` toggles orange-gradient vs gray fill.
- `RecertStrip` — amber/red-bordered strip with diamond `!` icon, primary text, sub-text, days countdown.
- `StatStrip` — three-up tile grid; type-enforced exactly 3 tiles.
- `SegmentedToggle` — 2-segment grid with stencil label + sub-line; active segment has orange underline + glow.
- `SyncLED` — pulsing dot + label; status colors `ok`/`warn`/`err`/`disabled`.
- `FabButton` — large stencil orange CTA with gradient fill + plus glyph in 2px circle.
- `Rivet` — 5×5 rivet circle with radial-gradient inner highlight.
- `NoiseTexture` — static SVG noise overlay at ~2% opacity.

**Barrel export.** `src/primitives/index.ts` re-exports everything except `Rivet` and `NoiseTexture` (consumers import those directly, mirroring existing `ProBadge` handling).

**Composite components** (`src/components/`) — `ProfileCloudSection`, `DeleteAccountModal`, `SupervisorsSection` — get re-themed via primitive-internal changes; no API changes.

### 3.3 Data model

#### Profile schema (target)

```sql
CREATE TABLE profile (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,

    -- SPRAT block (was NOT NULL; now nullable)
    holds_sprat INTEGER NOT NULL DEFAULT 1,
    sprat_id TEXT,
    level TEXT CHECK (level IS NULL OR level IN ('I','II','III')),
    cert_expires_on TEXT,
    sprat_card_photo_path TEXT,

    -- IRATA block (new, all nullable)
    holds_irata INTEGER NOT NULL DEFAULT 0,
    irata_id TEXT,
    irata_level TEXT CHECK (irata_level IS NULL OR irata_level IN ('I','II','III')),
    irata_expires_on TEXT,
    irata_card_photo_path TEXT,

    -- Drives the dashboard cert-toggle default
    primary_cert TEXT NOT NULL DEFAULT 'sprat' CHECK (primary_cert IN ('irata','sprat')),

    -- Existing extras (unchanged)
    default_employer TEXT NOT NULL DEFAULT '',
    last_backup_at TEXT,
    photos_in_backup INTEGER NOT NULL DEFAULT 0,
    last_cloud_backup_at TEXT,
    last_uploaded_backup_id TEXT,
    supervisor_capability_enabled INTEGER NOT NULL DEFAULT 0,
    supervisor_cert_number TEXT,
    supervisor_directory_visible INTEGER NOT NULL DEFAULT 1,
    subscription_tier TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

**Migration via SQLite table rebuild** — guarded by `!hasColumn(db, 'profile', 'holds_irata')`, runs once per device, wrapped in `BEGIN; ... COMMIT;`. Creates `profile_new` with the target schema, copies all rows over with `holds_sprat=1, holds_irata=0, primary_cert='sprat', irata_*=NULL`, drops the old table, renames `profile_new` → `profile`.

#### Entries schema changes

```sql
ALTER TABLE entries RENAME COLUMN tech_level_snapshot TO sprat_level_snapshot;
ALTER TABLE entries ADD COLUMN irata_level_snapshot TEXT
    CHECK (irata_level_snapshot IS NULL OR irata_level_snapshot IN ('I','II','III'));
```

Both guarded for idempotency. The rename uses `ALTER TABLE ... RENAME COLUMN` (SQLite 3.25+, supported by `expo-sqlite` 16). Code-wide rename of `tech_level_snapshot` → `sprat_level_snapshot` happens in the same commit.

**Canonical hash compatibility.** `entryRowToHashInputV2` builds the canonical input dictionary; the SPRAT level snapshot is part of v2 hash. To preserve v2 hash stability across the rename, `entryRowToHashInputV2` is updated to read from the new `sprat_level_snapshot` column (or the old `tech_level_snapshot` column on a still-unmigrated row) and write it under the legacy key `tech_level_snapshot` in the canonical input. The new `irata_level_snapshot` column is **not** added to the canonical input — including it would invalidate every existing v2 signature. Both behaviors are tested explicitly (Section 6).

New entries snapshot whichever certs the user holds. Legacy entries keep `irata_level_snapshot = NULL`.

#### Type changes (`src/types.ts`)

```ts
type CertScheme = 'irata' | 'sprat';
type CertLevel = 'I' | 'II' | 'III';

interface CertBlock {
  id: string;
  level: CertLevel;
  cert_expires_on: string;     // YYYY-MM-DD
  card_photo_path: string | null;
}

interface Profile {
  id: string;
  full_name: string;
  holds_sprat: boolean;
  sprat: CertBlock | null;     // present iff holds_sprat
  holds_irata: boolean;
  irata: CertBlock | null;     // present iff holds_irata
  primary_cert: CertScheme;
  default_employer: string;
  // ... existing fields
}

interface Entry {
  // ... unchanged fields
  sprat_level_snapshot: CertLevel | null;
  irata_level_snapshot: CertLevel | null;
}
```

The persistence layer flattens / unflattens between the row shape and the typed `CertBlock | null` shape.

#### Cloud / JSON snapshot

Both bump:
- `cloud_schema_version: 2` (was 1)
- `schema_version: 2` (was 1)
- `MAX_CLOUD_SCHEMA_VERSION` and `MAX_DB_SCHEMA_VERSION` in `restoreService` bump to 2.

**Backwards-compat read path for v1 snapshots:**

| v1 field | v2 destination |
|---|---|
| `profile.sprat_id` | `profile.sprat_id` (unchanged) |
| `profile.level` | `profile.level` (unchanged) |
| `profile.cert_expires_on` | `profile.cert_expires_on` (unchanged) |
| `profile.sprat_card_photo_path` | unchanged |
| *(absent)* | `holds_sprat = 1, holds_irata = 0, primary_cert = 'sprat', irata_* = NULL` |
| `entries[].tech_level_snapshot` | `entries[].sprat_level_snapshot` |
| *(absent)* | `entries[].irata_level_snapshot = NULL` |

The translation is a single `if (snap.cloud_schema_version === 1) { ... }` branch in `restoreService.restore()` before the local `INSERT` step.

#### Service-layer touch points

- `profileService.createProfile` — new shape: `{ full_name, primary_cert, holds_sprat, sprat?: CertBlockInit, holds_irata, irata?: CertBlockInit, default_employer? }`. Validates that at least one of `holds_sprat`/`holds_irata` is true.
- `profileService.updateProfile` — `updateSpratCert(...)`, `updateIrataCert(...)`, `togglePrimaryCert(...)`.
- `entriesService.createEntry` / `createDraft` / `createAmendment` — snapshot writes both level columns when the user holds both certs; null for unheld scheme.

### 3.4 Navigation

`src/navigation/RootNavigator.tsx` changes:

- `MainTab` (bottom tabs) — `Dashboard` (new, primary), `Profile`, conditional `Inbox`. The previous `Logbook` tab is removed.
- `MainStack` (above tabs) — adds `LogbookList` as a stack-pushed sub-screen reachable from Dashboard's "ALL N →" link. Adds `EditCert` modal (cert add/edit, used by Onboarding step 3 and Profile cert section).
- `Analytics` screen registration — removed.

Tab bar rendering: 56px tall, `bg.raised`, top hairline `edge.hi`. Active tab gets an orange underline (matches `SegmentedToggle` active state). Icons remain `lucide-react-native` sources, tinted `ink.primary` (active) / `ink.tertiary` (inactive).

Top-level header default `headerShown: false` for stack screens — every screen has visible navigation context via the new sticky-top panel chrome (back chevron in panel header strip when pushed).

### 3.5 Screens

#### `DashboardScreen` (new, primary tab)

Layout top → bottom:
1. Status header (brand `RA/LOG` + version + `SyncLED`).
2. **Banner stack** (above section 01): "Add IRATA?" if eligible; level-eligibility banner (existing `useMilestones` logic, moved from LogbookScreen); backup-reminder banner (existing, moved from LogbookScreen).
3. `SectionLabel "01 · CERTIFICATION STATUS"`.
4. `SegmentedToggle` (IRATA / SPRAT) — hidden when only one cert is held.
5. `Panel` containing `Gauge` + 2-up meta footer (REMAINING + projection).
6. `RecertStrip` for the active cert.
7. `SectionLabel "02 · AT A GLANCE"` + `StatStrip`.
8. `SectionLabel "03 · RECENT ENTRIES"` with right-aligned "ALL N →" link → 5× `PunchCardRow`.
9. `SectionLabel "04 · WORK BREAKDOWN · YTD"` + `BreakdownBar` rows (descending, hours > 0 only).
10. Sticky-bottom `FabButton "NEW ENTRY"`.

Cert toggle is **stateful in component memory only**, defaulting to `profile.primary_cert`. App relaunch resets to `profile.primary_cert`. Switching primary requires Profile-screen action.

Pro gating: dashboard itself is free; no Pro affordances.

#### `ProfileScreen`

Sections (all wear `SectionLabel` separators):
- **ACCOUNT** — name, email, sign-out.
- **CERTIFICATIONS** — per-cert `Panel` (IRATA, SPRAT) with ID/level/expiry/photo + Edit button. Add buttons for unheld certs. Inline radio for `primary_cert`.
- **CLOUD** — existing `ProfileCloudSection`, re-themed.
- **SUPERVISORS** — existing `SupervisorsSection`, re-themed.
- **SUBSCRIPTION** — tier chip (`ProBadge`/Free), `Manage` opens Paywall.
- **DATA** — Export JSON, Export PDF, Delete account.

`EditCert` modal: cert-block fields (ID, level, expiry, optional card photo). Same screen used for "Add" and "Edit". Removing a cert (button at bottom) sets `holds_X = 0` after confirm; auto-flips primary if needed; blocks if it would leave the profile with no certs.

#### `OnboardingScreen` (multi-step)

1. **Name** — `Input "FULL NAME"`, Continue.
2. **Cert selection (new)** — `SectionLabel "CERTIFICATIONS"` + two toggleable `Panel`-based tiles (IRATA, SPRAT). At least one must be selected. Below: "Which is your primary?" radio (only shown if both checked).
3. **Cert details** — shown once per checked cert. Same fields as `EditCert` modal. IRATA first if held, then SPRAT.
4. **Done** — stencil "READY" with FAB-style "ENTER LOGBOOK".

Page indicator: row of 4 outlined squares (active = orange-fill). Every step has explicit Back/Continue buttons (no header gap).

#### `LogbookListScreen` (formerly `LogbookScreen`)

- Sticky header: title "ALL ENTRIES" + count, search/filter `IconButton`s.
- `SectionList` grouped by month-year (existing logic). Section headers use `SectionLabel`. Rows use `PunchCardRow`.
- Empty state: `EmptyState "Your logbook is empty"` + `FabButton "START LOGGING"`.
- The level-eligibility and backup-reminder banners that lived here **move to Dashboard**.

#### `EntryFormScreen`, `EntryDetailScreen`, `SignatureScreen`

Re-theme medium depth — sticky panel header strip with stencil title + back chevron + action `IconButton`s; body uses inset-bezel inputs (form), `Panel` groups (detail), or rivet-framed canvas (signature). Behavior unchanged. EntryDetail's hash-verify status renders as a `SyncLED`-style chip: green "INTEGRITY OK" / red "TAMPERED" / orange "SIG IMAGE MISSING".

#### `InboxScreen`, `SupervisorSearchScreen`, `SignRequestDetailScreen`

Re-theme only. Logic unchanged.

#### `AuthScreen`, `MagicLinkWaitScreen`

Re-theme only. Same flow (Apple, Google, magic link).

#### `PaywallScreen` (modal), `CloudConflictScreen`

Re-theme; both fit the panel/rivet aesthetic naturally. `CloudConflictScreen` uses two side-by-side `Panel`s ("KEEP CLOUD" vs "REPLACE CLOUD") with the existing confirm dialog.

#### `AnalyticsScreen` — deleted

File `src/screens/AnalyticsScreen.tsx` removed in commit 6 (cleanup). Pro gate that previously routed Profile → Paywall when `tier !== 'pro'` is removed. Analytics math moves into `useWorkBreakdown` and `useDashboardStats` hooks.

### 3.6 Cert progress + projection (`src/services/certProgressService.ts`)

```ts
export const HOURS_THRESHOLDS = {
  irata: { I: 1000, II: 1000, III: null },
  sprat: { I:  500, II:  500, III: null },
} as const;

interface CertProgress {
  scheme: CertScheme;
  currentLevel: CertLevel;
  isMaxLevel: boolean;
  target: number | null;
  hoursAtLevel: number;
  remaining: number;
  isEligible: boolean;
  projection: Projection;
}

type Projection =
  | { kind: 'eligible-now' }
  | { kind: 'projected'; date: Date; daysOut: number; hoursPerDay: number }
  | { kind: 'insufficient-data' }
  | { kind: 'paused' }
  | { kind: 'max-level' };

interface RecertStatus {
  scheme: CertScheme;
  expiresOn: string;
  daysToExpiry: number;
  state: 'safe' | 'reval-open' | 'expires-today' | 'expired';
}
```

**Hours-at-level**: `SELECT COALESCE(SUM(work_hours), 0) FROM entries WHERE ${scheme}_level_snapshot = :level AND status IN ('signed','amended')`. Drafts and pending-sign-request entries excluded.

**Projection algorithm:**
1. If `target === null` → `max-level`.
2. If `hoursAtLevel >= target` → `eligible-now`.
3. Compute `daysOfHistory` = (today − oldest entry at current level). If `< 30` → `insufficient-data`.
4. Compute `recentHours` = sum over last 90 days at current level. `hoursPerDay = recentHours / 90`.
5. If `hoursPerDay === 0` → `paused`.
6. Else: `daysOut = ceil((target − hoursAtLevel) / hoursPerDay)`; `date = today + daysOut`. → `projected`.

**Render mapping** (Gauge meta footer's right slot):

| projection.kind | label | color |
|---|---|---|
| `eligible-now` | `ELIGIBLE NOW` | `status.ok` |
| `projected` | e.g. `NOV 2026` | `status.warn` |
| `insufficient-data` | `INSUFFICIENT DATA` | `status.warn` |
| `paused` | `PROJECTION PAUSED` | `ink.tertiary` |
| `max-level` | `MAX LEVEL` | `status.ok` |

Hero panel switches presentation by kind:
- `max-level` — gauge replaced by stencil "L III" centered, lifetime hours below, no remaining/projection footer.
- `eligible-now` — gauge at full sweep; meta footer shows `ELIGIBLE NOW` and a `Button "RECORD LEVEL UP"` opening EditCert modal pre-set to next level.
- All others — gauge with progress + 2-up footer.

**Recert** computed per cert held:

| state | sub-text | days color | strip border |
|---|---|---|---|
| `safe` (>180d) | `RECERT NOT YET DUE` | `ink.tertiary` | `edge.base` |
| `reval-open` (≤180d, >0) | `EXP · DD MMM YYYY · REVAL WINDOW OPEN` | `status.warn` | `status.warn` |
| `expires-today` (=0) | `EXPIRES TODAY` | `status.err` | `status.err` |
| `expired` (<0) | `EXPIRED · DD MMM YYYY` | `status.err` | `status.err` (subtle pulse) |

`RecertStrip` always visible for the active cert. Tapping opens a sheet with full cert details + "Update expiry" button.

### 3.7 Stat strip + work breakdown

`useDashboardStats(year)`:
```ts
{
  lifetimeHours: number;          // existing getTotalWorkHours()
  thisYearHours: number;          // existing getTotalWorkHours(year)
  lastYearHours: number;          // new: getTotalWorkHours(year - 1)
  yoyDelta: number;
  totalJobs: number;              // count(entries) signed+amended, lifetime
  totalSites: number;             // count(distinct site) same filter
}
```

**THIS YEAR** sub-line:
- delta > 0 → `+12.5 vs ly` in `status.ok`
- delta < 0 → `-12.5 vs ly` in `status.err`
- delta === 0 → `same as ly`
- `lastYearHours === 0` → `first year`

**JOBS** sub-line: `${totalSites} sites`.

`useWorkBreakdown(year)`:
```ts
{
  items: { workType: WorkType; hours: number }[];   // sorted desc, hours > 0 only
  maxHours: number;
}
```

Filter: `status IN ('signed','amended')` AND `date_from` in requested year. Multi-work-type entries' hours count toward each type (intentional double-counting for breakdown).

Render: top 2 bars use `accent` gradient; rest use gray gradient (`emphasis` prop).

### 3.8 React Query hooks

New hooks in `src/hooks/`:
- `useCertProgress(scheme: CertScheme): { data: CertProgress | null }`
- `useRecert(scheme: CertScheme): { data: RecertStatus | null }`
- `useDashboardStats(year: number): { data: DashboardStats }`
- `useWorkBreakdown(year: number): { data: WorkBreakdown }`

All four invalidate on the `entries` query key (signing/amending/creating refreshes the dashboard) and on `profile` (editing cert details refreshes recert + max-level state).

`useMilestones` is refactored to call `certProgressService` so the level-upgrade banner stays in lockstep with the dashboard.

## 4. Rollout strategy

Single feature branch `feature/ui-industrial-overhaul`, landed in reviewable commits:

1. **Schema first** — idempotent profile rebuild + entries column rename + `irata_level_snapshot` add + canonical-hash alias in `entryRowToHashInputV2` for v2 stability. No UI changes; existing screens still work.
2. **Theme tokens + fonts** — rewrite `theme/tokens.ts` and `theme/typography.ts`; install `@expo-google-fonts/michroma`; preload fonts in `App.tsx`; update `ThemeProvider`; rebuild every existing primitive's internals to consume new tokens. After this commit, every existing screen renders dark with the same layout.
3. **New primitives** — pure additions; no screen edits.
4. **Dashboard + IA changes** — new `DashboardScreen`, `LogbookListScreen` (rename), `EditCert` modal; replace Logbook tab with Dashboard tab; new `useDashboardStats` / `useCertProgress` / `useRecert` / `useWorkBreakdown` hooks; `certProgressService.ts`; Onboarding cert-selection step; "Add IRATA?" banner.
5. **Re-theme remaining screens** — `EntryFormScreen`, `EntryDetailScreen`, `SignatureScreen`, `ProfileScreen`, `InboxScreen`, `SignRequestDetailScreen`, `SupervisorSearchScreen`, `AuthScreen`, `MagicLinkWaitScreen`, `CloudConflictScreen`, `PaywallScreen`. Apply medium-depth panel chrome; re-theme composite components.
6. **Cleanup** — delete `AnalyticsScreen.tsx`; retire `RopeDivider` + `StampBadge`; rewrite `CLAUDE.md`; mark `2026-04-21-ui-overhaul-sprat-rope-aesthetic.md` superseded; bump `cloud_schema_version` + `schema_version` to 2 + add v1→v2 translation in `restoreService` + bump `MAX_*_VERSION` constants.

## 5. Migration + backwards compatibility

### 5.1 First-launch sequence (post-upgrade)

In `App.tsx`'s bootstrap:
1. **Font preload (new)** — `useFonts({ Michroma_400Regular, JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold, JetBrainsMono_800ExtraBold })`. While `fontsLoaded === false`, render the dark `LoadingSpinner` against `bg.base`.
2. **`initializeDatabase()`** — runs profile rebuild + entries rename + `irata_level_snapshot` add inside a SQLite transaction. Rebuild is one-shot per device, gated on `!hasColumn(db, 'profile', 'holds_irata')`.
3. **`runHashMigration`** — unchanged.
4. **RevenueCat init / AppState listener / deep-link listener** — unchanged.

### 5.2 "Add IRATA?" nudge for SPRAT-only legacy users

AsyncStorage key `logbook:add_irata_nudge_dismissed_at` (ISO string or null). One-shot per device.

Trigger conditions on every Dashboard mount:
- `profile.holds_irata === false` AND
- AsyncStorage key is null AND
- profile is at least 1 day old.

Render: `Banner` (info variant, dismissable) above section 01. Two actions: `Add IRATA` (pushes EditCert modal pre-set to IRATA) and `Dismiss`. Dismissing writes the timestamp to AsyncStorage. After the user adds IRATA, the trigger no longer evaluates true.

### 5.3 In-flight drafts and pending signatures

The migration is structural only.
- Draft entries with `tech_level_snapshot` → renamed to `sprat_level_snapshot`. No data loss.
- Pending-sign-request entries preserve all state. `applyIncomingSignature` writes to the renamed column transparently.
- Signed entries' `entry_hash` is unaffected because: (a) the canonical hash function does not include `irata_level_snapshot` (deliberately excluded — Section 2 decision table); (b) the renamed `sprat_level_snapshot` column is aliased back to the legacy key `tech_level_snapshot` in `entryRowToHashInputV2` for canonical-input purposes, preserving v2 hash compatibility. Enforced by an explicit unit test that hashes a row before migration, runs the migration, and re-hashes — identical hash required.

### 5.4 Cloud snapshot upgrade timing

1. App starts; schema migrates locally to v2 (`holds_sprat=1, holds_irata=0, primary_cert='sprat'`).
2. Dashboard renders; user works as normal.
3. Next `cloudBackupService.backup()` trigger uploads a v2 `CloudSnapshot`. Previous v1 `snapshot.json` is overwritten atomically per existing semantics.
4. From this point, the user's cloud is v2. Restoring on a non-upgraded device refuses with `version_too_new`.

Multi-device with one device upgraded and one not: older device sees v2 cloud and refuses. Once both upgrade, both restore from v2.

### 5.5 Reinstall before backing up post-upgrade

Fresh install on the same account → `previewCloudState` reads v1 → `restoreService.restore()` takes the v1→v2 backwards-compat branch and writes into the new schema. Newly-installed device starts at v2 immediately. Next backup uploads v2.

### 5.6 Failure modes

- **Schema rebuild fails partway** — `BEGIN; ... COMMIT;` rolls back. Next launch retries from the beginning.
- **Font load fails** — `useFonts` resolves with system fallback. Cosmetic only.
- **v1 snapshot restore encounters unknown fields** — translation branch ignores unknown keys (existing forward-compat behavior). No regression.

### 5.7 OTA-shippability

All changes are JS / asset only — no new native modules; `react-native-svg` and `react-native-purchases` already in deps. The redesign can ship as a single `eas update --branch preview` after a preview build is in users' hands. A fresh `eas build --profile preview` is recommended for QA regardless.

### 5.8 Documentation updates (commit 6)

- **`CLAUDE.md`** — replace rope-and-stamp paragraph with new industrial aesthetic; update primitive-set list; rewrite "Navigation" section; remove "Dark mode" from "Not yet implemented"; add "Industrial UI overhaul" section pointing at this spec.
- **`README.md`** — bump screens listing.
- **`docs/superpowers/specs/2026-04-21-ui-overhaul-sprat-rope-aesthetic.md`** — prepend `## SUPERSEDED` block at top, reference this spec.
- **`docs/superpowers/specs/2026-04-17-entry-logging-enhancements-design.md`** — annotate "no visible back chevron" UX gap as resolved by sticky-top panel chrome.

## 6. Testing plan

Suite is currently 17 files / 150 tests. Estimate **18 files / ~170 tests** at completion.

### 6.1 New test file

**`__tests__/services/certProgressService.test.ts`**:
- Threshold lookups for both schemes.
- `getHoursAtLevel`: filters by level snapshot AND `status IN ('signed','amended')`; drafts and pending-sign-request entries excluded.
- Cert progress for both schemes with the same entry data.
- Max-level handling (L3 → `kind: 'max-level'`, `target: null`).
- Eligible-now: `hoursAtLevel >= target` regardless of recent rate.
- Projection branches: `daysOfHistory < 30` → insufficient-data; rate=0 → paused; positive rate → projected.
- Recert state transitions across day boundaries: 181→safe, 180→reval-open, 0→expires-today, -1→expired.
- IRATA-only profile: SPRAT progress is `null`. Same with SPRAT-only.
- Legacy entries (irata_level_snapshot=NULL): zero hours toward IRATA progress.

### 6.2 Extended test files

- **`__tests__/db/migrations.test.ts`** — profile table rebuild preserves all values + sets correct flags; idempotent re-run; `tech_level_snapshot` rename + `irata_level_snapshot` add succeed and are idempotent. Schema-drift check via canonical schema vs migration result.
- **`__tests__/services/profileService.test.ts`** — IRATA-only / SPRAT-only / dual-cert creation; rejects "holds neither cert"; cert-block updates patch only the targeted block; `togglePrimaryCert` rejects switching to unheld cert; cert removal blocked when sole cert; auto-flips primary when removing primary while other held; round-trip via typed `Profile` shape.
- **`__tests__/services/entriesService.test.ts`** — snapshot writes both levels for dual holder, only the held scheme(s) for single-cert; legacy NULL `irata_level_snapshot` round-trips; stat-strip math; work-breakdown tally with multi-work-type entries; status filter excludes drafts and pending.
- **`__tests__/services/restoreService.test.ts`** — v1→v2 translation populates new fields correctly; v2 round-trips; v3+ rejected with `version_too_new`.
- **`__tests__/services/cloudBackupService.test.ts`** (or closest existing backup test) — backup writes `cloud_schema_version: 2` + `schema_version: 2`; new IRATA fields included when held, omitted when null.
- **`__tests__/services/signingService.test.ts`** — hash a row before migration, run migration, re-hash → identical hash (proves the canonical alias works); `irata_level_snapshot` not included in canonical hash input; dual-cert entries sign and verify identically to single-cert.
- **`__tests__/utils/canonical.test.ts`** — `irata_level_snapshot` excluded from canonical hash input; `sprat_level_snapshot` value appears in canonical input under the legacy key `tech_level_snapshot` (alias verified directly).
- **`__tests__/utils/entryPayloadHash.test.ts`** — `computeEntryHashFromPayload` parity with both level snapshots.

### 6.3 Test infrastructure

- **`__tests__/setup.ts`** — `createTestClient()` builds the canonical (post-migration) schema. Add `createPreDualCertTestClient()` for the immediately-prior schema (SPRAT-only profile with NOT NULL columns + `tech_level_snapshot`). Existing `createLegacyTestClient` stays for older pre-cloud-column tests.
- `__tests__/testHash.ts`, `__tests__/cloudMock.ts`, `__tests__/fsMock.ts` — unchanged.

### 6.4 Out of scope for unit tests

Real Supabase round-trips, OAuth, deep-link resolution, Edge Function invocation — manual QA. Same applies to Dashboard layout, `SegmentedToggle` interaction, `Gauge` SVG rendering, `RecertStrip` color states.

### 6.5 Determinism

Projection and recert math take `today: Date` as injected parameter, mirroring the existing `clock` injection in `cloudBackupService` and `signingService`. Tests pass deterministic `today`; production callers pass `new Date()`.

### 6.6 CI smoke

`npx jest --runInBand` clean. `npx tsc --noEmit` clean. No new CI configuration needed.

### 6.7 Manual QA checklist (post-merge, pre-release)

- iOS + Android cold-start with fresh install: Onboarding → cert selection → both certs → dashboard renders.
- iOS + Android upgrade-in-place from a build with v1 schema: schema migration runs, dashboard renders SPRAT default, "Add IRATA?" banner appears next day.
- IRATA-only profile created from scratch: dashboard hides the SegmentedToggle, hero panel shows IRATA gauge, recert strip pulls IRATA expiry.
- SPRAT-only legacy profile that adds IRATA via the banner: IRATA cert lands at L1 with 0/1000 hours; toggle appears; switching shows correct gauges.
- Restore-from-v1-cloud on a fresh-install upgraded device: schema lands as v2 with SPRAT-only data; "Add IRATA?" banner queues normally.
- Restore-from-v2-cloud on a fresh-install upgraded device: dual-cert profile lands intact.
- Pre-upgrade signed entries: hash verification still passes; integrity banner stays green.
- Pending-sign-request entries: lock survives migration; supervisor signature applies cleanly.

## 7. Open questions

None at design time. All raised during brainstorming were resolved.
