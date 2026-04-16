// src/db/schema.ts
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS profile (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    sprat_id TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('I', 'II', 'III')),
    cert_expires_on TEXT NOT NULL,
    default_employer TEXT NOT NULL DEFAULT '',
    sprat_card_photo_path TEXT,
    last_backup_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    employer TEXT NOT NULL,
    site TEXT NOT NULL,
    client TEXT NOT NULL,
    description TEXT NOT NULL,
    work_hours REAL NOT NULL,
    tech_level_snapshot TEXT NOT NULL CHECK (tech_level_snapshot IN ('I', 'II', 'III')),
    work_types TEXT NOT NULL DEFAULT '[]',
    equipment_notes TEXT,
    weather TEXT,
    photo_paths TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'amended')),
    amends_entry_id TEXT REFERENCES entries(id),
    amendment_reason TEXT,
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
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
  CREATE INDEX IF NOT EXISTS idx_entries_amends ON entries(amends_entry_id);
  CREATE INDEX IF NOT EXISTS idx_signatures_entry ON signatures(entry_id);
`;
