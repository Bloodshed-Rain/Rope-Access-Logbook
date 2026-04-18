jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///var/mobile/Containers/Data/Application/ABC123/Documents/',
}));

// __tests__/services/signingService.test.ts
import { createTestClient } from '../setup';
import { testSha256 } from '../testHash';
import { createSigningService } from '../../src/services/signingService';
import { createEntriesService } from '../../src/services/entriesService';
import { DbClient } from '../../src/db/client';
import { CreateEntryInput, Signature } from '../../src/types';

describe('signingService', () => {
  let db: DbClient;
  let signingService: ReturnType<typeof createSigningService>;
  let entriesService: ReturnType<typeof createEntriesService>;
  let uuidCounter = 0;
  const testUuid = () => `id-${++uuidCounter}`;

  const validEntry: CreateEntryInput = {
    date_from: '2026-04-15',
    date_to: '2026-04-15',
    employer: 'Acme',
    site: 'Site A',
    client: 'Client X',
    description: 'Work done',
    work_hours: 8,
    work_types: ['inspection'],
  };

  beforeEach(async () => {
    db = await createTestClient();
    uuidCounter = 0;
    entriesService = createEntriesService(db, testUuid);
    signingService = createSigningService(db, testSha256, testUuid);
  });

  describe('signEntry', () => {
    it('creates a signature and sets entry status to signed', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      const signature = await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Jane Smith',
        supervisor_cert_number: 'L3-99999',
        signature_png_path: '/path/to/sig.png',
        device_id: 'device-abc',
      });
      expect(signature.supervisor_name).toBe('Jane Smith');
      expect(signature.entry_hash).toBeTruthy();
      expect(signature.entry_hash.length).toBe(64);
      const updated = await entriesService.getEntry(entry.id);
      expect(updated!.status).toBe('signed');
    });

    it('stamps new signatures with hash_version 3', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      const sig = await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Jane',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd',
      });
      expect(sig.hash_version).toBe(3);
    });

    it('rejects signing when date_from is missing', async () => {
      const entry = await entriesService.createEntry({}, 'II');
      // createEntry defaults date_from to today; null it out at the row level.
      await db.run('UPDATE entries SET date_from = NULL WHERE id = ?', [entry.id]);
      await expect(
        signingService.signEntry({
          entry_id: entry.id, supervisor_name: 'Jane', supervisor_cert_number: 'L3-X',
          signature_png_path: '/sig.png', device_id: 'd',
        }),
      ).rejects.toThrow('missing_required');
    });

    it('rejects signing when date_to is missing', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      await db.run('UPDATE entries SET date_to = NULL WHERE id = ?', [entry.id]);
      await expect(
        signingService.signEntry({
          entry_id: entry.id, supervisor_name: 'Jane', supervisor_cert_number: 'L3-X',
          signature_png_path: '/sig.png', device_id: 'd',
        }),
      ).rejects.toThrow('missing_required');
    });

    it('rejects signing when work_hours is 0', async () => {
      const entry = await entriesService.createEntry({ ...validEntry, work_hours: 0 }, 'II');
      await expect(
        signingService.signEntry({
          entry_id: entry.id, supervisor_name: 'Jane', supervisor_cert_number: 'L3-X',
          signature_png_path: '/sig.png', device_id: 'd',
        }),
      ).rejects.toThrow('missing_required');
    });

    it('rejects signing when description is blank', async () => {
      const entry = await entriesService.createEntry({ ...validEntry, description: '   ' }, 'II');
      await expect(
        signingService.signEntry({
          entry_id: entry.id, supervisor_name: 'Jane', supervisor_cert_number: 'L3-X',
          signature_png_path: '/sig.png', device_id: 'd',
        }),
      ).rejects.toThrow('missing_required');
    });

    it('accepts signing when only the four required fields are present', async () => {
      const entry = await entriesService.createEntry(
        {
          date_from: '2026-04-15',
          date_to: '2026-04-15',
          description: 'Some work',
          work_hours: 4,
        },
        'II',
      );
      const sig = await signingService.signEntry({
        entry_id: entry.id, supervisor_name: 'Jane', supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png', device_id: 'd',
      });
      expect(sig.hash_version).toBe(3);
    });

    it('throws when signing an already-signed entry', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Jane',
        supervisor_cert_number: 'L3-99999',
        signature_png_path: '/sig.png',
        device_id: 'device-abc',
      });
      await expect(
        signingService.signEntry({
          entry_id: entry.id,
          supervisor_name: 'Jane',
          supervisor_cert_number: 'L3-99999',
          signature_png_path: '/sig2.png',
          device_id: 'device-abc',
        }),
      ).rejects.toThrow('Entry is not in draft status');
    });
  });

  describe('verifyIntegrity', () => {
    it('returns true for an untampered signed entry', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Jane',
        supervisor_cert_number: 'L3-99999',
        signature_png_path: '/sig.png',
        device_id: 'device-abc',
      });
      const result = await signingService.verifyIntegrity(entry.id);
      expect(result.valid).toBe(true);
    });

    it('returns false when entry data has been tampered with', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Jane',
        supervisor_cert_number: 'L3-99999',
        signature_png_path: '/sig.png',
        device_id: 'device-abc',
      });
      await db.run("UPDATE entries SET description = 'TAMPERED' WHERE id = ?", [entry.id]);
      const result = await signingService.verifyIntegrity(entry.id);
      expect(result.valid).toBe(false);
    });
  });

  describe('getSignatureForEntry', () => {
    it('returns null for unsigned entry', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      const sig = await signingService.getSignatureForEntry(entry.id);
      expect(sig).toBeNull();
    });

    it('returns signature after signing', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Jane',
        supervisor_cert_number: 'L3-99999',
        signature_png_path: '/sig.png',
        device_id: 'device-abc',
      });
      const sig = await signingService.getSignatureForEntry(entry.id);
      expect(sig).not.toBeNull();
      expect(sig!.supervisor_name).toBe('Jane');
    });
  });

  describe('hash_version', () => {
    it('new signatures are written with hash_version = 3', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      const sig = await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd-1',
      });
      expect(sig.hash_version).toBe(3);
    });

    it('verifyIntegrity dispatches on stored hash_version', async () => {
      const entry = await entriesService.createEntry({
        ...validEntry,
        photo_paths: ['file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg'],
      }, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd-1',
      });
      const v1Hash = await signingService.computeEntryHashForVersion(entry.id, 1);
      await db.run('UPDATE signatures SET entry_hash = ?, hash_version = 1 WHERE entry_id = ?', [v1Hash, entry.id]);

      const result = await signingService.verifyIntegrity(entry.id);
      expect(result.valid).toBe(true);
      expect(result.hashVersion).toBe(1);
    });

    it('v1 and v2 produce different hashes when a photo path starts with documentDirectory', async () => {
      const entry = await entriesService.createEntry({
        ...validEntry,
        photo_paths: ['file:///var/mobile/Containers/Data/Application/ABC123/Documents/logbook/photos/a.jpg'],
      }, 'II');
      // Sign to create the entry in 'signed' status (required for hash computation)
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd-1',
      });
      const v1Hash = await signingService.computeEntryHashForVersion(entry.id, 1);
      const v2Hash = await signingService.computeEntryHashForVersion(entry.id, 2);
      expect(v1Hash).not.toBe(v2Hash);
    });

    it('computeEntryHashForVersion throws on unknown version', async () => {
      const entry = await entriesService.createEntry(validEntry, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd-1',
      });
      await expect(
        signingService.computeEntryHashForVersion(entry.id, 99),
      ).rejects.toThrow(/Unsupported hash_version/);
    });

    it('v2 and v3 produce different hashes for the same row', async () => {
      const entry = await entriesService.createEntry({
        ...validEntry,
        date_from: '2026-04-15',
        date_to: '2026-04-20',
        other_work_description: 'paint stripping',
      }, 'II');
      await signingService.signEntry({
        entry_id: entry.id,
        supervisor_name: 'Sup',
        supervisor_cert_number: 'L3-X',
        signature_png_path: '/sig.png',
        device_id: 'd-1',
      });
      const v2Hash = await signingService.computeEntryHashForVersion(entry.id, 2);
      const v3Hash = await signingService.computeEntryHashForVersion(entry.id, 3);
      expect(v2Hash).not.toBe(v3Hash);
    });
  });
});
