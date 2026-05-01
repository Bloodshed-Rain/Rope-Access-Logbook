# Light-theme redesign + paid app — design

Date: 2026-04-30
Status: Draft, awaiting plan

## 0. Scope and intent

Replace the just-shipped industrial dark gauge-panel UI with a calm light-theme system (cream + deep red + Inter), restructure navigation to **Today / Records / Me** with a conditional supervisor **Inbox** tab, add a role pick at signup, gate the entire app behind a paid subscription with a 7-day free trial, and add an in-app notification center.

This is one big-bang replacement on a single feature branch. The industrial overhaul is treated as a discarded experiment; its primitives, tokens, fonts, and Pro-tier gating are removed. The **services and DB layer survive untouched** except for additive columns (a `notifications` table; `subscription_tier` → `subscription_status` rename).

The 15 unpushed commits on `feature/supervisor-accounts` (industrial overhaul, dual-cert, Apple sign-in, EAS Updates wiring, magic-link fix) stay on the branch — services and schema work in those commits is still load-bearing. Only the UI shell from those commits is replaced.

## 1. Design system

### Colors (theme/tokens.ts)

```
bg.app          #FAF7F2   warm off-white, primary background
bg.surface      #FFFFFF   cards, sheets
bg.muted        #F5F2ED   inputs, inset blocks
border          #E5E7EB
divider         #ECEAE5

text.primary    #111827
text.secondary  #6B7280
text.disabled   #9CA3AF

accent.primary  #B71C1C   CTAs, hero progress, focus rings
accent.pressed  #8E1212
accent.tint     #FCEAEA   pressed surfaces, highlights

status.ok       #16A34A   signed
status.warn     #F59E0B   draft / awaiting / needs signature / lapse-soon
status.err      #DC2626   expired, lapsed
status.info     #2563EB   informational

certL1         #2563EB   (blue)        L1 chip
certL2         #D97706   (deep amber)  L2 chip
certL3         #15803D   (deep green)  L3 chip — distinct from accent.primary so it doesn't read as a CTA
```

All legacy industrial token aliases are deleted. Code referencing them won't compile, which is the intended forcing function.

### Typography — Inter only

```
title1     28/34 semibold     screen titles, hero numerics
title2     20/28 semibold     section titles
body       16/24 regular      paragraph text
bodyMed    16/24 medium       emphasized body
label      14/20 medium       small labels, captions on cards
caption    12/16 regular      metadata, timestamps
```

JetBrains Mono and Michroma fonts are removed from `app.config.ts` font loaders; Inter is added.

### Shape & spacing

- Radii: `sm 8`, `md 12` (default card), `lg 16`, `pill 999`
- Spacing base 4px stays (`xs|sm|md|base|lg|xl|xxl`)
- Touch targets: 44pt minimum (Apple HIG default). The industrial 48/56px "glove use" rule is dropped.

### Status pill colors (Records, EntryDetail)

Mockup uses minimal hue differentiation. Map all "in-progress" states to amber and signed to green:

```
Drafts            amber  (status.warn)
Needs signature   amber
Awaiting          amber
Signed            green  (status.ok)
Amended           muted gray (text.secondary)
```

Differentiation across the three amber states is by **label**, not color.

## 2. Navigation + role model

### Tab structure

Bottom tabs render conditionally on `profile.supervisor_capability_enabled`:

- Capability OFF → **Today / Records / Me** (3 tabs)
- Capability ON → **Today / Records / Inbox / Me** (4 tabs)

`InboxScreen` is re-themed but otherwise unchanged: pending invites + incoming sign-requests.

### Stack screens

- `EntryForm` — rebuilt as 2-step
- `EntryDetail` — re-themed
- `Signature` — in-person sign flow, re-themed
- `SendSignRequest` — modal (rebuilt to match mockup)
- `SupervisorSearch`, `SignRequestDetail` — re-themed
- `Auth`, `MagicLinkWait`, `CloudConflict` — re-themed
- `Paywall` — rebuilt; handles both onboarding-trial-start and re-presented lapse
- `Notifications` — new, target of the bell icon

### Role model

Single account shape. The signup role pick is sugar over existing columns:

- "I'm a tech" → `supervisor_capability_enabled = false`
- "I'm a supervisor" (only offered when at least one cert is L3) → `supervisor_capability_enabled = true` + capture `supervisor_cert_number` + default `supervisor_directory_visible = true`

L3 unlock path stays: a tech who later updates their cert level to L3 sees a one-time "You can now sign for others" prompt on Me that flips the same toggle.

Capability OFF cleanup behavior is unchanged from the existing flow — tombstones the directory row, fails in-flight inbound requests.

## 3. Onboarding + paywall

### Onboarding sequence

1. **Welcome** — single-screen value prop, "Get started" CTA.
2. **Name** — first + last (existing).
3. **Cert info** — pick IRATA, SPRAT, or both. For each: level (L1/L2/L3) + cert number + expiry + optional card photo. Reuses dual-cert engine.
4. **Role fork (conditional)** — only shown when at least one cert is L3:
   - "Use as Tech" (default) → capability OFF
   - "Use as Supervisor" → capability ON; capture supervisor cert number + directory visibility (default ON)
5. **Subscribe to start trial** — RevenueCat sheet shows `$2.99/mo` with a 7-day free trial. CTA "Start free trial." No skip. On success: profile created locally, land on Today.
6. **Cloud sign-in**:
   - Tech-only signups → deferred. Cloud screens prompt-then-route to sign-in when first used.
   - Supervisor signups → required before completing onboarding (you can't be in the directory without a Supabase account). Steps 5 and 6 are swapped for the supervisor path.

### Paywall + trial states

`subscriptionService` collapses from `'free' | 'pro'` to `'trialing' | 'active' | 'lapsed' | 'unknown'`.

Me-tab pill copy:

- **Trialing** — "Free trial · {N} days left" + "Manage subscription" deep-link to App Store
- **Active** — "Logbook Pro · renews {date}" + "Manage subscription"
- **Lapsed** — red strip "Subscription lapsed — renew to add or sign new entries" + "Renew" CTA

### Lapse semantics

When subscription is lapsed:

- App is **read-only**. Logbook viewable, PDF/JSON export still work.
- Write paths blocked: Add Work CTA disabled, Sign actions disabled, Send-request disabled, cloud sync paused.
- Paywall is re-presentable (full-screen modal) on next launch and on attempted write.

This satisfies Apple's requirement that users retain access to their content after subscription expiry.

### Code changes

- `useSubscriptionTier` → `useSubscriptionStatus`
- `useIsPro`, `ProBadge` deleted
- `PaywallScreen` rebuilt
- `subscription_tier` column → `subscription_status` (additive migration; old column dropped in the same migration since the app is pre-launch)

## 4. Today tab

### Header

Title "Today" left, bell icon right. Bell shows a small red dot when `notifications.read_at IS NULL` count > 0. Tap pushes `NotificationsScreen`.

### Greeting

Time-aware: "Good morning / afternoon / evening, {firstName}". Recomputes on focus.

### Hero

- Big numeric: hours logged today (sum of `entries.hours` where `date_from <= today <= date_to`)
- Label: "logged today"
- Right side: single static SVG illustration (rope-tech in chair)
- Below the hero: full-width primary red "+ Add work" CTA

### Cards (top to bottom)

1. **Incoming sign requests** — supervisor view only (rendered when `supervisor_capability_enabled`). Shows count of `sign_requests_cache` rows where the user is the supervisor and status is pending. Hidden when count = 0. Tap → Inbox tab.
2. **Needs signature** — count of *your* entries that are complete (all required fields), unsigned, and not in flight. SQL: `status='draft' AND pending_sign_request_id IS NULL AND <required-fields-non-null>`. Tap → Records pre-filtered to "Needs signature" chip.
3. **Certification progress** — for the user's primary cert:
   - Headline: "Level II → Level III"
   - Big numeric: "642 / 1,000 hours"
   - Progress bar (red accent)
   - Caption: "358 hours to go"
   - **L3 case**: switches to "Level III · {total lifetime hours}" + a re-cert reminder strip showing days-until-cert-expiry (which is more useful at L3 than a hours-to-next-level bar).

### States

- New user with zero entries: "Needs signature" hides; "Cert progress" shows `0 / X hours` with a one-line "Log your first entry to start tracking" hint.
- Offline: cards still render from local data; supervisor "Incoming" badge shows last-synced count with an offline indicator.

### Pull-to-refresh

Triggers `syncConnections()` + `syncSignRequests()` + (if signed in) cloud-state preview. No-op if offline.

### Data sources

`useEntries`, `useProfile`, `useSignRequests`, `useSupervisorConnections`, plus a new `useTodayHours()` selector hook over `useEntries`. No new DB tables.

## 5. Records tab

Replaces `LogbookListScreen`.

### Header

Title "Records" left, filter funnel icon right (opens advanced filter sheet).

### Search

Full-width input under the header. Searches `entries.site_name`, `entries.employer`, `entries.notes`, and `entries.work_types` (mapping work-type slugs to labels via `WORK_TYPE_LABELS`). Local SQL `LIKE`, debounced 200ms. Empty query = no filtering.

### Filter chips (single-select)

Default `All`. Five chips:

- `All` — every entry
- `Drafts` — `status='draft'` AND missing one or more required fields
- `Needs signature` — `status='draft'` AND complete AND `pending_sign_request_id IS NULL`
- `Awaiting` — `status='draft'` AND `pending_sign_request_id IS NOT NULL`
- `Signed` — `status IN ('signed', 'amended')` (amended originals get an "Amended" sub-pill)

Today tab's "Needs signature" card deep-links here with the chip pre-selected.

### Funnel sheet (advanced filters)

Bottom sheet:

- Date range (from / to)
- Work types (multi-select)
- Employer (multi-select picker populated from distinct values in `entries.employer`)
- Cert level used (chip group L1/L2/L3 against `tech_level_snapshot`)

Combines with chip + search via AND. "Reset filters" + "Apply" buttons.

### List

Grouped by month, descending. Sticky-ish month headers ("April 2024"). Each row:

- Left: site name (`bodyMed`), date range (`caption`, e.g. "Apr 21 – 23, 2024"), hours (`caption` muted, "· 24h")
- Right: status pill + chevron
- Optional second line for Awaiting/Signed: supervisor name + level chip ("J. Ramirez (LIII)")

Tap → `EntryDetail`. No long-press actions.

### Empty states

- No entries at all → illustration + "Log your first entry" primary CTA mirroring Today's hero
- No matches under current filter → "No records match these filters" + "Clear filters" link

### Performance

`useEntries` stays as-is; month grouping is computed in a `useMemo` selector. No new DB indexes.

## 6. Me tab

Replaces `ProfileScreen`.

### Header

Title "Me" left, gear icon right (opens Settings sheet).

### Identity block

- Avatar (uploadable, square-rounded)
- Display name
- Primary cert chip: "SPRAT #123456" + level chip "Level II"
- Secondary cert chip below (muted) if dual-cert: "IRATA #ABC1234 · Level I". **Tap the secondary chip to swap primary↔secondary.**
- Tap the identity block → Edit modal (name + avatar)

### Certification card

- Headline "Certification"
- Sub: "Expires {date}" with status pill — green if >180 days, amber if 60–180, red if ≤60
- Caption: relative ("48 days") matching pill color
- Tap → cert details/edit sheet (number, level, expiry, card photo)

### Progress card

- Headline "Progress"
- Big numeric: lifetime hours at primary cert's level / next milestone (e.g. "642 / 1,000")
- Red progress bar
- Caption: "{N} hours to Level III"
- L3 case: "Level III · {total lifetime hours}" with a re-cert reminder strip when expiry is <180 days

### Readiness for export card

Fixed checklist of 4 items. Each row has a status icon (✓ green, ⚠ amber, or ⚠ red) and a label. Generated by a pure selector over `(profile, entries, lastCloudBackupAt)`:

1. **Profile complete** — name + primary cert (level/number/expiry) all present → ✓; otherwise ⚠ "Complete your profile."
2. **{N} signed entries** — green if ≥1; muted gray "Log and sign your first entry" if 0.
3. **Entries need signatures** — count of entries in Drafts + Needs signature + Awaiting. ✓ if 0; ⚠ "{N} entries need signatures." Tap → Records filtered.
4. **Backup recency** — ✓ if last cloud backup ≤7 days; ⚠ if 8–30 days ("Back up — last sync N days ago"); red ⚠ if >30 days or never. If user not signed in: row replaced by "Sign in to enable cloud backup."

### Actions row

Stacked, full-width:

- **Export PDF** (primary red) — `exportService.exportAsPdf` → share sheet
- **Export JSON** (secondary outline) — `exportService.exportAsJson` → share sheet
- **Backup now** (secondary outline) — `cloudBackupService.backup()` with toast result; hidden when not signed in or when offline

### Subscription strip

Below actions, reflects `useSubscriptionStatus`:

- Trialing → "Free trial · 4 days left" + "Manage subscription"
- Active → "Logbook Pro · renews May 28" + "Manage subscription"
- Lapsed → red strip "Subscription lapsed — renew to add or sign new entries" + "Renew"

### Settings sheet (gear icon)

Bottom sheet, sections:

- Profile (name + avatar + cert details, links to edit modals)
- Supervisor capability toggle — only visible when at least one cert is L3. Sub-fields: cert number, directory visibility.
- Photos in cloud backup toggle — preserves current `photos_in_backup` semantics.
- Notifications — deep-link to OS settings.
- Account: signed-in email + Sign out + Delete account
- About: version, build, privacy/terms

`SupervisorsSection` is folded into Settings: the toggle lives in Settings, and a "Supervisors" entry inside Settings pushes a screen with connections, invites, and supervisor search. Same data, cleaner home.

## 7. Add Work + signing flows

### Add Work — 2-step wizard

**Step 1 of 2 — "Where & when"**

- Site (text input, required)
- Employer (dropdown: distinct prior employers + "Add new")
- When — segmented `Today / Yesterday / Custom`. Today/Yesterday set both `date_from` and `date_to` to the same day. Custom opens existing date-range picker.
- Hours (numeric, required, supports decimals)
- "Next" CTA enabled when all required fields valid; progress indicator "Step 1 of 2"

**Step 2 of 2 — "What did you do"**

- Work types — vertical multi-select list (mockup shows one highlighted but `EntryDetail` displays "Inspection / Rigging," confirming multi-select). Minimum 1 required. "Other" expands an `other_work_description` input.
- Notes — multiline textarea, optional
- "Save work" CTA finalizes as draft

Cancel from either step prompts "Discard this entry?" if any field is filled.

### Post-save sheet

Centered modal sheet after Save:

- Big green check + "Work saved"
- Site name + date + hours summary
- "Draft" status chip
- Caption: "Get this signed by your Level III supervisor."
- Actions stacked:
  - **Sign now** (primary red) → opens Signature options sheet
  - **Send request** (red outlined) → opens Send request modal directly
  - **Later** (text-only) → dismiss

### Signature options sheet

Bottom sheet, also reachable from `EntryDetail` "Get signature" button:

- Title "How will this be signed?"
- Two big tap targets:
  - **Sign on this device** — "Supervisor is with you right now." → pushes `SignatureScreen` (existing in-person flow, re-themed)
  - **Send to supervisor** — "Request a remote signature." → pushes `SendSignRequest` modal
- Cancel link

### Send request modal

Replaces the current send flow.

- "To" — picker with autocomplete; populated from `useSupervisorConnections` (accepted supervisors only). Shows name + level chip. "Find supervisor" link below pushes `SupervisorSearchScreen`.
- "Message (optional)" — multiline
- Primary CTA "Send request" → existing `signRequestsService.sendSignRequest`
- Cancel link

### EntryDetail re-skin

Same data, new look. Buttons:

- Draft entry: `Edit` (secondary outline) + `Get signature` (primary red)
- Awaiting entry: Withdraw banner (no action buttons)
- Signed entry: integrity status banner + signature image + no edit (existing immutability)

Lock semantics preserved entirely — services unchanged.

## 8. Notifications surface (the bell)

New `NotificationsScreen` reachable from Today's bell icon.

### Storage

New local table `notifications` (additive migration):

```
id              TEXT PRIMARY KEY
kind            TEXT      -- enum below
payload_json    TEXT
created_at      TEXT      -- ISO 8601
read_at         TEXT NULL
dismissed_at    TEXT NULL
```

`kind` values:

- `cert_expiry_60d`, `cert_expiry_0d`
- `sign_request_received`, `sign_request_signed`, `sign_request_declined`, `sign_request_withdrawn`
- `level_upgrade`
- `backup_stale`

### Write path

Notifications are written locally as side-effects of operations that already fire `expo-notifications` or trigger UI banners:

- `cert_expiry_60d` / `cert_expiry_0d` — written by the cert expiry scheduler on app foreground (existing `useBackupReminder`-style pattern, extended)
- `sign_request_*` — push handlers in `App.tsx` hydrate the table on receipt; outgoing sign-request mutations also write a local row alongside the existing push dispatch
- `level_upgrade` — written when the user updates their primary cert's level upward in Settings (the existing level-upgrade banner becomes a notification too)
- `backup_stale` — written on app foreground when the user is signed in and `last_cloud_backup_at` is >30 days; deduped on `kind+day` so it doesn't accumulate

No new server-side state. The `notifications` table is local-only and not synced to the cloud snapshot.

### Screen

- List grouped by day
- Each row: icon + title + body + relative time
- Tap navigates per `kind` (e.g. `sign_request_received` → `SignRequestDetail`)
- Long-press dismisses (sets `dismissed_at`, hides row)
- Header action "Mark all read"
- Empty state if no rows

### Bell badge

Red dot when `count(read_at IS NULL AND dismissed_at IS NULL) > 0`. No numeric count.

### Hook

`useNotifications()` returns `{ items, unreadCount, markAllRead, dismiss }`. Subscribes to local table changes via React Query invalidation.

### Service

`notificationsService.ts` factory over `DbClient` exposing `record({ kind, payload })`, `list()`, `markAllRead()`, `dismiss(id)`. Pure, mockable, fits the existing service pattern.

## 9. Retirement list

Removed in this branch:

- **Industrial primitives**: `Panel`, `Gauge`, `PunchCardRow`, `BreakdownBar`, `RecertStrip`, `StatStrip`, `SegmentedToggle` (rebuilt simpler), `SyncLED`, `FabButton`, `SectionLabel`, `ProBadge`, `Rivet`, `NoiseTexture`
- **Industrial token aliases** in `theme/tokens.ts`
- **JetBrains Mono and Michroma font assets** + `app.config.ts` font loader entries
- **Pro-gate code**: `useIsPro`, `ProBadge`, all `tier === 'pro'` checks
- **Dashboard / LogbookList screens**
- (Already gone in prior commits: `AnalyticsScreen`)

Retained:

- All services in `src/services/`
- All `src/db/` modules (with one additive migration: `notifications` table; `subscription_tier` → `subscription_status` rename)
- Cloud client + Supabase impl + supervisor accounts + sign-requests
- Existing tests (still pass against re-themed UI)

## 10. Schema migrations

Two additive changes via `runSchemaMigrations`:

1. **Rename `subscription_tier` → `subscription_status`** — the app is pre-launch so there is no installed-base data to preserve. The migration drops the old column in the same step. Tests in `__tests__/db/migrations.test.ts` cover the rename.
2. **Create `notifications` table** with the columns listed in §8, plus an index `idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL`.

The canonical `schema.ts` is updated to match. The setup test (`__tests__/setup.ts`) continues to run `runSchemaMigrations` against the canonical schema so any drift fails a test.

## 11. Testing

### Unit (services + selectors)

- `notificationsService.test.ts` — write/read/dismiss/markAllRead
- `readinessSelector.test.ts` — pure function over `(profile, entries, lastCloudBackupAt)` returning the 4 checklist items in all states (no profile, no entries, lots of pending, stale backup)
- `subscriptionService.test.ts` — extended for `trialing | active | lapsed | unknown` and lapse → read-only behavior
- `db/migrations.test.ts` — column rename + new table assertions

### Existing suites

All 17 service-layer test suites stay green — services are not being rewritten. Migration test catches drift on the new table and renamed column.

### UI snapshots

Snapshot tests for Today / Records / Me in two states each (empty + populated). Lightweight regression net since the visuals are central to this work.

### Manual QA (against dev Supabase)

- Signup-as-tech and signup-as-supervisor (with sign-in required mid-flow)
- Trial start through Apple sandbox
- Lapse → read-only mode → renew flow
- Add Work 2-step (single-day, multi-day Custom, Other-with-description)
- Post-save sheet routing (Sign now / Send request / Later)
- Notification center: receive a sign-request push → tap notification → SignRequestDetail
- Bell badge clearing
- Settings sheet: capability toggle on/off, primary cert swap

## 12. What this design does NOT do

- No keypair signing (still SHA-256 content hash; in "Not yet implemented")
- No live multi-device sync (still triggered snapshot backup)
- No org / company accounts (still individual)
- No saved entry templates
- No new server-side tables (notifications are local-only)
- No changes to cloud snapshot schema (`cloud_schema_version` stays at 1; `schema_version` stays at 1 after the rename + new table since both are additive within v1's migration scope)
