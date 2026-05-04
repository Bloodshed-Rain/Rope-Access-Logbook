// src/db/schema.ts
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS profile (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    -- SPRAT block (legacy column names preserved, nullable so IRATA-only users are first-class)
    holds_sprat INTEGER NOT NULL DEFAULT 1,
    sprat_id TEXT,
    level TEXT CHECK (level IS NULL OR level IN ('I', 'II', 'III')),
    cert_expires_on TEXT,
    sprat_card_photo_path TEXT,
    avatar_path TEXT,
    -- IRATA block
    holds_irata INTEGER NOT NULL DEFAULT 0,
    irata_id TEXT,
    irata_level TEXT CHECK (irata_level IS NULL OR irata_level IN ('I', 'II', 'III')),
    irata_expires_on TEXT,
    irata_card_photo_path TEXT,
    -- Drives the dashboard cert-toggle default
    primary_cert TEXT NOT NULL DEFAULT 'sprat' CHECK (primary_cert IN ('irata', 'sprat')),
    default_employer TEXT NOT NULL DEFAULT '',
    last_backup_at TEXT,
    photos_in_backup INTEGER NOT NULL DEFAULT 0,
    last_cloud_backup_at TEXT,
    last_uploaded_backup_id TEXT,
    supervisor_capability_enabled INTEGER NOT NULL DEFAULT 0,
    supervisor_cert_number TEXT,
    supervisor_directory_visible INTEGER NOT NULL DEFAULT 1,
    subscription_status TEXT NOT NULL DEFAULT 'unknown',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    date_from TEXT,
    date_to TEXT,
    employer TEXT NOT NULL,
    site TEXT NOT NULL,
    client TEXT NOT NULL,
    description TEXT NOT NULL,
    work_hours REAL NOT NULL,
    -- tech_level_snapshot is the SPRAT-level snapshot under its legacy name, kept
    -- for hash stability across v1/v2/v3 signature algorithms (all read this column).
    tech_level_snapshot TEXT NOT NULL CHECK (tech_level_snapshot IN ('I', 'II', 'III')),
    irata_level_snapshot TEXT CHECK (irata_level_snapshot IS NULL OR irata_level_snapshot IN ('I', 'II', 'III')),
    work_types TEXT NOT NULL DEFAULT '[]',
    other_work_description TEXT,
    equipment_notes TEXT,
    weather TEXT,
    photo_paths TEXT NOT NULL DEFAULT '[]',
    -- 'amended' is reserved by the CHECK but no code path writes it. Supersedence is
    -- derived at query time (entriesService.getTotalWorkHours / getLifetimeHoursByLevel
    -- skip an original if a signed amendment exists). Mutating status to 'amended'
    -- would invalidate the original's signature because status is in the canonical
    -- hash input (signingService.entryRowToHashInputV1/V2/V3).
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'amended')),
    amends_entry_id TEXT REFERENCES entries(id),
    amendment_reason TEXT,
    pending_sign_request_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS signatures (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES entries(id),
    supervisor_name TEXT NOT NULL,
    supervisor_cert_number TEXT NOT NULL,
    signature_png_path TEXT NOT NULL,
    signed_at TEXT NOT NULL,
    device_id TEXT NOT NULL,
    gps_lat REAL,
    gps_lon REAL,
    entry_hash TEXT NOT NULL,
    hash_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
  CREATE INDEX IF NOT EXISTS idx_entries_amends ON entries(amends_entry_id);
  CREATE INDEX IF NOT EXISTS idx_signatures_entry ON signatures(entry_id);

  CREATE TABLE IF NOT EXISTS supervisor_connections_cache (
    id TEXT PRIMARY KEY,
    tech_user_id TEXT NOT NULL,
    supervisor_user_id TEXT,
    status TEXT NOT NULL,
    invited_email TEXT NOT NULL,
    supervisor_display_name TEXT,
    declined_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sign_requests_cache (
    id TEXT PRIMARY KEY,
    tech_user_id TEXT NOT NULL,
    supervisor_user_id TEXT NOT NULL,
    entry_id TEXT,
    status TEXT NOT NULL,
    decline_reason TEXT,
    signed_at TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    local_photo_paths_json TEXT
  );

  -- idx_entries_pending_sign_request lives in migrations.ts only. It references
  -- the pending_sign_request_id column added by runSchemaMigrations, which runs
  -- AFTER this SCHEMA_SQL block. Creating it here would fail on devices upgrading
  -- from a pre-supervisor-accounts schema because the column doesn't yet exist
  -- when CREATE TABLE IF NOT EXISTS above no-ops on an existing entries table.
  CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_status ON sign_requests_cache(status);
  CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_entry ON sign_requests_cache(entry_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    read_at TEXT,
    dismissed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON notifications(read_at) WHERE read_at IS NULL;
`;
