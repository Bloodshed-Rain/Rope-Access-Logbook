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
}
