-- 20260505_search_rate_limits_rls.sql
-- search_rate_limits was created (20260419_cron_jobs.sql) on the assumption
-- that "only the Edge Function (service-role) reads/writes this table" so RLS
-- was unnecessary. That assumption was wrong: Supabase grants the
-- `authenticated` role full DML on `public` tables by default, so any
-- logged-in user can hit search_rate_limits via PostgREST and DELETE their
-- own rows to reset the 20-search/day cap enforced by search-supervisors.
--
-- Fix: enable RLS with no policies. Default-deny for `authenticated`;
-- service-role bypasses RLS so the Edge Function continues to read/write
-- normally, and the daily pg_cron purge runs as superuser and is unaffected.

alter table search_rate_limits enable row level security;
