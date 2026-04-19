// __tests__/services/entriesService.test.ts
import { createTestClient } from '../setup';
import { createEntriesService } from '../../src/services/entriesService';
import { DbClient } from '../../src/db/client';
import { CreateEntryInput } from '../../src/types';

describe('entriesService', () => {
  let db: DbClient;
  let service: ReturnType<typeof createEntriesService>;
  let uuidCounter = 0;
  const testUuid = () => `entry-${++uuidCounter}`;

  const validInput: CreateEntryInput = {
    date_from: '2026-04-15',
    date_to: '2026-04-15',
    employer: 'Acme Rope Co',
    site: 'Bridge Tower A',
    client: 'DOT',
    description: 'Inspected main cables',
    work_hours: 8,
    work_types: ['inspection', 'ndt'],
  };

  beforeEach(async () => {
    db = await createTestClient();
    uuidCounter = 0;
    service = createEntriesService(db, testUuid);
  });

  describe('createEntry', () => {
    it('creates a draft entry with snapshotted tech level', async () => {
      const entry = await service.createEntry(validInput, 'II');
      expect(entry.status).toBe('draft');
      expect(entry.tech_level_snapshot).toBe('II');
      expect(entry.work_types).toEqual(['inspection', 'ndt']);
      expect(entry.id).toBe('entry-1');
    });

    it('stores work_types as JSON string in DB', async () => {
      await service.createEntry(validInput, 'I');
      const row = await db.get<{ work_types: string }>('SELECT work_types FROM entries WHERE id = ?', ['entry-1']);
      expect(row!.work_types).toBe('["inspection","ndt"]');
    });
  });

  describe('getEntry', () => {
    it('returns null for non-existent entry', async () => {
      const entry = await service.getEntry('nope');
      expect(entry).toBeNull();
    });

    it('returns entry with parsed JSON arrays', async () => {
      await service.createEntry(validInput, 'II');
      const entry = await service.getEntry('entry-1');
      expect(entry!.work_types).toEqual(['inspection', 'ndt']);
      expect(entry!.photo_paths).toEqual([]);
    });
  });

  describe('listEntries', () => {
    it('returns entries in reverse chronological order', async () => {
      await service.createEntry({ ...validInput, date_from: '2026-01-01', date_to: '2026-01-01' }, 'II');
      await service.createEntry({ ...validInput, date_from: '2026-06-01', date_to: '2026-06-01' }, 'II');
      await service.createEntry({ ...validInput, date_from: '2026-03-15', date_to: '2026-03-15' }, 'II');
      const entries = await service.listEntries();
      expect(entries.map((e) => e.date_from)).toEqual(['2026-06-01', '2026-03-15', '2026-01-01']);
    });
  });

  describe('updateEntry', () => {
    it('updates a draft entry', async () => {
      await service.createEntry(validInput, 'II');
      const updated = await service.updateEntry('entry-1', { description: 'Updated desc' });
      expect(updated.description).toBe('Updated desc');
    });

    it('throws when updating a signed entry', async () => {
      await service.createEntry(validInput, 'II');
      await db.run("UPDATE entries SET status = 'signed' WHERE id = ?", ['entry-1']);
      await expect(service.updateEntry('entry-1', { description: 'nope' })).rejects.toThrow('Cannot modify a signed entry');
    });

    it('throws when entry has pending_sign_request_id', async () => {
      await service.createEntry(validInput, 'II');
      await db.run('UPDATE entries SET pending_sign_request_id = ? WHERE id = ?', ['req1', 'entry-1']);
      await expect(service.updateEntry('entry-1', { description: 'x' })).rejects.toThrow('entry_locked_pending_request');
    });
  });

  describe('deleteEntry', () => {
    it('deletes a draft entry', async () => {
      await service.createEntry(validInput, 'II');
      await service.deleteEntry('entry-1');
      const entry = await service.getEntry('entry-1');
      expect(entry).toBeNull();
    });

    it('throws when deleting a signed entry', async () => {
      await service.createEntry(validInput, 'II');
      await db.run("UPDATE entries SET status = 'signed' WHERE id = ?", ['entry-1']);
      await expect(service.deleteEntry('entry-1')).rejects.toThrow('Cannot delete a signed entry');
    });

    it('throws when entry has pending_sign_request_id', async () => {
      await service.createEntry(validInput, 'II');
      await db.run('UPDATE entries SET pending_sign_request_id = ? WHERE id = ?', ['req1', 'entry-1']);
      await expect(service.deleteEntry('entry-1')).rejects.toThrow('entry_locked_pending_request');
    });
  });

  describe('createAmendment', () => {
    it('creates a draft amendment referencing the original', async () => {
      await service.createEntry(validInput, 'II');
      await db.run("UPDATE entries SET status = 'signed' WHERE id = ?", ['entry-1']);
      const amendment = await service.createAmendment('entry-1', 'Incorrect hours', 'III');
      expect(amendment.status).toBe('draft');
      expect(amendment.amends_entry_id).toBe('entry-1');
      expect(amendment.amendment_reason).toBe('Incorrect hours');
      expect(amendment.employer).toBe(validInput.employer);
    });

    it('throws when amending a non-signed entry', async () => {
      await service.createEntry(validInput, 'II');
      await expect(service.createAmendment('entry-1', 'reason', 'III')).rejects.toThrow('Can only amend signed entries');
    });
  });

  describe('getTotalWorkHours', () => {
    it('sums work hours for signed entries in a given year', async () => {
      await service.createEntry({ ...validInput, date_from: '2026-03-01', date_to: '2026-03-01', work_hours: 8 }, 'II');
      await service.createEntry({ ...validInput, date_from: '2026-04-01', date_to: '2026-04-01', work_hours: 6 }, 'II');
      await service.createEntry({ ...validInput, date_from: '2025-12-31', date_to: '2025-12-31', work_hours: 10 }, 'II');
      await db.run("UPDATE entries SET status = 'signed'");
      const total = await service.getTotalWorkHours(2026);
      expect(total).toBe(14);
    });

    it('returns 0 when no entries exist', async () => {
      const total = await service.getTotalWorkHours(2026);
      expect(total).toBe(0);
    });
  });

  describe('deletion guards for amendment chains', () => {
    it('allows deleting a draft amendment', async () => {
      await service.createEntry(validInput, 'II');
      await db.run("UPDATE entries SET status = 'signed' WHERE id = ?", ['entry-1']);
      const amendment = await service.createAmendment('entry-1', 'reason', 'III');
      await service.deleteEntry(amendment.id);
      const deleted = await service.getEntry(amendment.id);
      expect(deleted).toBeNull();
    });

    it('throws when deleting original with a signed amendment', async () => {
      await service.createEntry(validInput, 'II');
      await db.run("UPDATE entries SET status = 'signed' WHERE id = ?", ['entry-1']);
      await service.createAmendment('entry-1', 'reason', 'III');
      await db.run("UPDATE entries SET status = 'signed' WHERE id = ?", ['entry-2']);
      await expect(service.deleteEntry('entry-1')).rejects.toThrow('Cannot delete');
    });
  });
});
