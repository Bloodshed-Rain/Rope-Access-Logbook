-- 20260503_sign_requests_updated_at.sql
-- Adds a BEFORE UPDATE trigger that bumps sign_requests.updated_at on every
-- mutation. Without this, supervisor signRequest / declineRequest /
-- withdrawRequest mutations leave updated_at unchanged, and the tech-side
-- incremental sync filter `WHERE updated_at > since` excludes the row from
-- the next sync — applyIncomingSignature never fires on the tech's device
-- and remote signing silently fails to land.
--
-- supervisor_connections already has its own enforce_reinvite_cooldown_trg
-- that bumps updated_at as a side effect, so this trigger is scoped to
-- sign_requests only.

create or replace function bump_sign_requests_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists bump_sign_requests_updated_at_trg on sign_requests;
create trigger bump_sign_requests_updated_at_trg
  before update on sign_requests
  for each row execute function bump_sign_requests_updated_at();
