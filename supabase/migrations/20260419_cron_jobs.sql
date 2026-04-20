-- 20260419_cron_jobs.sql
-- pg_cron scheduled jobs + search_rate_limits table.
-- See docs/superpowers/specs/2026-04-19-supervisor-accounts-part-b-design.md §2, §4.

-- ============================================================================
-- search_rate_limits (used by the search-supervisors Edge Function)
-- ============================================================================
CREATE TABLE IF NOT EXISTS search_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  searched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_user_time ON search_rate_limits (user_id, searched_at);

-- No RLS needed — only the Edge Function (service-role) reads/writes this table.

-- ============================================================================
-- pg_cron jobs
-- ============================================================================

-- Enable the extension (already enabled by default on hosted Supabase).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Hourly: expire stale pending sign requests past their expires_at.
-- The partial index idx_req_expires on (expires_at) WHERE status = 'pending'
-- makes this efficient.
SELECT cron.schedule('expire-pending-requests', '0 * * * *', $$
  UPDATE sign_requests
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at < now();
$$);

-- Daily at 3am UTC: hard-delete terminal sign_requests older than 90 days.
-- Orphan Storage assets are not scanned; the cleanup-request-assets Edge
-- Function handles the happy path. Leftover assets are RLS-gated and
-- invisible once the row is deleted.
SELECT cron.schedule('cleanup-terminal-requests', '0 3 * * *', $$
  DELETE FROM sign_requests
  WHERE status IN ('signed', 'declined', 'withdrawn', 'expired')
    AND updated_at < now() - interval '90 days';
$$);

-- Daily at 4am UTC: purge expired rate-limit rows.
SELECT cron.schedule('cleanup-rate-limits', '0 4 * * *', $$
  DELETE FROM search_rate_limits
  WHERE searched_at < now() - interval '24 hours';
$$);
