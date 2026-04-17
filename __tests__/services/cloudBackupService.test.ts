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
import { testSha256 } from '../testHash';
import { createEntriesService } from '../../src/services/entriesService';
import { createSigningService } from '../../src/services/signingService';
import { createExportService } from '../../src/services/exportService';
import { createProfileService } from '../../src/services/profileService';
import { createCloudBackupService } from '../../src/services/cloudBackupService';
import { CloudSnapshot } from '../../src/types';

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
      date: '2026-04-01', employer: 'Emp', site: 'Site', client: 'Cli', description: 'Desc',
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
