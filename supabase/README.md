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
   The cron migration (`20260419_cron_jobs.sql`) requires the `pg_cron` extension and the push-tokens migration (`20260420_push_tokens.sql`) requires `pg_net`. Both are available by default on hosted Supabase; the migrations enable them if needed.
6. Deploy all Edge Functions:
   ```bash
   supabase functions deploy delete-account          --no-verify-jwt
   supabase functions deploy cleanup-request-assets  --no-verify-jwt
   supabase functions deploy notify-sign-request     --no-verify-jwt
   ```
   (`--no-verify-jwt` because each function verifies manually inside its handler using the caller's token, or runs as a trusted internal webhook.)
7. Set secrets for the functions:
   ```bash
   supabase secrets set \
     SUPABASE_URL=https://<project-ref>.supabase.co \
     SUPABASE_ANON_KEY=eyJ... \
     SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
8. Set two Postgres GUCs so the `sign_requests` insert/update trigger can reach `notify-sign-request`. Paste into the SQL editor (or run via `psql`), substituting your project ref and the service-role key:
   ```sql
   ALTER DATABASE postgres SET "app.settings.edge_function_url" =
     'https://<project-ref>.supabase.co/functions/v1';
   ALTER DATABASE postgres SET "app.settings.service_role_key" =
     'eyJ...your-service-role-key...';
   -- Apply to the currently-connected session without reconnecting.
   SELECT pg_reload_conf();
   ```
   Without these GUCs the trigger falls back to `http://host.docker.internal:54321/...` (Supabase CLI local dev default) and silently no-ops in prod.
9. Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` into the developer's local `.env` at repo root.

## Production setup

Mirror the dev setup. In particular:

- Steps 5–8 must all run against the prod cluster; the GUCs in step 8 are per-database and do not propagate from dev.
- Rotate the service-role key after any compromise; remember to re-run step 8 with the new value (Edge Function secrets in step 7 are read via `Deno.env.get`, independent of the GUCs used by `pg_net`).
- Ship production values in the release bundle via `app.config.ts`'s `extra` block (fed from `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars at build time).

## Verifying the notify-sign-request pipeline

After step 8, insert a test `sign_requests` row and confirm:

1. In the SQL editor, `SELECT * FROM cron.job;` returns the three scheduled jobs from `20260419_cron_jobs.sql`.
2. `SELECT net.http_get('https://<project-ref>.supabase.co/functions/v1/notify-sign-request');` returns a 200 or 400 (not a network error) — confirms `pg_net` can reach Edge Functions.
3. Inserting a `sign_requests` row with `status = 'pending'` results in a new row in the Edge Function logs for `notify-sign-request` within a few seconds. If the recipient has a row in `push_tokens`, the Expo push API call appears in the function logs with a `pushData.data.status` of `ok`.
