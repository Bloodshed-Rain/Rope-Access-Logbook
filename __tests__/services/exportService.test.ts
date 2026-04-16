// __tests__/services/exportService.test.ts
import { createTestClient } from '../setup';
import { testSha256 } from '../testHash';
import { createExportService } from '../../src/services/exportService';
import { createProfileService } from '../../src/services/profileService';
import { createEntriesService } from '../../src/services/entriesService';
import { createSigningService } from '../../src/services/signingService';
import { DbClient } from '../../src/db/client';

describe('exportService', () => {
  let db: DbClient;
  let uuidCounter = 0;
  const testUuid = () => `id-${++uuidCounter}`;

  beforeEach(() => {
    db = createTestClient();
    uuidCounter = 0;
  });

  describe('exportAsJson', () => {
    it('exports profile, entries, and signatures as a JsonBackup', async () => {
      const profileService = createProfileService(db, testUuid);
      const entriesService = createEntriesService(db, testUuid);
      const signingService = createSigningService(db, testSha256, testUuid);
      const exportService = createExportService(db);

      await profileService.createProfile({
        full_name: 'John',
        sprat_id: 'SP-1',
        level: 'II',
        cert_expires_on: '2027-01-01',
        default_employer: 'Acme',
      });

      const entry = await entriesService.createEntry({
        date: '2026-04-15',
        employer: 'Acme',
        site: 'Site A',
        client: 'Client X',
        description: 'Work',
        work_hours: 8,
        work_types: ['inspection'],
      }, 'II');

      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Jane',
        supervisor_cert_number: 'L3-999',
        signature_png_path: '/sig.png',
        device_id: 'dev-1',
      });

      const backup = await exportService.exportAsJson('1.0.0');

      expect(backup.app_version).toBe('1.0.0');
      expect(backup.schema_version).toBe(1);
      expect(backup.profile.full_name).toBe('John');
      expect(backup.entries).toHaveLength(1);
      expect(backup.entries[0].work_types).toEqual(['inspection']);
      expect(backup.signatures).toHaveLength(1);
      expect(backup.exported_at).toBeTruthy();
    });

    it('throws when no profile exists', async () => {
      const exportService = createExportService(db);
      await expect(exportService.exportAsJson('1.0.0')).rejects.toThrow('No profile found');
    });
  });
});
