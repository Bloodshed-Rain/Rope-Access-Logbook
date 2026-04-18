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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { testSha256 } from '../testHash';
import { createEntriesService } from '../../src/services/entriesService';
import { createSigningService } from '../../src/services/signingService';
import { createExportService } from '../../src/services/exportService';
import { createProfileService } from '../../src/services/profileService';
import { createCloudBackupService } from '../../src/services/cloudBackupService';
import { CloudSnapshot } from '../../src/types';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('cloudBackupService.backup — Scenario A', () => {
  it('uploads snapshot.json and referenced assets for a logbook with a signed entry', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;

    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    const exp = createExportService(db);

    await profile.createProfile({
      full_name: 'Tech', sprat_id: 'S1', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'Emp',
    });

    fs.writeStringSync(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      'signature-bytes',
    );

    const entry = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'Emp', site: 'Site', client: 'Cli', description: 'Desc',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');

    await signing.signEntry({
      entry_id: entry.id,
      supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      device_id: 'd-1',
    });

    await cloud.signInWithMagicLink('tech@example.com');

    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256, exportService: exp,
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });

    const result = await svc.backup();

    expect(result.kind).toBe('uploaded');
    const uid = cloud.getCurrentUserId()!;
    expect(cloud.storage.has(`${uid}/snapshot.json`)).toBe(true);

    const snapshotBytes = cloud.storage.get(`${uid}/snapshot.json`)!;
    const snapshot: CloudSnapshot = JSON.parse(new TextDecoder().decode(snapshotBytes));
    expect(snapshot.entries.length).toBe(1);
    expect(snapshot.signatures.length).toBe(1);
    expect(snapshot.photos_included).toBe(false);
    expect(Object.keys(snapshot.binary_manifest)).toHaveLength(1);
    const sigKey = Object.keys(snapshot.binary_manifest)[0];
    expect(sigKey.startsWith('assets/sig_')).toBe(true);
    expect(cloud.storage.has(`${uid}/${sigKey}`)).toBe(true);

    const p = await profile.getProfile();
    expect(p?.last_cloud_backup_at).toBe('2026-04-16T12:00:00.000Z');
    expect(p?.last_uploaded_backup_id).toBe(snapshot.backup_id);
  });

  it('skips silently when no auth session', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    const profile = createProfileService(db, () => 'id-1');
    await profile.createProfile({
      full_name: 'Tech', sprat_id: 'S1', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'Emp',
    });

    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });

    const r = await svc.backup();
    expect(r.kind).toBe('skipped_no_auth');
  });

  it('includes SPRAT card asset when profile has one', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;

    const profile = createProfileService(db, uuid);
    await profile.createProfile({
      full_name: 'Tech', sprat_id: 'S1', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'Emp',
      sprat_card_photo_path: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/cards/sprat_card.jpg',
    });
    fs.writeStringSync(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/cards/sprat_card.jpg',
      'card-bytes',
    );

    await cloud.signInWithMagicLink('tech@example.com');
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('uploaded');
    const uid = cloud.getCurrentUserId()!;
    const keys = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/spratcard_`));
    expect(keys.length).toBe(1);
  });
});

describe('cloudBackupService.backup — deltas and lifecycle', () => {
  it('second backup with an unchanged logbook is throttled', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    fs.writeStringSync(
      'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      'sig',
    );
    const entry = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: entry.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png',
      device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    let nowMs = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => new Date(nowMs).toISOString(),
      appVersion: '1.0.0',
    });

    const r1 = await svc.backup();
    expect(r1.kind).toBe('uploaded');
    nowMs += 5_000;
    const r2 = await svc.backup();
    expect(r2.kind).toBe('throttled');
  });

  it('second backup with a new signed entry uploads only the new asset + snapshot', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    const sigPath1 = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png';
    const sigPath2 = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s2.png';
    fs.writeStringSync(sigPath1, 'sig1');
    fs.writeStringSync(sigPath2, 'sig2');
    const e1 = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: e1.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath1, device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    let nowMs = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => new Date(nowMs).toISOString(),
      appVersion: '1.0.0',
    });

    await svc.backup();
    const uid = cloud.getCurrentUserId()!;
    // Grab the sig_ key that was actually uploaded (depends on uuid counter progression)
    const firstSigKey = Array.from(cloud.storage.keys()).find((k) => k.startsWith(`${uid}/assets/sig_`))!;
    const attemptsBefore = cloud.getUploadAttempts(firstSigKey);

    const e2 = await entries.createEntry({
      date_from: '2026-04-02', date_to: '2026-04-02', employer: 'E', site: 'S', client: 'C', description: 'D2',
      work_hours: 6, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: e2.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath2, device_id: 'd-1',
    });

    nowMs += 60_000;
    await svc.backup();

    // First signature should NOT have been re-uploaded
    expect(cloud.getUploadAttempts(firstSigKey)).toBe(attemptsBefore);
    const sigKeys = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/sig_`));
    expect(sigKeys.length).toBe(2);
  });

  it('orphan cleanup: toggling photos off deletes previously-uploaded photos', async () => {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    await db.run('UPDATE profile SET photos_in_backup = 1');

    const sigPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png';
    const photoPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/p1.jpg';
    fs.writeStringSync(sigPath, 'sig');
    fs.writeStringSync(photoPath, 'photo');
    const e1 = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
      photo_paths: [photoPath],
    }, 'II');
    await signing.signEntry({
      entry_id: e1.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath, device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    let nowMs = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => new Date(nowMs).toISOString(),
      appVersion: '1.0.0',
    });

    await svc.backup();
    const uid = cloud.getCurrentUserId()!;
    const photosUploaded = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/photo_`));
    expect(photosUploaded.length).toBe(1);

    await db.run('UPDATE profile SET photos_in_backup = 0');
    nowMs += 60_000;
    await svc.backup();

    const photosStillThere = Array.from(cloud.storage.keys()).filter((k) => k.startsWith(`${uid}/assets/photo_`));
    expect(photosStillThere.length).toBe(0);
  });
});

describe('cloudBackupService.backup — error handling', () => {
  async function makeFreshState() {
    const db = await createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    let counter = 0;
    const uuid = () => `id-${++counter}`;
    const profile = createProfileService(db, uuid);
    const entries = createEntriesService(db, uuid);
    const signing = createSigningService(db, testSha256, uuid);
    await profile.createProfile({
      full_name: 'T', sprat_id: 'S', level: 'II',
      cert_expires_on: '2027-01-01', default_employer: 'E',
    });
    const sigPath = 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/signatures/s1.png';
    fs.writeStringSync(sigPath, 'sig');
    const e1 = await entries.createEntry({
      date_from: '2026-04-01', date_to: '2026-04-01', employer: 'E', site: 'S', client: 'C', description: 'D',
      work_hours: 8, work_types: ['inspection'],
    }, 'II');
    await signing.signEntry({
      entry_id: e1.id, supervisor_name: 'Sup', supervisor_cert_number: 'L3-X',
      signature_png_path: sigPath, device_id: 'd-1',
    });
    await cloud.signInWithMagicLink('tech@example.com');
    return { db, cloud, fs };
  }

  it('returns quota failure when Storage reports over-quota', async () => {
    const { db, cloud, fs } = await makeFreshState();
    cloud.setQuotaExceeded(true);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.reason).toBe('quota');
  });

  it('retains old snapshot on asset-upload failure — no partial snapshot.json', async () => {
    const { db, cloud, fs } = await makeFreshState();
    cloud.setFailUpload((key, attempt) => key.includes('/assets/sig_') && attempt === 1);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('failed');
    const uid = cloud.getCurrentUserId()!;
    expect(cloud.storage.has(`${uid}/snapshot.json`)).toBe(false);
  });

  it('concurrent triggers coalesce — only one upload happens', async () => {
    const { db, cloud, fs } = await makeFreshState();
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const [r1, r2] = await Promise.all([svc.backup(), svc.backup()]);
    expect(r1.kind).toBe('uploaded');
    expect(r2.kind).toBe('uploaded');
    const uid = cloud.getCurrentUserId()!;
    expect(cloud.getUploadAttempts(`${uid}/snapshot.json`)).toBe(1);
  });

  it('skips silently when offline', async () => {
    const { db, cloud, fs } = await makeFreshState();
    cloud.setOnline(false);
    const svc = createCloudBackupService({
      db, cloud, fs, hash: testSha256,
      exportService: createExportService(db),
      clock: () => '2026-04-16T12:00:00.000Z',
      appVersion: '1.0.0',
    });
    const r = await svc.backup();
    expect(r.kind).toBe('skipped_offline');
  });
});
