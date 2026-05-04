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

  it('adds date_from / date_to / other_work_description columns to entries', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await listColumns(db, 'entries');
    expect(cols).toContain('date_from');
    expect(cols).toContain('date_to');
    expect(cols).toContain('other_work_description');
  });

  it('backfills date_from / date_to from date on existing entries', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO entries (id, date, employer, site, client, description, work_hours, tech_level_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e-old', '2026-03-10', 'Emp', 'Site', 'Cli', 'Desc', 8, 'II', '2026-03-10', '2026-03-10'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ date_from: string; date_to: string }>(
      'SELECT date_from, date_to FROM entries WHERE id = ?',
      ['e-old'],
    );
    expect(row?.date_from).toBe('2026-03-10');
    expect(row?.date_to).toBe('2026-03-10');
  });

  it('does not overwrite date_from / date_to on second run', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO entries (id, date, employer, site, client, description, work_hours, tech_level_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e-old', '2026-03-10', 'Emp', 'Site', 'Cli', 'Desc', 8, 'II', '2026-03-10', '2026-03-10'],
    );
    await runSchemaMigrations(db);
    // User later widens the range on this entry.
    await db.run(
      'UPDATE entries SET date_from = ?, date_to = ? WHERE id = ?',
      ['2026-03-10', '2026-03-15', 'e-old'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ date_from: string; date_to: string }>(
      'SELECT date_from, date_to FROM entries WHERE id = ?',
      ['e-old'],
    );
    expect(row?.date_from).toBe('2026-03-10');
    expect(row?.date_to).toBe('2026-03-15');
  });

  // Dual-cert (IRATA + SPRAT) migration

  it('adds irata_level_snapshot column to entries', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await listColumns(db, 'entries');
    expect(cols).toContain('irata_level_snapshot');
  });

  it('rebuilds profile to add IRATA columns + holds_*/primary_cert flags', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await listColumns(db, 'profile');
    expect(cols).toContain('holds_sprat');
    expect(cols).toContain('holds_irata');
    expect(cols).toContain('irata_id');
    expect(cols).toContain('irata_level');
    expect(cols).toContain('irata_expires_on');
    expect(cols).toContain('irata_card_photo_path');
    expect(cols).toContain('primary_cert');
  });

  it('preserves all legacy SPRAT-only profile values across the rebuild', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, default_employer, sprat_card_photo_path, last_backup_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['p-legacy', 'Jane Tech', 'S-9107', 'II', '2027-05-01', 'Acme', '/photos/card.jpg', '2026-04-01', '2026-04-01', '2026-04-15'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{
      id: string; full_name: string; sprat_id: string; level: string;
      cert_expires_on: string; default_employer: string; sprat_card_photo_path: string;
      last_backup_at: string;
      holds_sprat: number; holds_irata: number;
      irata_id: string | null; irata_level: string | null; irata_expires_on: string | null; irata_card_photo_path: string | null;
      primary_cert: string;
    }>('SELECT * FROM profile WHERE id = ?', ['p-legacy']);
    expect(row).toBeTruthy();
    expect(row!.full_name).toBe('Jane Tech');
    expect(row!.sprat_id).toBe('S-9107');
    expect(row!.level).toBe('II');
    expect(row!.cert_expires_on).toBe('2027-05-01');
    expect(row!.default_employer).toBe('Acme');
    expect(row!.sprat_card_photo_path).toBe('/photos/card.jpg');
    expect(row!.last_backup_at).toBe('2026-04-01');
    expect(row!.holds_sprat).toBe(1);
    expect(row!.holds_irata).toBe(0);
    expect(row!.irata_id).toBeNull();
    expect(row!.irata_level).toBeNull();
    expect(row!.irata_expires_on).toBeNull();
    expect(row!.irata_card_photo_path).toBeNull();
    expect(row!.primary_cert).toBe('sprat');
  });

  it('profile rebuild is idempotent — running migrations twice does not error or duplicate', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['p-1', 'Tech', 'S1', 'I', '2027-01-01', '2026-04-01', '2026-04-01'],
    );
    await runSchemaMigrations(db);
    await expect(runSchemaMigrations(db)).resolves.not.toThrow();
    const rows = await db.getAll<{ id: string }>('SELECT id FROM profile');
    expect(rows.length).toBe(1);
  });

  it('legacy entries get NULL irata_level_snapshot', async () => {
    const db = createLegacyTestClient();
    await db.run(
      `INSERT INTO entries (id, date, employer, site, client, description, work_hours, tech_level_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['e-old', '2026-03-10', 'Emp', 'Site', 'Cli', 'Desc', 8, 'II', '2026-03-10', '2026-03-10'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ irata_level_snapshot: string | null; tech_level_snapshot: string }>(
      'SELECT irata_level_snapshot, tech_level_snapshot FROM entries WHERE id = ?',
      ['e-old'],
    );
    expect(row?.tech_level_snapshot).toBe('II');
    expect(row?.irata_level_snapshot).toBeNull();
  });

  test('runSchemaMigrations creates notifications table with unread index', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>(`PRAGMA table_info(notifications)`);
    expect(cols.map((c) => c.name).sort()).toEqual([
      'created_at',
      'dismissed_at',
      'id',
      'kind',
      'payload_json',
      'read_at',
    ]);
    const idx = await db.getAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notifications'`
    );
    expect(idx.map((i) => i.name)).toContain('idx_notifications_unread');
  });

  test('runSchemaMigrations renames subscription_tier to subscription_status', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>(`PRAGMA table_info(profile)`);
    const names = cols.map((c) => c.name);
    expect(names).toContain('subscription_status');
    expect(names).not.toContain('subscription_tier');
  });

  test('runSchemaMigrations migrates subscription_tier value pro -> active', async () => {
    const db = createLegacyTestClient();
    // Seed the intermediate schema state: has subscription_tier but not subscription_status
    await db.exec(`ALTER TABLE profile ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'`);
    await db.run(
      `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, default_employer, created_at, updated_at, subscription_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['p1', 'Test', 'S1', 'II', '2027-01-01', '', '2026-01-01', '2026-01-01', 'pro'],
    );
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>(`PRAGMA table_info(profile)`);
    const names = cols.map((c) => c.name);
    expect(names).toContain('subscription_status');
    expect(names).not.toContain('subscription_tier');
    const row = await db.get<{ subscription_status: string }>(
      `SELECT subscription_status FROM profile WHERE id = ?`,
      ['p1'],
    );
    expect(row?.subscription_status).toBe('active');
  });

  test('runSchemaMigrations migrates subscription_tier value free -> unknown', async () => {
    const db = createLegacyTestClient();
    await db.exec(`ALTER TABLE profile ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'`);
    await db.run(
      `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, default_employer, created_at, updated_at, subscription_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['p2', 'Test2', 'S2', 'II', '2027-01-01', '', '2026-01-01', '2026-01-01', 'free'],
    );
    await runSchemaMigrations(db);
    const row = await db.get<{ subscription_status: string }>(
      `SELECT subscription_status FROM profile WHERE id = ?`,
      ['p2'],
    );
    expect(row?.subscription_status).toBe('unknown');
  });

  test('runSchemaMigrations recovers from a partial subscription_tier rename (both columns present)', async () => {
    // Simulates a device that ran an older pre-transaction build of this code
    // and crashed between ADD COLUMN and DROP COLUMN, leaving both columns.
    const db = createLegacyTestClient();
    await db.exec(`ALTER TABLE profile ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'`);
    await db.exec(`ALTER TABLE profile ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'unknown'`);
    await db.run(
      `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, default_employer, created_at, updated_at, subscription_tier, subscription_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['p3', 'Test3', 'S3', 'II', '2027-01-01', '', '2026-01-01', '2026-01-01', 'pro', 'active'],
    );
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>(`PRAGMA table_info(profile)`);
    const names = cols.map((c) => c.name);
    expect(names).not.toContain('subscription_tier');
    expect(names).toContain('subscription_status');
    const row = await db.get<{ subscription_status: string }>(
      `SELECT subscription_status FROM profile WHERE id = ?`,
      ['p3'],
    );
    expect(row?.subscription_status).toBe('active');
  });
});
