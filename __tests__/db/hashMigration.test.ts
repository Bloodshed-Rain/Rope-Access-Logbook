jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

import { createTestClient } from '../setup';
import { testSha256 } from '../testHash';
import { createEntriesService } from '../../src/services/entriesService';
import { createSigningService } from '../../src/services/signingService';
import { runHashMigration } from '../../src/db/hashMigration';

describe('runHashMigration', () => {
  let uuidCounter = 0;
  const testUuid = () => `id-${++uuidCounter}`;

  beforeEach(() => { uuidCounter = 0; });

  it('upgrades a v1 signature that currently verifies to v2 with a recomputed hash', async () => {
    const db = await createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);

    const entry = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
      photo_paths: ['file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg'],
    }, 'II');

    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });
    const v1Hash = await signing.computeEntryHashForVersion(entry.id, 1);
    await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', [v1Hash, entry.id]);

    await runHashMigration(db, testSha256);

    const row = await db.get<{ hash_version: number; entry_hash: string }>(
      'SELECT hash_version, entry_hash FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(row!.hash_version).toBe(2);
    const expectedV2 = await signing.computeEntryHashForVersion(entry.id, 2);
    expect(row!.entry_hash).toBe(expectedV2);
  });

  it('leaves v1 signatures that fail v1 verification untouched', async () => {
    const db = await createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);

    const entry = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });
    await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', ['bogus-hash', entry.id]);

    await runHashMigration(db, testSha256);

    const row = await db.get<{ hash_version: number; entry_hash: string }>(
      'SELECT hash_version, entry_hash FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(row!.hash_version).toBe(1);
    expect(row!.entry_hash).toBe('bogus-hash');
  });

  it('is idempotent', async () => {
    const db = await createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);
    const entry = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });
    const v1Hash = await signing.computeEntryHashForVersion(entry.id, 1);
    await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', [v1Hash, entry.id]);

    await runHashMigration(db, testSha256);
    const firstPass = await db.get<{ hash_version: number; entry_hash: string }>(
      'SELECT hash_version, entry_hash FROM signatures WHERE entry_id = ?', [entry.id],
    );
    await runHashMigration(db, testSha256);
    const secondPass = await db.get<{ hash_version: number; entry_hash: string }>(
      'SELECT hash_version, entry_hash FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(firstPass).toEqual(secondPass);
    expect(firstPass!.hash_version).toBe(2);
  });

  it('leaves v2 signatures alone', async () => {
    const db = await createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);

    const entry = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });

    const before = await db.get<{ entry_hash: string; hash_version: number }>(
      'SELECT entry_hash, hash_version FROM signatures WHERE entry_id = ?', [entry.id],
    );
    await runHashMigration(db, testSha256);
    const after = await db.get<{ entry_hash: string; hash_version: number }>(
      'SELECT entry_hash, hash_version FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(after).toEqual(before);
  });

  it('skips orphan signatures without aborting migration', async () => {
    const db = await createTestClient();
    const entries = createEntriesService(db, testUuid);
    const signing = createSigningService(db, testSha256, testUuid);

    const entry = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: '/sig.png', device_id: 'd-1',
    });
    const v1Hash = await signing.computeEntryHashForVersion(entry.id, 1);
    await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', [v1Hash, entry.id]);

    await db.exec('PRAGMA foreign_keys = OFF');
    await db.run(
      `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, entry_hash, hash_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['orphan-sig', 'nonexistent-entry', 'X', 'Y', '/', '2026-04-01', 'd', 'h', 1, '2026-04-01'],
    );
    await db.exec('PRAGMA foreign_keys = ON');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await runHashMigration(db, testSha256);
    warnSpy.mockRestore();

    const realRow = await db.get<{ hash_version: number }>(
      'SELECT hash_version FROM signatures WHERE entry_id = ?', [entry.id],
    );
    expect(realRow!.hash_version).toBe(2);

    const orphan = await db.get<{ hash_version: number; entry_hash: string }>(
      'SELECT hash_version, entry_hash FROM signatures WHERE id = ?', ['orphan-sig'],
    );
    expect(orphan!.hash_version).toBe(1);
    expect(orphan!.entry_hash).toBe('h');
  });
});
