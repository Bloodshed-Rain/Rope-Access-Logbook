# Supabase setup for Rope Access Logbook

## Dev project setup

1. Create a new Supabase project.
2. Enable Apple, Google, and Email auth providers in Authentication → Providers.
3. In Authentication → URL Configuration, add `logbook://auth-callback` to Redirect URLs.
4. In Authentication → Settings → Advanced, enable "Manual linking" for Identity Linking.
5. Apply the migration:
   ```bash
   supabase db push --db-url postgres://...
   # or paste supabase/migrations/20260416_storage_bucket_and_rls.sql in the SQL editor
   ```
6. Deploy the Edge Function:
   ```bash
   supabase functions deploy delete-account --no-verify-jwt
   ```
   (`--no-verify-jwt` because we verify manually inside the function using the caller's token.)
7. Set secrets for the function:
   ```bash
   supabase secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
   ```
8. Copy `SUPABASE_URL` and `SUPABASE_ANON_KEY` into the developer's local `.env` at repo root.

## Production setup

Mirror the dev setup. Ship production values in the release bundle.
