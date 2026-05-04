import { DbClient } from './client';

interface ColumnInfo {
  name: string;
}

async function hasColumn(db: DbClient, table: string, column: string): Promise<boolean> {
  const rows = await db.getAll<ColumnInfo>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

// One-shot SQLite table rebuild: legacy `profile` had NOT NULL on sprat_id/level/
// cert_expires_on. The dual-cert design needs those nullable so an IRATA-only user
// is first-class. SQLite can't drop NOT NULL without rebuilding the table.
async function rebuildProfileForDualCert(db: DbClient): Promise<void> {
  // Rebuild executes inside a transaction so partial failure rolls back cleanly.
  await db.exec('BEGIN');
  try {
    await db.exec(`
      CREATE TABLE profile_new (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        holds_sprat INTEGER NOT NULL DEFAULT 1,
        sprat_id TEXT,
        level TEXT CHECK (level IS NULL OR level IN ('I', 'II', 'III')),
        cert_expires_on TEXT,
        sprat_card_photo_path TEXT,
        holds_irata INTEGER NOT NULL DEFAULT 0,
        irata_id TEXT,
        irata_level TEXT CHECK (irata_level IS NULL OR irata_level IN ('I', 'II', 'III')),
        irata_expires_on TEXT,
        irata_card_photo_path TEXT,
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
    `);

    // Detect which "old" shape we're migrating from. Two real cases:
    //   (a) very-old schema: profile lacks supervisor_* and subscription_status
    //   (b) immediate-pre-dual-cert schema: has those, lacks holds_irata
    // runSchemaMigrations runs ALTERs for case (a) before this rebuild, so by
    // the time we reach here the profile table has all the legacy columns.
    await db.exec(`
      INSERT INTO profile_new (
        id, full_name, holds_sprat, sprat_id, level, cert_expires_on, sprat_card_photo_path,
        holds_irata, irata_id, irata_level, irata_expires_on, irata_card_photo_path,
        primary_cert,
        default_employer, last_backup_at, photos_in_backup, last_cloud_backup_at, last_uploaded_backup_id,
        supervisor_capability_enabled, supervisor_cert_number, supervisor_directory_visible,
        subscription_status, created_at, updated_at
      )
      SELECT
        id, full_name, 1, sprat_id, level, cert_expires_on, sprat_card_photo_path,
        0, NULL, NULL, NULL, NULL,
        'sprat',
        default_employer, last_backup_at, photos_in_backup, last_cloud_backup_at, last_uploaded_backup_id,
        supervisor_capability_enabled, supervisor_cert_number, supervisor_directory_visible,
        subscription_status, created_at, updated_at
      FROM profile;
    `);

    await db.exec('DROP TABLE profile');
    await db.exec('ALTER TABLE profile_new RENAME TO profile');
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
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

  // 1. Rename subscription_tier -> subscription_status (idempotent + crash-safe)
  // The three-statement rename runs inside a transaction so a crash leaves the
  // table in a known-good shape. The both-columns branch recovers from a pre-
  // transaction partial migration that may exist on devices that ran an older
  // build of this code.
  const profileCols = await db.getAll<{ name: string }>(`PRAGMA table_info(profile)`);
  const colNames = profileCols.map((c) => c.name);
  if (colNames.includes('subscription_tier') && !colNames.includes('subscription_status')) {
    await db.exec('BEGIN');
    try {
      await db.exec(`ALTER TABLE profile ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'unknown'`);
      await db.exec(`UPDATE profile SET subscription_status = CASE
        WHEN subscription_tier = 'pro' THEN 'active'
        ELSE 'unknown'
      END`);
      await db.exec(`ALTER TABLE profile DROP COLUMN subscription_tier`);
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  } else if (colNames.includes('subscription_tier') && colNames.includes('subscription_status')) {
    // Recovery: a prior pre-transaction partial run left both columns. Drop
    // the legacy column. subscription_status already holds the migrated value.
    await db.exec(`ALTER TABLE profile DROP COLUMN subscription_tier`);
  } else if (!colNames.includes('subscription_status')) {
    await db.exec(`ALTER TABLE profile ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'unknown'`);
  }

  // 2. notifications table (idempotent — for legacy devices that ran an older SCHEMA_SQL)
  await db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    read_at TEXT,
    dismissed_at TEXT
  )`);
  await db.exec(
    `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL`
  );

  // Dual-cert rebuild. Idempotent gate: holds_irata is only present after rebuild.
  if (!(await hasColumn(db, 'profile', 'holds_irata'))) {
    await rebuildProfileForDualCert(db);
  }

  // Per-entry IRATA level snapshot. SPRAT level snapshot stays under the legacy
  // column name `tech_level_snapshot` because v1/v2/v3 hash algorithms read it
  // directly; renaming would break every existing signature.
  if (!(await hasColumn(db, 'entries', 'irata_level_snapshot'))) {
    await db.exec(
      "ALTER TABLE entries ADD COLUMN irata_level_snapshot TEXT CHECK (irata_level_snapshot IS NULL OR irata_level_snapshot IN ('I', 'II', 'III'))",
    );
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
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_entries_pending_sign_request ON entries(pending_sign_request_id) WHERE pending_sign_request_id IS NOT NULL;`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_status ON sign_requests_cache(status);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_sign_requests_cache_entry ON sign_requests_cache(entry_id);`);
  if (!(await hasColumn(db, 'sign_requests_cache', 'local_photo_paths_json'))) {
    await db.exec('ALTER TABLE sign_requests_cache ADD COLUMN local_photo_paths_json TEXT');
  }
}
