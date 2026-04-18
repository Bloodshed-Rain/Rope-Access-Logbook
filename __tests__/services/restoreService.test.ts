jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
    },
  };
});

import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createRestoreService } from '../../src/services/restoreService';
import { CloudSnapshot } from '../../src/types';

function makeSnapshot(overrides: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return {
    app_version: '1.0.0',
    exported_at: '2026-04-16T12:00:00.000Z',
    profile: {
      id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
      sprat_card_photo_path: null, last_backup_at: null,
      photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
      created_at: '2026-04-01', updated_at: '2026-04-01',
    },
    entries: [],
    signatures: [],
    schema_version: 1,
    cloud_schema_version: 1,
    backup_id: 'backup-abc',
    binary_manifest: {},
    photos_included: false,
    ...overrides,
  };
}

describe('restoreService.previewCloudState', () => {
  it('returns has_cloud_data=false when no snapshot exists', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const preview = await svc.previewCloudState();
    expect(preview.has_cloud_data).toBe(false);
  });

  it('returns has_cloud_data=true with counts when a snapshot exists', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;
    const snap = makeSnapshot();
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const preview = await svc.previewCloudState();
    expect(preview.has_cloud_data).toBe(true);
    expect(preview.backup_id).toBe('backup-abc');
  });

  it('throws when not signed in', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    await expect(svc.previewCloudState()).rejects.toThrow(/auth/i);
  });
});

describe('restoreService.restore', () => {
  it('Scenario B: restores profile, entries, signatures, and assets to a fresh device', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const sigBytes = new TextEncoder().encode('signature-data');
    const sigKey = 'assets/sig_sig-1.png';
    cloud.storage.set(`${uid}/${sigKey}`, sigBytes);

    const snap: CloudSnapshot = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'Tech', sprat_id: 'S1', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'Emp',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [{
        id: 'e-1', date_from: '2026-04-10', date_to: '2026-04-10', employer: 'Emp', site: 'Site', client: 'Cli',
        description: 'Work', work_hours: 8, tech_level_snapshot: 'II',
        work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
        photo_paths: [], status: 'signed', amends_entry_id: null, amendment_reason: null,
        created_at: '2026-04-10', updated_at: '2026-04-10',
      }],
      signatures: [{
        id: 'sig-1', entry_id: 'e-1', supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X', signature_png_path: 'logbook/signatures/sig-1.png',
        signed_at: '2026-04-10', device_id: 'd-old',
        gps_lat: null, gps_lon: null, entry_hash: 'irrelevant-for-download',
        hash_version: 2, created_at: '2026-04-10',
      }],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'backup-1',
      binary_manifest: {
        [sigKey]: {
          sha256: require('crypto').createHash('sha256').update(Buffer.from(sigBytes)).digest('hex'),
          size_bytes: sigBytes.length,
          created_at: '2026-04-16T12:00:00.000Z',
        },
      },
      photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();

    expect(result.kind).toBe('restored');
    if (result.kind === 'restored') {
      expect(result.entries).toBe(1);
      expect(result.signatures).toBe(1);
      expect(result.assets).toBe(1);
    }

    const p = await db.get<{ last_uploaded_backup_id: string }>('SELECT last_uploaded_backup_id FROM profile LIMIT 1');
    expect(p?.last_uploaded_backup_id).toBe('backup-1');

    const s = await db.get<{ signature_png_path: string }>('SELECT signature_png_path FROM signatures');
    expect(s?.signature_png_path).toBe(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/sig-1.png',
    );

    expect(fs.files.has('file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/sig-1.png')).toBe(true);
  });

  it('reports asset_failed when a referenced asset is missing in Storage', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const snap: CloudSnapshot = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [],
      signatures: [],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'backup-x',
      binary_manifest: {
        'assets/sig_missing.png': {
          sha256: 'deadbeef',
          size_bytes: 100,
          created_at: '2026-04-16T12:00:00.000Z',
        },
      },
      photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const r = await svc.restore();
    expect(r.kind).toBe('restored');
    if (r.kind === 'restored') {
      expect(r.assets_failed).toContain('assets/sig_missing.png');
    }
  });

  it('quarantines an asset with sha256 mismatch', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const bytes = new TextEncoder().encode('actual-bytes');
    const wrongSha = 'ff'.repeat(32);
    cloud.storage.set(`${uid}/assets/sig_bad.png`, bytes);

    const snap: CloudSnapshot = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [],
      signatures: [],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'backup-y',
      binary_manifest: {
        'assets/sig_bad.png': { sha256: wrongSha, size_bytes: bytes.length, created_at: '2026-04-16T12:00:00.000Z' },
      },
      photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const r = await svc.restore();
    expect(r.kind).toBe('restored');
    if (r.kind === 'restored') expect(r.assets_failed).toContain('assets/sig_bad.png');
    expect(fs.files.has('file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/bad.png')).toBe(false);
  });

  it('refuses restore when cloud_schema_version is newer than app supports', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;
    const snap: CloudSnapshot = {
      app_version: '99.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [], signatures: [], schema_version: 1,
      cloud_schema_version: 99 as 1, backup_id: 'b', binary_manifest: {}, photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();
    expect(result.kind).toBe('version_too_new');
  });
});

describe('restoreService — v1 snapshot back-compat', () => {
  it('backfills date_from / date_to from legacy `date` when importing a v1 snapshot', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    // Construct a v1-shaped snapshot: entries carry `date`, no date_from/date_to/other_work_description.
    const legacySnap = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', sprat_id: 'S', level: 'II',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [{
        id: 'e-legacy', date: '2026-03-05', employer: 'Emp', site: 'Site', client: 'Cli',
        description: 'Legacy work', work_hours: 8, tech_level_snapshot: 'II',
        work_types: ['inspection'],
        equipment_notes: null, weather: null, photo_paths: [],
        status: 'signed', amends_entry_id: null, amendment_reason: null,
        created_at: '2026-03-05', updated_at: '2026-03-05',
      }],
      signatures: [],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'backup-legacy',
      binary_manifest: {},
      photos_included: false,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(legacySnap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();
    expect(result.kind).toBe('restored');

    const row = await db.get<{ date_from: string; date_to: string; other_work_description: string | null }>(
      'SELECT date_from, date_to, other_work_description FROM entries WHERE id = ?',
      ['e-legacy'],
    );
    expect(row?.date_from).toBe('2026-03-05');
    expect(row?.date_to).toBe('2026-03-05');
    expect(row?.other_work_description).toBeNull();
  });

  it('accepts cloud_schema_version 2 and refuses 3', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const v2Snap = makeSnapshot({ cloud_schema_version: 2, backup_id: 'b-v2' });
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(v2Snap)));
    const r1 = await createRestoreService({ db, cloud, fs, appVersion: '1.0.0' }).restore();
    expect(r1.kind).toBe('restored');

    const db2 = await createTestClient();
    const v3Snap = { ...makeSnapshot(), cloud_schema_version: 3 };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(v3Snap)));
    const r2 = await createRestoreService({ db: db2, cloud, fs, appVersion: '1.0.0' }).restore();
    expect(r2.kind).toBe('version_too_new');
    if (r2.kind === 'version_too_new') expect(r2.which).toBe('cloud');
  });
});

describe('restoreService.uploadCurrentAsCloud', () => {
  it('overwrites cloud snapshot and wipes orphan assets', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode('{"old":true}'));
    cloud.storage.set(`${uid}/assets/sig_old.png`, new Uint8Array([1, 2]));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    await svc.uploadCurrentAsCloud();
    expect(cloud.storage.has(`${uid}/assets/sig_old.png`)).toBe(false);
  });
});
