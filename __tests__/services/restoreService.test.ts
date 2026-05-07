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
      id: 'p-1', full_name: 'T', holds_sprat: true, sprat_id: 'S', level: 'II', holds_irata: false, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null, primary_cert: 'sprat',
      cert_expires_on: '2027-01-01', default_employer: 'E',
      sprat_card_photo_path: null, avatar_path: null, last_backup_at: null,
      photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
      supervisor_capability_enabled: false,
      supervisor_cert_number: null,
      supervisor_directory_visible: true,
      subscription_status: 'unknown',
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
        id: 'p-1', full_name: 'Tech', holds_sprat: true, sprat_id: 'S1', level: 'II', holds_irata: false, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null, primary_cert: 'sprat',
        cert_expires_on: '2027-01-01', default_employer: 'Emp',
        sprat_card_photo_path: null, avatar_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        supervisor_capability_enabled: false,
        supervisor_cert_number: null,
        supervisor_directory_visible: true,
        subscription_status: 'unknown',
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [{
        id: 'e-1', date_from: '2026-04-10', date_to: '2026-04-10', employer: 'Emp', site: 'Site', client: 'Cli',
        description: 'Work', work_hours: 8, tech_level_snapshot: 'II', irata_level_snapshot: null,
        work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
        photo_paths: [], status: 'signed', amends_entry_id: null, amendment_reason: null,
        pending_sign_request_id: null,
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
        id: 'p-1', full_name: 'T', holds_sprat: true, sprat_id: 'S', level: 'II', holds_irata: false, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null, primary_cert: 'sprat',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, avatar_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        supervisor_capability_enabled: false,
        supervisor_cert_number: null,
        supervisor_directory_visible: true,
        subscription_status: 'unknown',
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
        id: 'p-1', full_name: 'T', holds_sprat: true, sprat_id: 'S', level: 'II', holds_irata: false, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null, primary_cert: 'sprat',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, avatar_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        supervisor_capability_enabled: false,
        supervisor_cert_number: null,
        supervisor_directory_visible: true,
        subscription_status: 'unknown',
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

  it('photo round-trip: asset lands at entry.photo_paths target so the entry hash still verifies after restore', async () => {
    // Establishes that the storage-key convention `assets/photo_{entryId}_{i}.{ext}`
    // round-trips through restore: the asset bytes end up at exactly the path
    // the entry's photo_paths column references on the restored device.
    // photo_paths is in the canonical hash input, so any divergence between
    // the asset write path and entry.photo_paths would break verifyIntegrity.
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const photoBytes = new TextEncoder().encode('photo-bytes');
    const photoSha = require('crypto').createHash('sha256').update(Buffer.from(photoBytes)).digest('hex');
    const photoStorageKey = 'assets/photo_e-1_0.jpg';
    cloud.storage.set(`${uid}/${photoStorageKey}`, photoBytes);

    const snap: CloudSnapshot = {
      app_version: '1.0.0',
      exported_at: '2026-04-16T12:00:00.000Z',
      profile: {
        id: 'p-1', full_name: 'T', holds_sprat: true, sprat_id: 'S', level: 'II', holds_irata: false, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null, primary_cert: 'sprat',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, avatar_path: null, last_backup_at: null,
        photos_in_backup: true, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        supervisor_capability_enabled: false,
        supervisor_cert_number: null,
        supervisor_directory_visible: true,
        subscription_status: 'unknown',
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [{
        id: 'e-1', date_from: '2026-04-10', date_to: '2026-04-10', employer: 'Emp', site: 'Site', client: 'Cli',
        description: 'Work', work_hours: 8, tech_level_snapshot: 'II', irata_level_snapshot: null,
        work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
        // Relative form after normalizeAppPath of `${documentDirectory}logbook/photos/e-1_0.jpg`
        photo_paths: ['logbook/photos/e-1_0.jpg'],
        status: 'signed', amends_entry_id: null, amendment_reason: null,
        pending_sign_request_id: null,
        created_at: '2026-04-10', updated_at: '2026-04-10',
      }],
      signatures: [],
      schema_version: 1, cloud_schema_version: 1, backup_id: 'b-photo',
      binary_manifest: {
        [photoStorageKey]: { sha256: photoSha, size_bytes: photoBytes.length, created_at: '2026-04-16T12:00:00.000Z' },
      },
      photos_included: true,
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();
    expect(result.kind).toBe('restored');

    const expectedAbsPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/e-1_0.jpg';
    const e = await db.get<{ photo_paths: string }>('SELECT photo_paths FROM entries WHERE id = ?', ['e-1']);
    expect(JSON.parse(e!.photo_paths)).toEqual([expectedAbsPath]);
    // The bytes must exist where the entry says they live, otherwise the
    // signature image would render blank and the hash would not verify.
    expect(fs.files.has(expectedAbsPath)).toBe(true);
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
        id: 'p-1', full_name: 'T', holds_sprat: true, sprat_id: 'S', level: 'II', holds_irata: false, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null, primary_cert: 'sprat',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, avatar_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        supervisor_capability_enabled: false,
        supervisor_cert_number: null,
        supervisor_directory_visible: true,
        subscription_status: 'unknown',
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
        id: 'p-1', full_name: 'T', holds_sprat: true, sprat_id: 'S', level: 'II', holds_irata: false, irata_id: null, irata_level: null, irata_expires_on: null, irata_card_photo_path: null, primary_cert: 'sprat',
        cert_expires_on: '2027-01-01', default_employer: 'E',
        sprat_card_photo_path: null, avatar_path: null, last_backup_at: null,
        photos_in_backup: false, last_cloud_backup_at: null, last_uploaded_backup_id: null,
        supervisor_capability_enabled: false,
        supervisor_cert_number: null,
        supervisor_directory_visible: true,
        subscription_status: 'unknown',
        created_at: '2026-04-01', updated_at: '2026-04-01',
      },
      entries: [{
        id: 'e-legacy', date: '2026-03-05', employer: 'Emp', site: 'Site', client: 'Cli',
        description: 'Legacy work', work_hours: 8, tech_level_snapshot: 'II', irata_level_snapshot: null,
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

  it('accepts cloud_schema_version 3 and refuses 4', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const v3Snap = makeSnapshot({ cloud_schema_version: 3, backup_id: 'b-v3' });
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(v3Snap)));
    const r1 = await createRestoreService({ db, cloud, fs, appVersion: '1.0.0' }).restore();
    expect(r1.kind).toBe('restored');

    const db2 = await createTestClient();
    // cloud_schema_version 4 doesn't exist yet — but a future snapshot at that
    // version landing on a today-vintage client must be refused, not silently
    // dropped or partially applied. The cast bypasses the type union so the
    // test can exercise the fence.
    const v4Snap = { ...makeSnapshot(), cloud_schema_version: 4 as unknown as 3 };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(v4Snap)));
    const r2 = await createRestoreService({ db: db2, cloud, fs, appVersion: '1.0.0' }).restore();
    expect(r2.kind).toBe('version_too_new');
    if (r2.kind === 'version_too_new') expect(r2.which).toBe('cloud');
  });

  it('cloud_schema_version 2 snapshot restores with empty gear tables', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    // Pre-feature snapshot: no gear / gear_inspections fields.
    const legacy = makeSnapshot({ cloud_schema_version: 2, backup_id: 'b-pre-gear' });
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(legacy)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();
    expect(result.kind).toBe('restored');
    const gearCount = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM gear');
    const inspCount = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM gear_inspections');
    expect(gearCount?.n).toBe(0);
    expect(inspCount?.n).toBe(0);
  });

  it('round-trips gear and inspections through cloud_schema_version 3', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const snap: CloudSnapshot = {
      ...makeSnapshot(),
      cloud_schema_version: 3,
      backup_id: 'b-gear-rt',
      gear: [
        {
          id: 'g-1', name: 'My harness', category: 'harness',
          manufacturer: 'Petzl', model: 'Avao Bod',
          serial_number: 'SN1', manufacture_date: '2025-01-01', first_use_date: '2025-02-01',
          retired_at: null, retirement_reason: null,
          inspection_interval_months: 6, next_inspection_due: '2026-08-01',
          photo_path: null, notes: 'demo',
          created_at: '2025-02-01', updated_at: '2025-02-01',
        },
      ],
      gear_inspections: [
        {
          id: 'i-1', gear_id: 'g-1', inspected_on: '2026-02-01',
          result: 'pass', inspector_name: 'Insp', notes: null,
          cert_photo_path: null, created_at: '2026-02-01',
        },
      ],
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    await svc.restore();
    const g = await db.get<{ name: string; category: string }>('SELECT name, category FROM gear WHERE id = ?', ['g-1']);
    expect(g?.name).toBe('My harness');
    expect(g?.category).toBe('harness');
    const insp = await db.get<{ result: string; gear_id: string }>('SELECT result, gear_id FROM gear_inspections WHERE id = ?', ['i-1']);
    expect(insp?.result).toBe('pass');
    expect(insp?.gear_id).toBe('g-1');
  });

  it('gear photo asset round-trips: bytes land at gear.photo_path target', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const uid = cloud.getCurrentUserId()!;

    const photoBytes = new TextEncoder().encode('gear-photo-bytes');
    const photoSha = require('crypto').createHash('sha256').update(Buffer.from(photoBytes)).digest('hex');
    const photoStorageKey = 'assets/gearphoto_g-1.jpg';
    cloud.storage.set(`${uid}/${photoStorageKey}`, photoBytes);

    const snap: CloudSnapshot = {
      ...makeSnapshot(),
      cloud_schema_version: 3,
      backup_id: 'b-gear-photo',
      photos_included: true,
      profile: { ...makeSnapshot().profile, photos_in_backup: true },
      binary_manifest: {
        [photoStorageKey]: { sha256: photoSha, size_bytes: photoBytes.length, created_at: '2026-04-16T12:00:00.000Z' },
      },
      gear: [
        {
          id: 'g-1', name: 'Harness', category: 'harness',
          manufacturer: null, model: null, serial_number: null,
          manufacture_date: null, first_use_date: '2026-01-01',
          retired_at: null, retirement_reason: null,
          inspection_interval_months: 6, next_inspection_due: '2026-07-01',
          // Relative form — what cloudBackupService writes after normalizeAppPath.
          photo_path: 'logbook/photos/gearphoto_g-1.jpg',
          notes: null, created_at: '2026-01-01', updated_at: '2026-01-01',
        },
      ],
      gear_inspections: [],
    };
    cloud.storage.set(`${uid}/snapshot.json`, new TextEncoder().encode(JSON.stringify(snap)));

    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const result = await svc.restore();
    expect(result.kind).toBe('restored');

    const expectedAbs = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/gearphoto_g-1.jpg';
    const row = await db.get<{ photo_path: string }>('SELECT photo_path FROM gear WHERE id = ?', ['g-1']);
    expect(row?.photo_path).toBe(expectedAbs);
    expect(fs.files.has(expectedAbs)).toBe(true);
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
