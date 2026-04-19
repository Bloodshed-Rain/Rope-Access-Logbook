# Supervisor Accounts Part B — Server-side Plumbing & Client Fixes

Spec date: 2026-04-19
Parent spec: `2026-04-18-supervisor-accounts-design.md`

This spec covers the remaining supervisor accounts work: three Edge Functions, two pg_cron jobs, a `delete-account` cascade, and two client-side fixes (photo download, form auto-save).

---

## 1. Edge Function: `invite-supervisor`

Thin wrapper around Supabase's `auth.admin.inviteUserByEmail`. Called when a tech invites a supervisor who isn't registered yet.

### Request

```
POST /functions/v1/invite-supervisor
Authorization: Bearer <user-jwt>
Body: { "email": "supervisor@example.com" }
```

### Behavior

1. Derive `tech_user_id` from the caller's JWT (same pattern as `delete-account`).
2. Call `auth.admin.inviteUserByEmail(email)` with the service-role client. This sends the standard Supabase invite email.
3. The `supervisor_connections` row (with `supervisor_user_id: null`) is already inserted client-side before this function is called. The existing `resolve_supervisor_invites_on_signup` Postgres trigger backfills `supervisor_user_id` when the invitee signs up.

### Response

- `200 { ok: true }` on success.
- `200 { error: 'already_registered' }` if the user already exists (client should suggest inviting by user ID instead).
- `401` if JWT is missing or invalid.

### Rate limiting

Not needed — the connection uniqueness constraints in Postgres (`uniq_conn_tech_email`) prevent duplicate invites.

---

## 2. Edge Function: `search-supervisors`

Rate-limited wrapper around the `supervisor_directory` table. The directory is readable by any authenticated user (by RLS), but raw client queries could be abused.

### Request

```
POST /functions/v1/search-supervisors
Authorization: Bearer <user-jwt>
Body: { "kind": "sprat_id" | "name", "query": "..." }
```

### Behavior

1. Derive `user_id` from JWT.
2. Rate-limit check: count rows in `search_rate_limits` where `user_id` matches and `searched_at > now() - interval '24 hours'`. If count >= 20, return `{ error: 'rate_limited' }`. Opportunistically delete rows older than 24 hours before counting.
3. Insert a new `search_rate_limits` row for this search.
4. Execute the query:
   - `sprat_id`: exact match on `sprat_cert_number` where `visible = true` and `user_id != caller`.
   - `name`: trigram prefix match on `display_name` where `visible = true`, `user_id != caller`, and query length >= 3 chars. Cert number is masked (first 2 chars + `-***` + last 2 chars).
5. Return `{ results: SupervisorSearchResult[] }` capped at 10.

### Rate-limit table

Added in the same migration as the cron jobs:

```sql
CREATE TABLE search_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  searched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_user_time ON search_rate_limits (user_id, searched_at);
```

RLS: no client access needed — only the Edge Function (service-role) reads/writes this table.

### Client change

`supabaseClient.ts::searchSupervisors` switches from direct Postgres query to `callEdgeFunction('search-supervisors', { kind, query })`. The mock stays as-is.

---

## 3. Edge Function: `cleanup-request-assets`

Deletes the `sign-requests/{request_id}/` storage folder when a request reaches a terminal state. Assets are only needed during the review window.

### Request

```
POST /functions/v1/cleanup-request-assets
Authorization: Bearer <user-jwt>
Body: { "request_id": "uuid" }
```

### Behavior

1. Derive `user_id` from JWT.
2. Fetch the `sign_requests` row by ID using service-role client.
3. Verify: caller is a party (`tech_user_id` or `supervisor_user_id`) AND status is terminal (`signed`, `declined`, `withdrawn`, `expired`). Otherwise return `403`.
4. List all objects under `sign-requests/{request_id}/` in Storage.
5. Delete them all via `storage.from('sign-requests').remove(keys)`.
6. Return `{ ok: true, deleted_count: N }`.

### Client integration

Add `cleanupRequestAssets(requestId: string): Promise<void>` to the `CloudClient` interface and both implementations (Supabase calls the Edge Function; mock is a no-op).

Called at the end of these operations in `signRequestsService`, wrapped in try/catch (non-fatal, best-effort):

- `applyIncomingSignature` (after successfully writing the local signature)
- `withdraw` (after successful withdraw)
- `decline` (after successful decline)

If the call fails, assets linger harmlessly until the daily cron handles cleanup.

---

## 4. pg_cron Jobs

New migration: `supabase/migrations/20260419_cron_jobs.sql`. Requires the `pg_cron` extension (enabled by default on Supabase).

### 4a. Hourly: expire stale pending requests

```sql
SELECT cron.schedule('expire-pending-requests', '0 * * * *', $$
  UPDATE sign_requests
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at < now();
$$);
```

The existing partial index `idx_req_expires` on `(expires_at) WHERE status = 'pending'` makes this efficient. Expired rows hit Realtime, so the tech's `sync()` picks them up and clears `pending_sign_request_id` — that logic already exists in `sync()` for terminal statuses.

### 4b. Daily: hard-delete old terminal rows

```sql
SELECT cron.schedule('cleanup-terminal-requests', '0 3 * * *', $$
  DELETE FROM sign_requests
  WHERE status IN ('signed', 'declined', 'withdrawn', 'expired')
    AND updated_at < now() - interval '90 days';
$$);
```

Orphan Storage assets (from missed `cleanup-request-assets` calls) are not scanned. The Edge Function handles the happy path; leftover assets are RLS-gated and invisible once the row is deleted. Storage cost is negligible. An orphan scan can be added later if needed.

### Rate-limit cleanup (piggyback on daily cron)

```sql
SELECT cron.schedule('cleanup-rate-limits', '0 4 * * *', $$
  DELETE FROM search_rate_limits
  WHERE searched_at < now() - interval '24 hours';
$$);
```

---

## 5. `delete-account` Edge Function Cascade

Extend the existing `supabase/functions/delete-account/index.ts` to clean up supervisor data before deleting the auth user.

### Added steps (inserted before existing `admin.auth.admin.deleteUser`)

1. **Flip in-flight sign requests to terminal states**:
   - `UPDATE sign_requests SET status = 'withdrawn', updated_at = now() WHERE tech_user_id = $uid AND status = 'pending'`
   - `UPDATE sign_requests SET status = 'declined', decline_reason = 'Supervisor account deleted', updated_at = now() WHERE supervisor_user_id = $uid AND status = 'pending'`
2. **Clean up sign-request assets**: for all requests where the user is a party (any status), list and delete `sign-requests/{request_id}/` from Storage.
3. **Delete supervisor directory entry**: `DELETE FROM supervisor_directory WHERE user_id = $uid` (explicit, though `ON DELETE CASCADE` would also handle it).
4. Existing logbook-backups cleanup proceeds as before.
5. Existing `admin.auth.admin.deleteUser(uid)` runs last — `ON DELETE CASCADE` removes remaining `supervisor_connections` and `sign_requests` rows.

Step 1 ensures the other party sees a clean terminal status via Realtime/sync rather than rows silently vanishing.

---

## 6. Client: Supervisor-side Photo Download in `SignRequestDetailScreen`

When the supervisor opens a sign request, `entry.photo_paths` contains the tech's local paths that don't resolve on the supervisor's device.

### Behavior

1. On screen mount, iterate the `assets_manifest` on the `SignRequest` object. Keys starting with `photo_` are entry photos.
2. For each photo key, call `cloud.downloadSignRequestAsset(bucketKey)` (stripping the `sign-requests/` bucket prefix as needed).
3. Write the downloaded bytes to `FileSystem.cacheDirectory` as a temp file.
4. Track per-photo state: `loading` | `loaded` (with local temp URI) | `failed`.
5. Render:
   - `loading`: `ActivityIndicator` in a 100x100 placeholder.
   - `loaded`: `Image` with the temp URI.
   - `failed`: gray placeholder with "Photo unavailable" text.

### No persistence

Temp files live in `cacheDirectory` — OS-managed, auto-cleaned. Re-opening the request re-downloads. No manual cleanup needed.

### Where the mapping lives

The `assets_manifest` on the stored `SignRequest` row contains **final rewritten keys** (e.g. `sign-requests/{request_id}/photo_e1_0.jpg`), not `PENDING` placeholders. `supabaseClient.ts::sendSignRequest` rewrites the manifest before inserting the row. To get the bucket-relative path for `downloadSignRequestAsset`, strip the `sign-requests/` prefix from each manifest key, yielding `{request_id}/photo_e1_0.jpg`.

The mock's `sendSignRequest` does NOT rewrite keys (it stores the `PENDING` form). The photo download logic should handle both: strip `sign-requests/` or `sign-requests/PENDING/` prefix, then use the remainder as the bucket key. Alternatively, iterate `entry.photo_paths` by index and reconstruct the expected key as `{request_id}/photo_{entry_id}_{index}.{ext}` — this is deterministic and sidesteps the manifest key format question.

---

## 7. Client: Auto-save on "Send for Signature" in `EntryFormScreen`

Currently tapping a supervisor in the picker sends the on-disk entry data, ignoring unsaved form edits.

### Behavior

1. Extract the current save logic from `handleSave` into a reusable async function `saveEntry(): Promise<string>` that validates, persists, and returns the entry ID.
2. The Save button calls `saveEntry()` then navigates back (existing behavior).
3. The supervisor picker's `onPress` calls `saveEntry()` first, then `signReqs.send.mutateAsync({ entry_id, connection_id, supervisor_user_id })`, then navigates back.
4. If `saveEntry()` fails validation (invalid hours, etc.), the validation error is shown and the send is aborted — same UX as tapping Save with bad data.
5. The "Send for signature" button's existing `disabled` gate (`entryIsComplete` check) prevents sending obviously incomplete entries, so `saveEntry()` is primarily about capturing recent edits.

### No new components

This is a refactor within `EntryFormScreen` only — extract function, compose in two places.
