-- 20260506_gear_catalog.sql
-- Equipment Inventory & Inspection Tracker — gear catalog (autocomplete only).
-- See docs/superpowers/specs/2026-05-04-equipment-inventory-design.md §4.2.
--
-- The catalog is a flat manufacturer/model/category list cached on-device and
-- consulted by AddGearScreen / EditGearScreen for "Make / model" autocomplete.
-- It does not drive any logic — free-form typing always works. Public-readable
-- by any authenticated user; writes happen through the Supabase SQL editor.

create table gear_catalog (
  id uuid primary key default gen_random_uuid(),
  manufacturer text not null,
  model text not null,
  category text not null check (category in (
    'harness','helmet','rope','lanyard','sling',
    'descender','ascender','carabiner','pulley','other'
  )),
  created_at timestamptz not null default now(),
  unique (manufacturer, model)
);

alter table gear_catalog enable row level security;

-- Public list of manufacturer/model rows used for autocomplete only. No
-- security value in restricting this; widening to anon + authenticated so
-- the dropdown works in offline-first / pre-sign-in app states too.
create policy gear_catalog_select on gear_catalog
  for select to anon, authenticated using (true);
