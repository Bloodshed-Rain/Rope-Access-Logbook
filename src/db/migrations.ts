import { DbClient } from './client';

interface ColumnInfo {
  name: string;
}

async function hasColumn(db: DbClient, table: string, column: string): Promise<boolean> {
  const rows = await db.getAll<ColumnInfo>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

export async function runSchemaMigrations(db: DbClient): Promise<void> {
  if (!(await hasColumn(db, 'profile', 'photos_in_backup'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN photos_in_backup INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await hasColumn(db, 'profile', 'last_cloud_backup_at'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN last_cloud_backup_at TEXT');
  }
  if (!(await hasColumn(db, 'profile', 'last_uploaded_backup_id'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN last_uploaded_backup_id TEXT');
  }
  if (!(await hasColumn(db, 'signatures', 'hash_version'))) {
    await db.exec('ALTER TABLE signatures ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1');
  }
  if (!(await hasColumn(db, 'entries', 'date_from'))) {
    await db.exec('ALTER TABLE entries ADD COLUMN date_from TEXT');
  }
  if (!(await hasColumn(db, 'entries', 'date_to'))) {
    await db.exec('ALTER TABLE entries ADD COLUMN date_to TEXT');
  }
  if (!(await hasColumn(db, 'entries', 'other_work_description'))) {
    await db.exec('ALTER TABLE entries ADD COLUMN other_work_description TEXT');
  }
  // Backfill: existing rows have `date` but null `date_from`/`date_to`.
  // Set range = single date. Idempotent — only touches unmigrated rows.
  await db.exec("UPDATE entries SET date_from = date WHERE date_from IS NULL");
  await db.exec("UPDATE entries SET date_to = date WHERE date_to IS NULL");

  if (!(await hasColumn(db, 'profile', 'supervisor_capability_enabled'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN supervisor_capability_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!(await hasColumn(db, 'profile', 'supervisor_cert_number'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN supervisor_cert_number TEXT');
  }
  if (!(await hasColumn(db, 'profile', 'supervisor_directory_visible'))) {
    await db.exec('ALTER TABLE profile ADD COLUMN supervisor_directory_visible INTEGER NOT NULL DEFAULT 1');
  }
  if (!(await hasColumn(db, 'entries', 'pending_sign_request_id'))) {
    await db.exec('ALTER TABLE entries ADD COLUMN pending_sign_request_id TEXT');
  }

  // Cache tables — idempotent create
  await db.exec(`
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
  `);
  await db.exec(`
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
      payload_json TEXT NOT NULL
    );
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_pending_sign_request ON entries(pending_sign_request_id);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_status ON sign_requests_cache(status);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_entry ON sign_requests_cache(entry_id);`);
}
