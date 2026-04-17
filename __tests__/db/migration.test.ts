import { createLegacyTestClient } from '../setup';
import { runSchemaMigrations } from '../../src/db/migrations';

interface ColumnInfo { name: string }

async function listColumns(db: ReturnType<typeof createLegacyTestClient>, table: string): Promise<string[]> {
  const rows = await db.getAll<ColumnInfo>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

describe('runSchemaMigrations', () => {
  it('adds the v2 columns to a legacy DB', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);

    const profileCols = await listColumns(db, 'profile');
    expect(profileCols).toContain('photos_in_backup');
    expect(profileCols).toContain('last_cloud_backup_at');
    expect(profileCols).toContain('last_uploaded_backup_id');

    const sigCols = await listColumns(db, 'signatures');
    expect(sigCols).toContain('hash_version');
  });

  it('is idempotent — running twice does not error', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    await expect(runSchemaMigrations(db)).resolves.not.toThrow();
  });

  it('defaults photos_in_backup to 0 for existing rows', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['p-1', 'Test', 'S1', 'II', '2027-01-01', '2026-04-16', '2026-04-16'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ photos_in_backup: number }>('SELECT photos_in_backup FROM profile WHERE id = ?', ['p-1']);
    expect(row?.photos_in_backup).toBe(0);
  });

  it('defaults hash_version to 1 for existing signatures', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO entries (id, date, employer, site, client, description, work_hours, tech_level_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e-1', '2026-04-01', 'Emp', 'Site', 'Cli', 'Desc', 8, 'II', '2026-04-01', '2026-04-01'],
    );
    await db.run(
      `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, entry_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['s-1', 'e-1', 'Sup', 'L3-X', '/p.png', '2026-04-01', 'd-1', 'hash', '2026-04-01'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ hash_version: number }>('SELECT hash_version FROM signatures WHERE id = ?', ['s-1']);
    expect(row?.hash_version).toBe(1);
  });
});
