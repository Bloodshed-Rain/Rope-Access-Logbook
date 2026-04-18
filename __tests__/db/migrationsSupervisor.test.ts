import { createTestClient, createLegacyTestClient } from '../setup';
import { runSchemaMigrations } from '../../src/db/migrations';

describe('supervisor-accounts migrations', () => {
  test('adds new profile columns on legacy DB', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>("PRAGMA table_info(profile)");
    const names = cols.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'supervisor_capability_enabled',
      'supervisor_cert_number',
      'supervisor_directory_visible',
    ]));
  });

  test('adds pending_sign_request_id to entries on legacy DB', async () => {
    const db = createLegacyTestClient();
    await runSchemaMigrations(db);
    const cols = await db.getAll<{ name: string }>("PRAGMA table_info(entries)");
    expect(cols.map(c => c.name)).toContain('pending_sign_request_id');
  });

  test('creates supervisor_connections_cache and sign_requests_cache', async () => {
    const db = await createTestClient();
    const tables = await db.getAll<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'"
    );
    const names = tables.map(t => t.name);
    expect(names).toContain('supervisor_connections_cache');
    expect(names).toContain('sign_requests_cache');
  });

  test('migrations are idempotent', async () => {
    const db = await createTestClient();
    // createTestClient already ran once; run again should not throw
    await runSchemaMigrations(db);
    await runSchemaMigrations(db);
  });
});
