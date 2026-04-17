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
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    await cloud.signInWithMagicLink('tech@example.com');
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    const preview = await svc.previewCloudState();
    expect(preview.has_cloud_data).toBe(false);
  });

  it('returns has_cloud_data=true with counts when a snapshot exists', async () => {
    const db = createTestClient();
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
    const db = createTestClient();
    const cloud = createMockCloudClient();
    const fs = createMockFs();
    const svc = createRestoreService({ db, cloud, fs, appVersion: '1.0.0' });
    await expect(svc.previewCloudState()).rejects.toThrow(/auth/i);
  });
});
