# Supabase setup for Rope Access Logbook

## Dev project setup

1. Create a new Supabase project.
2. Enable Apple, Google, and Email auth providers in Authentication → Providers.
3. In Authentication → URL Configuration, add `logbook://auth-callback` to Redirect URLs.
4. In Authentication → Settings → Advanced, enable "Manual linking" for Identity Linking.
5. Apply all migrations in `supabase/migrations/` in filename order:
   ```bash
   supabase db push --db-url postgres://...
   # or paste each SQL file into the SQL editor, oldest first.
   ```
6. Deploy all Edge Functions:
   ```bash
   supabase functions deploy delete-account          --no-verify-jwt
   supabase functions deploy cleanup-request-assets  --no-verify-jwt
   supabase functions deploy notify-sign-request     --no-verify-jwt
   supabase functions deploy invite-supervisor
   supabase functions deploy search-supervisors
   ```
   The first three deploy with `--no-verify-jwt` because they need to read the auth header and verify it manually (e.g. `delete-account` derives `user_id` from the JWT to delete the caller's own account, never accepting it as a parameter). `invite-supervisor` and `search-supervisors` deploy without that flag and rely on Supabase's standard JWT verification.
7. Set secrets for the functions:
   ```bash
   supabase secrets set \
     SUPABASE_URL=https://<project-ref>.supabase.co \
     SUPABASE_ANON_KEY=eyJ... \
     SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
8. Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` into the developer's local `.env` at repo root.

## Production setup

Mirror the dev setup. Ship production values in the release bundle via `app.config.ts`'s `extra` block (fed from `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars at build time).

## How notifications are wired

The app's `signRequestsService` calls `cloud.notifySignRequest(...)` from the device that just performed the mutation (send / withdraw / decline / sign). That invokes the `notify-sign-request` Edge Function, which:

1. Verifies the caller's JWT is valid.
2. Looks up the `sign_requests` row with the service-role key and confirms the caller is a party to it (tech or supervisor).
3. Routes the notification to the other party (supervisor on INSERT, tech on signed/declined, supervisor on withdrawn).
4. Looks up the recipient's Expo push token in `push_tokens` and POSTs to `https://exp.host/--/api/v2/push/send`.

No database triggers, no `pg_net`, no `ALTER DATABASE` configuration. Dispatch runs on the client's authenticated session and a failed notify never fails the underlying sign-request mutation.
