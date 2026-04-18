-- 20260418_supervisor_accounts.sql
-- Supervisor Accounts & Remote Signing — Postgres schema and RLS.
-- See docs/superpowers/specs/2026-04-18-supervisor-accounts-design.md §4 for rationale.

create extension if not exists pg_trgm;

-- ============================================================================
-- supervisor_connections
-- ============================================================================
create table supervisor_connections (
  id uuid primary key default gen_random_uuid(),
  tech_user_id uuid not null references auth.users(id) on delete cascade,
  supervisor_user_id uuid references auth.users(id) on delete cascade,
  status text not null check (status in ('pending','accepted','declined','revoked')),
  invited_email text not null,
  supervisor_display_name text,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uniq_conn_tech_sup on supervisor_connections (tech_user_id, supervisor_user_id)
  where supervisor_user_id is not null;
create unique index uniq_conn_tech_email on supervisor_connections (tech_user_id, invited_email)
  where supervisor_user_id is null;
create index idx_conn_tech on supervisor_connections (tech_user_id);
create index idx_conn_supervisor on supervisor_connections (supervisor_user_id);
create index idx_conn_invited_email on supervisor_connections (invited_email) where supervisor_user_id is null;

alter table supervisor_connections enable row level security;

create policy conn_select on supervisor_connections
  for select to authenticated
  using (auth.uid() = tech_user_id or auth.uid() = supervisor_user_id);

create policy conn_insert on supervisor_connections
  for insert to authenticated
  with check (auth.uid() = tech_user_id);

create policy conn_update_tech on supervisor_connections
  for update to authenticated
  using (auth.uid() = tech_user_id)
  with check (auth.uid() = tech_user_id);

create policy conn_update_sup on supervisor_connections
  for update to authenticated
  using (auth.uid() = supervisor_user_id)
  with check (auth.uid() = supervisor_user_id);

-- Re-invite cooldown: when status flips from 'declined' back to 'pending',
-- enforce that declined_at is older than 30 days. Clear declined_at on re-invite.
create or replace function enforce_reinvite_cooldown() returns trigger as $$
begin
  if old.status = 'declined' and new.status = 'pending' then
    if old.declined_at is not null and old.declined_at > now() - interval '30 days' then
      raise exception 'cooldown_active';
    end if;
    new.declined_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger enforce_reinvite_cooldown_trg
  before update on supervisor_connections
  for each row execute function enforce_reinvite_cooldown();

-- When a new auth.users row is created, backfill supervisor_user_id on any
-- pending email-invite connections whose invited_email matches the new user.
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

-- ============================================================================
-- sign_requests
-- ============================================================================
create table sign_requests (
  id uuid primary key default gen_random_uuid(),
  tech_user_id uuid not null references auth.users(id) on delete cascade,
  supervisor_user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references supervisor_connections(id),
  entry_payload jsonb not null,
  assets_manifest jsonb not null,
  status text not null check (status in ('pending','signed','declined','withdrawn','expired')),
  decline_reason text,
  signature_png_path text,
  supervisor_name_snapshot text,
  supervisor_cert_number_snapshot text,
  entry_hash text,
  hash_version int,
  signed_device_id text,
  signed_gps_lat double precision,
  signed_gps_lon double precision,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  signed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index idx_req_tech_status on sign_requests (tech_user_id, status);
create index idx_req_supervisor_status on sign_requests (supervisor_user_id, status);
create index idx_req_expires on sign_requests (expires_at) where status = 'pending';

alter table sign_requests enable row level security;

create policy req_select on sign_requests
  for select to authenticated
  using (auth.uid() in (tech_user_id, supervisor_user_id));

-- Tech can only insert a new sign_request against an accepted connection.
create policy req_insert on sign_requests
  for insert to authenticated
  with check (
    auth.uid() = tech_user_id
    and exists (
      select 1 from supervisor_connections c
      where c.id = connection_id
        and c.tech_user_id = auth.uid()
        and c.supervisor_user_id = sign_requests.supervisor_user_id
        and c.status = 'accepted'
    )
  );

-- Tech can withdraw from pending → withdrawn only.
create policy req_update_tech_withdraw on sign_requests
  for update to authenticated
  using (auth.uid() = tech_user_id and status = 'pending')
  with check (auth.uid() = tech_user_id and status in ('pending','withdrawn'));

-- Supervisor can sign or decline from pending only.
create policy req_update_sup_sign_or_decline on sign_requests
  for update to authenticated
  using (auth.uid() = supervisor_user_id and status = 'pending')
  with check (auth.uid() = supervisor_user_id and status in ('pending','signed','declined'));

-- ============================================================================
-- supervisor_directory
-- ============================================================================
create table supervisor_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  sprat_cert_number text not null,
  visible boolean not null default true,
  updated_at timestamptz not null default now()
);

create index idx_dir_sprat on supervisor_directory (sprat_cert_number) where visible;
create index idx_dir_name_trgm on supervisor_directory using gin (display_name gin_trgm_ops) where visible;

alter table supervisor_directory enable row level security;

-- Directory is intentionally readable; rate limiting / query validation
-- is the Edge Function's job (deferred to Part B).
create policy dir_select on supervisor_directory
  for select to authenticated using (true);

create policy dir_upsert on supervisor_directory
  for insert to authenticated with check (auth.uid() = user_id);

create policy dir_update on supervisor_directory
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy dir_delete on supervisor_directory
  for delete to authenticated using (auth.uid() = user_id);

-- ============================================================================
-- Storage: sign-requests bucket + RLS
-- ============================================================================
insert into storage.buckets (id, name, public) values ('sign-requests', 'sign-requests', false)
  on conflict (id) do nothing;

create policy "sign_requests_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sign-requests'
    and exists (
      select 1 from public.sign_requests r
      where r.id::text = (storage.foldername(name))[1]
        and auth.uid() in (r.tech_user_id, r.supervisor_user_id)
    )
  );

create policy "sign_requests_insert_tech_photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sign-requests'
    and storage.filename(name) like 'photo_%'
    and exists (
      select 1 from public.sign_requests r
      where r.id::text = (storage.foldername(name))[1]
        and auth.uid() = r.tech_user_id
    )
  );

create policy "sign_requests_insert_sup_signature"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sign-requests'
    and storage.filename(name) = 'sig.png'
    and exists (
      select 1 from public.sign_requests r
      where r.id::text = (storage.foldername(name))[1]
        and auth.uid() = r.supervisor_user_id
    )
  );

-- ============================================================================
-- Realtime publication — enable Supabase Realtime for both new tables.
-- Without this, subscribeConnections / subscribeSignRequests will subscribe
-- silently but receive no events.
-- ============================================================================
alter publication supabase_realtime add table supervisor_connections;
alter publication supabase_realtime add table sign_requests;
