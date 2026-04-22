-- 20260421_harden_resolve_supervisor_invites.sql
-- Fixes the AFTER INSERT trigger on auth.users installed by
-- 20260418_supervisor_accounts.sql.
--
-- The original function was SECURITY DEFINER but did not pin search_path.
-- When Supabase Auth INSERTs a new user, the trigger runs in the
-- supabase_auth_admin session; its search_path is not guaranteed to include
-- 'public', so the bare reference to supervisor_connections can fail with
-- "relation does not exist", aborting the auth.users INSERT and surfacing
-- to the client as the generic string "Database error saving new user".
--
-- This migration recreates the function with SET search_path = '' and
-- schema-qualified table references (the pattern Supabase recommends for
-- every auth.users trigger). The trigger itself already points at this
-- function and does not need to be recreated.

create or replace function public.resolve_supervisor_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.supervisor_connections
     set supervisor_user_id = new.id,
         updated_at = now()
   where supervisor_user_id is null
     and lower(invited_email) = lower(new.email);
  return new;
end;
$$;
