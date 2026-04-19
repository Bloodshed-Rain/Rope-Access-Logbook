# Supervisor Accounts & Remote Signing — Design Spec

**Date:** 2026-04-18
**Status:** Draft — awaiting user review

## 1. Purpose & success criteria

Let a SPRAT Level III tech ("supervisor") sign another tech's ("tech") entry on their own device, instead of borrowing the tech's phone in person. Adds supervisor capability as an opt-in on the existing single-account model, a contact list for each tech, and a request/response channel between two devices mediated by Supabase.

**In scope:**

- Supervisor capability as an opt-in on an existing tech account (single account type).
- Saved supervisor contacts per tech; add by email (invite if unregistered) or search the supervisor directory by SPRAT ID or name.
- Opt-in supervisor directory with default ON, searchable by SPRAT ID (exact) or name (prefix).
- Per-connection handshake: supervisor must accept; decline carries a 30-day cooldown against re-invite.
- Per-request sign flow: snapshot-at-send, full entry view (including photos), sign / decline / withdraw / auto-expire at 30 days.
- Offline-aware reads; all supervisor-accounts writes require online.
- Existing in-person signing flow remains unchanged and available.

**Out of scope:**

- Cryptographic keypair signing. The attestation remains PNG + supervisor name + cert number + SHA-256 content hash, same trust model as today.
- Live sync of logbooks between devices (a supervisor never sees the tech's full logbook — only the entry they've been asked to sign).
- Org / company accounts, admin roles, shared logbooks.
- Verification of SPRAT cert numbers against a SPRAT-authoritative source. Cert numbers are self-attested.
- Push notifications. Inbox updates arrive via realtime subscription while the app is open; background push is a later addition.

**Success criteria:**

- A tech with an existing logbook can enable supervisor capability without losing data and without a secondary account.
- A tech can add a supervisor (by email, SPRAT ID, or name), get the connection accepted, and send a completed draft entry for signing.
- The supervisor can sign, decline, or leave pending from their own device. A signed request results in a valid signature on the tech's logbook verifiable with the existing `verifyIntegrity` logic.
- All existing tests still pass. In-person `SignatureScreen` is unchanged.
- The app continues to work offline. Reads (inbox, pending state) are served from local cache; writes fail fast with a clear banner.

## 2. Key decisions

| Decision | Chosen option | Rationale |
|---|---|---|
| Role model | One account with optional supervisor capability | Matches SPRAT career progression; avoids forcing Level IIIs to juggle two accounts. |
| In-person signing | Remains alongside remote signing | Offline-first is a core property; paper logbooks don't require two devices either. Remote is additive. |
| Contact model | Saved supervisor contacts (persistent list) | Techs typically work under 1–3 regular supervisors; re-typing per entry is unnecessary friction. |
| Add-supervisor paths | Email, SPRAT ID, name | Email still needed to invite unregistered users. SPRAT ID and name cover the common case where the tech knows the supervisor but not their email. |
| Directory opt-in default | ON | Level IIIs enable supervisor capability because they want to be reachable; OFF-by-default would make the directory empty. |
| Name search style | Prefix match, minimum 3 chars, max 10 results per page | Useful for partial names; capped for privacy / anti-scraping. |
| Connection handshake | Supervisor must accept | Being on a supervisor list is a work queue. Accepting is a one-time step; decline with 30-day cooldown prevents re-invite spam. |
| Request snapshot | Immutable at send time | Clean "sign this" mental model; avoids race between tech edits and supervisor sign. |
| Content shown to supervisor | Full entry (incl. photos, equipment notes, weather) | Attests to actual work; same as in-person signing. |
| Request lifecycle terminal states | `signed`, `declined`, `withdrawn`, `expired` | `expired` covers long-pending inboxes; `withdrawn` + `declined` cover manual resolution. |
| Auto-expiration | 30 days | Matches user-approved cadence; hourly cron job flips pending → expired. |
| Server data model | Two Postgres tables (`supervisor_connections`, `sign_requests`) + new Storage bucket | RLS and realtime make inbox UX natural; Storage-only would require polling and directory-scale listing. |
| Signature identity | Pulled from supervisor's account profile at sign time | No typing; PNG still drawn per signature (gesture attestation). |
| Offline-first for supervisor-accounts writes | Disallowed; online required | Server-side race checks (e.g. sign-vs-withdraw) cannot be safely reproduced offline. |
| Offline-first reads | Supported via local SQLite cache | Inbox and pending state render from cached projection of server rows. |
| Tech-side entry lock | `entries.pending_sign_request_id` makes the entry read-only while pending | Required by snapshot-at-send; withdraw unlocks. |
| Post-sign sync | Signed request flows into the existing cloud backup pipeline on the tech's device | No new backup plumbing; `signatures` row inserted locally triggers `cloudBackupService.backup()`. |

## 3. Architecture overview

### 3.1 Server (Supabase)

- **Postgres (new)** — three tables: `supervisor_connections`, `sign_requests`, `supervisor_directory`. RLS-gated per user. First Postgres tables in the project (`logbook-backups` bucket has been Storage-only until now).
- **Storage (new bucket `sign-requests`)** — per-request asset folders for photos and the signature PNG. RLS joins against `sign_requests` so only the two parties on a request can read.
- **Storage (`logbook-backups`)** — unchanged. Tech's cloud snapshot continues as before; a signed request flows into the tech's snapshot on next backup.
- **Edge Functions (new)** — `invite-supervisor` (email invite for unregistered supervisor), `cleanup-request-assets` (delete asset folder on terminal state, called via Postgres trigger or cron), `search-supervisors` (enforces rate limiting + minimum query length on directory search).
- **Edge Function (extended)** — `delete-account` extended to cascade pending requests and connections for the deleted user.
- **`pg_cron` (new)** — hourly job: pending requests with `expires_at < now()` → `expired` status + asset cleanup. Daily job: hard-delete terminal-state rows older than 90 days.

### 3.2 Client — `src/cloud/`

`CloudClient` interface (`src/cloud/cloudClient.ts`) gains methods:

- `listSupervisorConnections()`, `requestConnection(email)`, `respondToConnection(id, accept)`, `revokeConnection(id)`
- `searchSupervisors(kind, query)` (kind: `email` | `sprat_id` | `name`)
- `listSignRequests(since?)`, `sendSignRequest(payload)`, `signRequest(id, png, geo)`, `declineRequest(id, reason)`, `withdrawRequest(id)`
- `subscribeConnections(callback)`, `subscribeSignRequests(callback)`
- `updateSupervisorDirectory({display_name, sprat_cert_number, visible})`

`supabaseClient.ts` implements these against Supabase; `__tests__/cloudMock.ts` extends the in-memory mock with a simulation of both Postgres tables, RLS semantics (row-level access based on the current mock-authenticated user), and synchronous realtime callbacks.

### 3.3 Client — `src/services/`

Two new services:

- **`supervisorConnectionsService.ts`** — invite, accept, decline, revoke, search, cooldown enforcement. Depends on `DbClient + CloudClient + clock`.
- **`signRequestsService.ts`** — send, sign, decline, withdraw, plus `applyIncomingSignature()` used by the sync catch-up path. Depends on `DbClient + CloudClient + FileSystemAbstraction + HashFn + clock`.

Service-layer invariants (contract, not convention):

- A sign request can only be sent against an accepted `supervisor_connections` row.
- An entry is immutable while `pending_sign_request_id is not null`. `entriesService.updateEntry` and `deleteEntry` throw in this case, mirroring the signed-entry immutability rule.
- A signature produced remotely is indistinguishable at the `signatures` row level from one produced in-person. `verifyIntegrity` must succeed using the same hash algorithm applied to the locally-stored entry.
- A supervisor can only sign if their profile has `supervisor_capability_enabled = true` and a non-empty `supervisor_cert_number`.

### 3.4 Client — UI

- **New screens:** `InboxScreen`, `SignRequestDetailScreen`, `SupervisorSearchScreen`.
- **Modified screens:** `ProfileScreen` (Supervisors section + capability toggle), `EntryFormScreen` ("Send for signature" alongside "Sign in-person"), `EntryDetailScreen` (pending/declined/expired banners), `LogbookScreen` (list-row status chip).
- **Navigation:** `RootNavigator` bottom tabs become Logbook · Inbox (conditional on `supervisor_capability_enabled`) · Profile. Stack adds `SignRequestDetail` and `SupervisorSearch`.

## 4. Data model

### 4.1 Postgres schema

```sql
-- supervisor_connections
create table supervisor_connections (
  id uuid primary key default gen_random_uuid(),
  tech_user_id uuid not null references auth.users(id) on delete cascade,
  supervisor_user_id uuid references auth.users(id) on delete cascade,  -- nullable: filled on signup for email-invited supervisors
  status text not null check (status in ('pending','accepted','declined','revoked')),
  invited_email text not null,          -- preserved even if supervisor changes theirs later; also the join key for resolving pending invites on signup
  supervisor_display_name text,         -- cached from supervisor profile at acceptance
  declined_at timestamptz,              -- set when status flips to declined; powers 30-day cooldown
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uniqueness: one active connection per (tech, supervisor) pair once resolved,
-- plus one active invite per (tech, invited_email) while unresolved.
create unique index uniq_conn_tech_sup on supervisor_connections (tech_user_id, supervisor_user_id)
  where supervisor_user_id is not null;
create unique index uniq_conn_tech_email on supervisor_connections (tech_user_id, invited_email)
  where supervisor_user_id is null;

create index on supervisor_connections (tech_user_id);
create index on supervisor_connections (supervisor_user_id);
create index on supervisor_connections (invited_email) where supervisor_user_id is null;

-- Trigger: when a new auth.users row is created, fill in supervisor_user_id
-- on any pending invite rows whose invited_email matches the new user.
create or replace function resolve_supervisor_invites() returns trigger as $$
begin
  update supervisor_connections
     set supervisor_user_id = new.id, updated_at = now()
   where supervisor_user_id is null and lower(invited_email) = lower(new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger resolve_supervisor_invites_on_signup
  after insert on auth.users
  for each row execute function resolve_supervisor_invites();

-- sign_requests
create table sign_requests (
  id uuid primary key default gen_random_uuid(),
  tech_user_id uuid not null references auth.users(id) on delete cascade,
  supervisor_user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references supervisor_connections(id),
  entry_payload jsonb not null,         -- frozen Entry snapshot at send time
  assets_manifest jsonb not null,       -- { "photo_0.jpg": {sha256, size_bytes}, ... }
  status text not null check (status in ('pending','signed','declined','withdrawn','expired')),
  decline_reason text,
  signature_png_path text,              -- Storage key, set when signed
  supervisor_name_snapshot text,        -- from supervisor profile at sign time
  supervisor_cert_number_snapshot text,
  entry_hash text,                      -- SHA-256 over canonical entry_payload
  hash_version int,                     -- matches CURRENT_HASH_VERSION at sign time
  signed_device_id text,
  signed_gps_lat double precision,
  signed_gps_lon double precision,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,      -- created_at + 30 days
  signed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index on sign_requests (tech_user_id, status);
create index on sign_requests (supervisor_user_id, status);
create index on sign_requests (expires_at) where status = 'pending';

-- supervisor_directory
create table supervisor_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  sprat_cert_number text not null,
  visible boolean not null default true,
  updated_at timestamptz not null default now()
);

create extension if not exists pg_trgm;
create index on supervisor_directory (sprat_cert_number) where visible;
create index on supervisor_directory using gin (display_name gin_trgm_ops) where visible;
```

### 4.2 RLS policies (summary)

- **`supervisor_connections`:** select/update visible where `auth.uid() in (tech_user_id, supervisor_user_id)` (the supervisor side becomes visible only once `supervisor_user_id` is non-null). Insert allowed only with `auth.uid() = tech_user_id`. Re-invite of an existing supervisor is an UPDATE that flips `status` from `declined` → `pending`; this update is gated by a policy requiring `declined_at < now() - interval '30 days'` (the 30-day cooldown). Duplicate invites to the same supervisor in the same state are prevented by the partial unique indexes above, not by application logic.
- **`sign_requests`:** select visible where `auth.uid() in (tech_user_id, supervisor_user_id)`. Insert allowed only with `auth.uid() = tech_user_id` and an accepted `supervisor_connections` row exists. Update: tech can only transition to `withdrawn` from `pending`; supervisor can only transition to `signed` or `declined` from `pending`. All status transitions are guarded by `status = 'pending'` on the WHERE clause to preserve race safety.
- **`supervisor_directory`:** select open (no RLS filter) — intentionally queryable. Insert/update restricted to `auth.uid() = user_id`. Directory writes are proxied through the `search-supervisors` Edge Function for rate limiting and query validation; the table policy is the backstop.

### 4.3 Storage — new bucket `sign-requests`

Layout:

```
sign-requests/
  {request_id}/
    photo_{entry_id}_{index}.{ext}
    sig.png
```

RLS: a storage policy joins `storage.foldername(name)[1]::uuid` to `sign_requests.id` and permits read to either party. Write on `photo_*` is restricted to the tech; write on `sig.png` is restricted to the supervisor. On terminal status transition, an Edge Function deletes the `{request_id}/` folder.

### 4.4 Local SQLite additions

Profile columns (idempotent ALTER in `db/migrations.ts`):

```sql
alter table profile add column supervisor_capability_enabled integer not null default 0;
alter table profile add column supervisor_cert_number text;
alter table profile add column supervisor_directory_visible integer not null default 1;
```

Entries column:

```sql
alter table entries add column pending_sign_request_id text;
```

Index: `create index if not exists idx_entries_pending_sign_request on entries(pending_sign_request_id) where pending_sign_request_id is not null;`

New cache tables in `db/schema.ts`:

```sql
create table supervisor_connections_cache (
  id text primary key,
  tech_user_id text not null,
  supervisor_user_id text not null,
  status text not null,
  invited_email text not null,
  supervisor_display_name text,
  declined_at text,
  created_at text not null,
  updated_at text not null
);

create table sign_requests_cache (
  id text primary key,
  tech_user_id text not null,
  supervisor_user_id text not null,
  entry_id text,                    -- extracted from entry_payload.id for fast joins
  status text not null,
  decline_reason text,
  signed_at text,
  created_at text not null,
  expires_at text not null,
  updated_at text not null,
  payload_json text not null        -- full server row serialized, for offline detail view
);

create index idx_sign_requests_cache_status on sign_requests_cache(status);
create index idx_sign_requests_cache_entry on sign_requests_cache(entry_id);
```

## 5. Flows

Numbered sequences. Each step is a single-responsibility service-layer call unless otherwise noted.

### 5.1 Enable supervisor capability

1. User on `ProfileScreen` → Supervisors section → toggle "I supervise others" on.
2. Modal asks for Level III cert number (text input) and confirms SPRAT Level III self-attestation.
3. `profileService.updateProfile({ supervisor_capability_enabled: 1, supervisor_cert_number: <value>, supervisor_directory_visible: 1 })`.
4. If online, `cloudClient.updateSupervisorDirectory({ display_name, sprat_cert_number, visible: true })` inserts a `supervisor_directory` row. If offline, deferred until next sync.
5. `RootNavigator` picks up the profile change on next render; Inbox tab appears.

Disabling supervisor capability: same surface. If any `sign_requests` row exists with `supervisor_user_id = me` and `status = 'pending'`, toggle is blocked with a banner listing the count; user must decline or sign them first. On successful disable, `supervisor_directory` row is deleted.

### 5.2 Add a supervisor

Three entry points in `SupervisorSearchScreen`, tabbed UI:

**5.2.a — By email.**
1. Tech types `supervisor@example.com`.
2. `supervisorConnectionsService.requestConnection(email)`.
3. Service calls `cloudClient.requestConnection(email)` which:
   - Looks up user by email via Edge Function (auth table lookup, returns `user_id` or null).
   - If found: inserts `supervisor_connections` row with `status='pending'`, `supervisor_user_id=<found>`, `invited_email=email`.
   - If not found: calls `invite-supervisor` Edge Function (runs `auth.admin.inviteUserByEmail(email)`) and inserts a `supervisor_connections` row with `supervisor_user_id=null`, `invited_email=email`, `status='pending'`. The schema permits nullable `supervisor_user_id` for exactly this case. The `resolve_supervisor_invites_on_signup` trigger backfills `supervisor_user_id` when the invited user signs up (matched by lowercased email). At that point the row is visible to the supervisor via RLS and behaves identically to a directly-invited registered user.
4. Tech's cache is updated. Local UI shows the pending row with status "Invited — waiting for signup" or "Pending".

**5.2.b — By SPRAT ID.**
1. Tech types `L3-12345` (exact match).
2. `cloudClient.searchSupervisors('sprat_id', 'L3-12345')` via Edge Function → returns `[{user_id, display_name, sprat_cert_number}]` for visible directory entries with matching ID. Could be multiple (self-attested; duplicates allowed).
3. Confirmation sheet lists each match with full name and cert. Tech picks one → same connection-request flow as 5.2.a, but `supervisor_user_id` is known immediately.

**5.2.c — By name.**
1. Tech types 3+ characters of a name.
2. `cloudClient.searchSupervisors('name', query)` via Edge Function → `pg_trgm` prefix search on `display_name` where `visible`, capped at 10 results. Returns `[{user_id, display_name, sprat_cert_number_masked}]`; SPRAT ID is masked to first 2 + last 2 chars (e.g. `L3-***45`) until connection is accepted.
3. Tech picks a result → confirmation sheet (same masked ID shown) → connection request.

### 5.3 Supervisor accepts/declines a connection

1. Supervisor opens app; realtime or catch-up sync surfaces a new row where `supervisor_user_id = me, status='pending'`.
2. InboxScreen shows "Incoming requests" section with "X wants to add you as their supervisor" and Accept / Decline buttons.
3. Accept → `supervisorConnectionsService.respondToConnection(id, accept=true)` → `cloudClient.respondToConnection` → row `status='accepted'`, `supervisor_display_name` filled from supervisor's profile.
4. Decline → same pathway, sets `status='declined'`, `declined_at=now()`. Cooldown countdown begins.

### 5.4 Send a sign request (tech side)

Preconditions: entry is complete (date_from, date_to, work_hours > 0, description non-empty); connection with selected supervisor is `accepted`; entry has no existing `pending_sign_request_id`.

1. User on `EntryFormScreen` taps "Send for signature" → sheet shows accepted supervisors → picks one.
2. `signRequestsService.sendRequest({ entry_id, supervisor_user_id })`.
3. Service:
   - Builds `entry_payload` by reading the entry from local DB (identical shape to `Entry`).
   - Copies each referenced photo from `logbook/photos/` into a temp location with a canonical name (`photo_{entry_id}_{index}.{ext}`), computing sha256 for each. Builds `assets_manifest`.
   - `cloudClient.sendSignRequest({ connection_id, entry_payload, assets_manifest, expires_at })`: uploads assets to `sign-requests/{request_id}/`, then inserts `sign_requests` row. Order matters — any asset upload failure aborts before row insert. Request ID is generated server-side.
   - On success: local `db.run("UPDATE entries SET pending_sign_request_id = ? WHERE id = ?", [request_id, entry_id])`. Inserts a `sign_requests_cache` row.
4. UI: Logbook row shows "Awaiting [supervisor]" chip; EntryDetail shows banner with Withdraw action.

### 5.5 Supervisor views the inbox

1. On open, InboxScreen runs `signRequestsService.sync()` (`cloudClient.listSignRequests(since = last_sync_at)` merged into cache). Also opens `cloudClient.subscribeSignRequests(cb)` so subsequent changes push in.
2. Inbox sections: Pending sign requests (ordered by `created_at desc`), Signed history (last 50).
3. Tapping a pending row opens `SignRequestDetailScreen`:
   - Renders `entry_payload` using the same read-only blocks as `EntryDetailScreen`.
   - Downloads each asset in `assets_manifest` to a local cache dir, verifying sha256. Mismatches are marked "Image unavailable" but don't block signing.
   - Three actions: Sign / Decline / Close.

### 5.6 Supervisor signs

1. Supervisor taps "Sign" → inline signature canvas opens (same `react-native-signature-canvas` primitive pattern as `SignatureScreen`).
2. On confirm, service:
   - Saves PNG to `logbook/signatures/sig_{request_id}.png` locally first.
   - Computes `entry_hash = sha256(canonicalize(entry_payload))` using the current hash algorithm (v3 at time of writing).
   - `cloudClient.signRequest(id, png_bytes, { gps_lat, gps_lon, device_id })`:
     - Uploads PNG to `sign-requests/{request_id}/sig.png`.
     - Server-side update (conditional `WHERE status = 'pending'`): sets `status='signed'`, `signed_at=now()`, snapshots supervisor's `display_name` and `sprat_cert_number` from the `supervisor_directory` (or from local profile data sent in the request body), sets `entry_hash`, `hash_version`, `signed_device_id`, GPS.
     - If the update affects zero rows (request was withdrawn/declined/expired in the meantime), returns a conflict; client surfaces "This request was [state] — state has been updated" and reloads.
3. Supervisor's cache row updates via realtime callback.

### 5.7 Tech receives the signed signature

1. Tech's device (online): realtime callback on `sign_requests` fires with the updated row; or catch-up sync picks it up on reconnect.
2. `signRequestsService.applyIncomingSignature(request_row)`:
   - Downloads `sig.png` from Storage to `logbook/signatures/sig_{signature_id}.png` (where `signature_id` is a newly-generated local UUID). Verifies presence; if missing, proceeds with `signature_png_path=null` and surfaces "Signature image missing" banner on the entry (the hash still verifies because it's over entry content, not PNG bytes).
   - Inserts a row into local `signatures` table with all fields populated from the server row (`entry_id`, `supervisor_name` from snapshot, `supervisor_cert_number` from snapshot, `signed_at`, `device_id`, GPS, `entry_hash`, `hash_version`).
   - `db.run("UPDATE entries SET status='signed', updated_at=?, pending_sign_request_id=NULL WHERE id=?", ...)`.
   - Kicks `cloudBackupService.backup()` so the signature propagates into the tech's cloud snapshot.
3. UI: entry list row shows "Signed" chip; detail view shows the signature image.

### 5.8 Decline

1. Supervisor taps "Decline" → modal asks for a short reason (optional, 200 char limit).
2. `cloudClient.declineRequest(id, reason)` → server update (conditional on pending) sets `status='declined'`, `decline_reason`.
3. Edge Function trigger / cron-driven cleanup deletes the asset folder `sign-requests/{request_id}/`.
4. Tech side: realtime / catch-up updates cache. `applyIncomingDecline(request_row)`:
   - `db.run("UPDATE entries SET pending_sign_request_id=NULL WHERE id=?", ...)`.
   - Keeps `sign_requests_cache` row with `status='declined'` so UI can surface the reason on EntryDetailScreen.
5. UI: EntryDetail shows "Declined by [supervisor]: [reason]" banner with Edit / Resend actions.

### 5.9 Withdraw

1. Tech taps "Withdraw" on a pending entry.
2. `cloudClient.withdrawRequest(id)` (conditional on pending) → `status='withdrawn'`. Asset cleanup as in 5.8.
3. Local: `pending_sign_request_id` cleared immediately after server confirms.

### 5.10 Auto-expire

1. `pg_cron` job runs hourly: `UPDATE sign_requests SET status='expired' WHERE status='pending' AND expires_at < now()`.
2. Per-row trigger (or a separate cron job) calls the asset-cleanup Edge Function.
3. Both sides surface via realtime / catch-up. Tech's entry is unlocked on their next sync.

### 5.11 Retention cleanup

Daily `pg_cron` job: hard-delete `sign_requests` rows with `status in ('declined','withdrawn','expired','signed')` and `updated_at < now() - interval '90 days'`. The signature on the tech's local logbook is already captured in their snapshot by this point; the server-side request row is no longer load-bearing.

## 6. Offline-first behavior

### 6.1 Reads

- Inbox (both sides), entry pending status, saved supervisor list: rendered from SQLite cache tables. Stale-sync timestamp shown subtly in UI header.
- SignRequestDetailScreen when opened online: assets are downloaded and cached. Re-opening offline works as long as the assets were previously downloaded.

### 6.2 Writes

All supervisor-accounts writes fail fast with a clear banner ("Connect to the internet to [send / sign / accept / ...]") rather than queueing:

- Directory search and email invite (inherently interactive).
- Send / withdraw a sign request (server-side connection check and race-safe transitions).
- Accept / decline / revoke a connection.
- Sign / decline a request.

Rationale: queueing these introduces intermediate states where tech and supervisor have mutually inconsistent views, and the server-side race checks (e.g. sign-vs-withdraw) cannot be safely reproduced offline. The cloud backup subsystem continues to queue writes as before — that's a different tradeoff because the only concurrent writer is the same user.

### 6.3 Sync catch-up

On every `AppState` transition to `active` and on every network-reachable event, the supervisor-accounts module runs:

1. `listSupervisorConnections(since = last_conn_sync)` → merge into cache, fire any callbacks.
2. `listSignRequests(since = last_req_sync)` → merge into cache; for each newly-signed row where the tech is the current user, invoke `applyIncomingSignature`; for each newly-declined / withdrawn / expired row, invoke the corresponding local side effect.
3. Re-open realtime subscriptions.

Sync is idempotent: re-applying an already-applied signature is a no-op (checked by existence of `signatures` row for the `entry_id`).

## 7. Edge cases

### 7.1 Race: supervisor signs while tech withdraws

Both are `UPDATE sign_requests SET ... WHERE id = ? AND status = 'pending'`. Whichever lands first wins; the loser gets zero affected rows and a conflict error. Client surfaces "This request was [signed / withdrawn] — state has been updated" and refreshes from the server.

### 7.2 Supervisor disables capability with pending requests

Disable toggle is blocked until all pending requests are resolved. Banner lists the count and offers "Open inbox." Rejected alternative: auto-decline all pending — too surprising, would silently break techs' entries.

### 7.3 Supervisor deletes account

`delete-account` Edge Function, extended: before the auth-user deletion cascade, it updates all the supervisor's pending `sign_requests` to `status='declined'` with reason `"Supervisor account removed"`, and all their `supervisor_connections` rows to `status='revoked'`. Directory row is deleted. Previously-signed `sign_requests` rows are retained server-side for the 90-day window (snapshots preserve the supervisor's identity). **All signatures already inserted into techs' local logbooks remain valid forever** — `supervisor_name` and `supervisor_cert_number` are captured at sign time and stored locally.

### 7.4 Tech deletes account

Same cascade in reverse: pending `sign_requests` → `status='withdrawn'`, `supervisor_connections` → `status='revoked'`. Supervisor's sign-history tab shows the historical row but with a "[deleted tech]" placeholder name.

### 7.5 Revoked connection after prior signatures

`supervisor_connections.status='revoked'` blocks future requests between this pair. Past signatures are unaffected — revocation is not retroactive.

### 7.6 Directory duplicates on SPRAT ID

Allowed. Self-attestation means two users could claim the same ID (typo or fraud). Search returns all matches; tech disambiguates by display name. Fraud mitigation is out of scope for this spec.

### 7.7 Anti-spam cooldown

Server-side RLS check on insert: a new `supervisor_connections` row with `(tech_user_id, supervisor_user_id)` is rejected if a `status='declined'` row exists with `declined_at > now() - interval '30 days'`. Client shows "You can re-invite this supervisor on [date]."

### 7.8 Amendments

Amending a remotely-signed entry works identically to amending an in-person signature — the amendment is a new draft with `amends_entry_id` set, and can itself be signed via the in-person flow or sent to a supervisor via the remote flow. No special handling in this spec.

### 7.9 Expired request cleanup

Hourly cron (see 5.10). Expired asset folders are deleted. Expired row retained for 90 days then hard-deleted.

### 7.10 Scenario-C cloud conflict interaction

A tech with pending sign requests can still trigger Scenario C ("replace cloud with this device") on the existing cloud-backup flow. Sign requests live in Postgres, not in the `logbook-backups` bucket, so they're unaffected by the Storage-level replace. Local cache is rebuilt on next sync.

### 7.11 Signature PNG corrupted during download

sha256 mismatch on download → signature row is inserted anyway with `signature_png_path=null`. EntryDetailScreen shows a "Signature image missing" banner. Hash verification still passes (hash is over content, not PNG bytes). Tech can ask supervisor to resign if they need the image.

### 7.12 Supervisor searched themselves

Directory search filters out the caller's own user_id so a user searching their own name / ID doesn't see themselves as a connection candidate.

## 8. UI surfaces

### 8.1 New screens

**`InboxScreen`** (bottom tab, conditional on `supervisor_capability_enabled`).

Sections, in order:
1. Incoming connection requests — "X wants to add you as their supervisor" with Accept / Decline.
2. Pending sign requests — `ListRow` per request, showing tech name, date range, hours, site. Tap → `SignRequestDetailScreen`.
3. Sign history — last 50 signed, ordered by `signed_at desc`.

Tab icon has a badge showing total action-required count (pending connections + pending requests).

**`SignRequestDetailScreen`**.

Header: tech name, SPRAT level, request created time.
Body: read-only entry render (dates, site, client, employer, hours, work types, description, equipment notes, weather, photo grid). Reuses EntryDetailScreen's blocks.
Bottom toolbar: Sign · Decline · Close.

Sign → inline signature canvas appears above the toolbar. Confirm Sign submits.
Decline → modal with 200-char reason field + Cancel / Confirm.

**`SupervisorSearchScreen`** (tech).

Tabbed: Email · SPRAT ID · Name.
- Email tab: single input + "Send invite" button.
- SPRAT ID tab: single input + "Search" button → results list (tap = confirmation sheet = send request).
- Name tab: single input + live results as user types (debounced, minimum 3 chars) + results list.

Results show `ListRow` with full name + SPRAT ID (masked on Name search, unmasked on SPRAT ID search).

### 8.2 Modified screens

**`ProfileScreen`**. New "Supervisors" section above the existing cloud-backup section:
- "I supervise others" toggle (drives `supervisor_capability_enabled`).
- When on: Level III cert number field, directory-visibility sub-toggle, "My directory entry" summary.
- "My supervisors" subsection listing accepted connections with name + masked/full cert, swipe-to-remove.
- "Pending invites" subsection listing pending connections tech has sent.
- "Add supervisor" button → `SupervisorSearchScreen`.

**`EntryFormScreen`**. Bottom action row when entry is complete:
- Left: "Sign in person" (existing behavior, navigates to `SignatureScreen`).
- Right: "Send for signature" (opens supervisor picker sheet).

When entry has `pending_sign_request_id`, the action row is replaced with a `Banner` showing "Awaiting [supervisor]" + Withdraw button. Fields are read-only.

**`EntryDetailScreen`**. New banners for pending / declined / expired states. Declined banner includes the reason and a "Resend" action that opens the supervisor picker.

**`LogbookScreen`**. Entry rows get a small `Chip` reflecting pending / declined / expired sign-request state in addition to the existing draft / signed / amended chip.

### 8.3 Navigation (`RootNavigator`)

Bottom tabs: Logbook · Inbox (conditional) · Profile.
Stack adds: `SignRequestDetail`, `SupervisorSearch`.
Cloud-conflict gate unchanged.

## 9. Testing strategy

### 9.1 Unit tests

Extension of `__tests__/cloudMock.ts`:
- In-memory Postgres simulation for the three new tables with status-transition checks and RLS-style per-caller filtering.
- Synchronous realtime callbacks invoked on any row change.
- Directory search modeled as plain filter over in-memory rows.

New test files:
- `__tests__/services/supervisorConnectionsService.test.ts` — invite by email (registered + unregistered paths), directory search by SPRAT ID and name (including mask behavior), accept, decline, 30-day cooldown, revoke, offline failure.
- `__tests__/services/signRequestsService.test.ts` — send request (including asset manifest + upload ordering), sign, decline, withdraw, expiration transition, race (sign-vs-withdraw, sign-vs-expire), request against non-accepted connection (rejected), supervisor signing without capability (rejected).
- `__tests__/services/applyIncomingSignature.test.ts` — catch-up sync inserts signature row + flips entry status + clears pending lock + kicks backup. Idempotency: re-applying is a no-op.
- `__tests__/db/migrations.test.ts` — verifies idempotent adds of `supervisor_capability_enabled`, `supervisor_cert_number`, `supervisor_directory_visible`, `pending_sign_request_id` and creation of cache tables.

Extensions to existing test files:
- `__tests__/services/entriesService.test.ts` — `updateEntry` and `deleteEntry` throw when `pending_sign_request_id` is set.
- `__tests__/services/signingService.test.ts` — round-trip: a signature with fields produced by the remote-sign flow verifies successfully with `verifyIntegrity` against the equivalent locally-stored entry.

Integration-shaped test (still single-process unit-level):
- `__tests__/services/fullRemoteSignFlow.test.ts` — two mock-authenticated sessions against one mock CloudClient. Tech invites → supervisor accepts → tech sends → supervisor signs → tech's SQLite ends up with a signature row and entry marked signed. This is the highest-value single test.

Target: from the current 12 files / 92 tests to ~17 files / ~135 tests.

### 9.2 Manual QA (dev Supabase)

Not covered by unit tests, verified against a dev Supabase project:
- Real RLS enforcement on Postgres.
- Realtime subscription delivery under real network.
- Edge Functions (`invite-supervisor`, `search-supervisors`, asset cleanup, `delete-account` cascade extension).
- `pg_cron` expiration and retention jobs.
- Asset upload / download round-trips against real Storage.
- Cross-device test: sign in on device A as tech, device B as supervisor; exercise full flow; verify device A's logbook ends up with the signature after backup.

## 10. Implementation sequencing note

(Not a binding plan — belongs in the implementation plan document. Captured here as a hint to keep the build demo-able.)

A reasonable order for slicing this into demo-able increments:

1. Supabase schema + RLS + directory; `CloudClient` extension + mock; `supervisorConnectionsService` + tests.
2. Profile toggle + `SupervisorSearchScreen` + add-supervisor UX (no sign requests yet). At this point you can demo "invite, accept, list."
3. `signRequestsService` send/withdraw + tech-side entry lock + InboxScreen (supervisor read-only view). Demoable: "tech sends, supervisor sees it."
4. Supervisor sign flow + tech-side `applyIncomingSignature`. Demoable: "round-trip signature lands on tech's device."
5. Decline + expire + cron jobs + polish (banners, chips, masking).

Items 1–4 cover the golden path; item 5 covers the full lifecycle.
