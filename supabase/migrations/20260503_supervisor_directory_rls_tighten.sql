-- 20260503_supervisor_directory_rls_tighten.sql
-- The original dir_select policy was `using (true)`, which let any
-- authenticated user dump the entire supervisor_directory table via
-- PostgREST and bypass both the rate-limited search-supervisors Edge
-- Function and its cert-number masking for name searches. Cert numbers of
-- every visible directory row leaked at scale.
--
-- Tightened to `using (auth.uid() = user_id)`: a row is only readable by
-- its owner. The search-supervisors Edge Function uses the service-role
-- key (admin client) and bypasses RLS, so directory discovery still works
-- for paying users — it just can't be done by hitting the table directly.
--
-- The self-read inside respondToConnection (looks up the supervisor's own
-- display_name on accept) is preserved by the auth.uid() check.

drop policy if exists dir_select on supervisor_directory;
create policy dir_select on supervisor_directory
  for select to authenticated
  using (auth.uid() = user_id);
