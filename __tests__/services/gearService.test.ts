// __tests__/services/gearService.test.ts
import { createTestClient } from '../setup';
import { createGearService } from '../../src/services/gearService';
import { DbClient } from '../../src/db/client';

describe('gearService', () => {
  let db: DbClient;
  let service: ReturnType<typeof createGearService>;
  let uuidCounter = 0;
  const testUuid = () => `gear-${++uuidCounter}`;

  // Frozen "now" for deterministic next_inspection_due math.
  const fixedNowIso = '2026-05-06T12:00:00.000Z';
  const today = '2026-05-06';

  beforeEach(async () => {
    db = await createTestClient();
    uuidCounter = 0;
    service = createGearService(db, testUuid, () => fixedNowIso);
  });

  describe('createGear', () => {
    it('computes next_inspection_due from first_use_date when present', async () => {
      const item = await service.createGear({
        category: 'harness',
        manufacturer: 'Petzl',
        model: 'Avao Bod',
        first_use_date: '2026-01-15',
        manufacture_date: '2025-12-01',
        inspection_interval_months: 6,
      });
      expect(item.next_inspection_due).toBe('2026-07-15');
      expect(item.retired_at).toBeNull();
      expect(item.inspection_interval_months).toBe(6);
    });

    it('falls back to manufacture_date when first_use_date is missing', async () => {
      const item = await service.createGear({
        category: 'helmet',
        manufacture_date: '2025-12-01',
        inspection_interval_months: 6,
      });
      expect(item.next_inspection_due).toBe('2026-06-01');
    });

    it('falls back to today when both first_use_date and manufacture_date are missing', async () => {
      const item = await service.createGear({
        category: 'rope',
        inspection_interval_months: 6,
      });
      // today + 6 months
      expect(item.next_inspection_due).toBe('2026-11-06');
    });

    it('defaults inspection_interval_months to 6', async () => {
      const item = await service.createGear({
        category: 'rope',
        first_use_date: '2026-01-01',
      });
      expect(item.inspection_interval_months).toBe(6);
      expect(item.next_inspection_due).toBe('2026-07-01');
    });

    it('uses provided name, or falls back to "{manufacturer} {model}"', async () => {
      const a = await service.createGear({
        category: 'harness',
        manufacturer: 'Petzl',
        model: 'Avao Bod',
      });
      expect(a.name).toBe('Petzl Avao Bod');

      const b = await service.createGear({
        category: 'harness',
        name: 'Workhorse',
        manufacturer: 'Petzl',
        model: 'Avao Bod',
      });
      expect(b.name).toBe('Workhorse');
    });
  });

  describe('listGear', () => {
    it('sorts active items by next_inspection_due ascending, retired items below', async () => {
      const a = await service.createGear({ category: 'rope', first_use_date: '2026-04-01' });   // due 2026-10-01
      const b = await service.createGear({ category: 'rope', first_use_date: '2026-01-01' });   // due 2026-07-01
      const c = await service.createGear({ category: 'rope', first_use_date: '2026-02-01' });   // due 2026-08-01
      await service.retireGear(a.id, 'sold');

      const list = await service.listGear();
      expect(list.map((g) => g.id)).toEqual([b.id, c.id, a.id]);
      expect(list[2].retired_at).not.toBeNull();
    });
  });

  describe('logInspection', () => {
    it('advances next_inspection_due by interval on pass', async () => {
      const item = await service.createGear({
        category: 'harness',
        first_use_date: '2026-01-01',
        inspection_interval_months: 6,
      });
      const insp = await service.logInspection({
        gear_id: item.id,
        inspected_on: '2026-06-15',
        result: 'pass',
        inspector_name: 'Inspector A',
      });
      expect(insp.result).toBe('pass');
      const updated = await service.getGear(item.id);
      expect(updated!.next_inspection_due).toBe('2026-12-15');
      expect(updated!.retired_at).toBeNull();
    });

    it('advances on pass_with_concerns', async () => {
      const item = await service.createGear({
        category: 'rope',
        first_use_date: '2026-01-01',
        inspection_interval_months: 6,
      });
      await service.logInspection({
        gear_id: item.id,
        inspected_on: '2026-05-01',
        result: 'pass_with_concerns',
      });
      const updated = await service.getGear(item.id);
      expect(updated!.next_inspection_due).toBe('2026-11-01');
      expect(updated!.retired_at).toBeNull();
    });

    it('flips item to retired in same transaction on fail', async () => {
      const item = await service.createGear({
        category: 'rope',
        first_use_date: '2026-01-01',
      });
      await service.logInspection({
        gear_id: item.id,
        inspected_on: '2026-05-01',
        result: 'fail',
        notes: 'Cut sheath',
      });
      const updated = await service.getGear(item.id);
      expect(updated!.retired_at).toBe('2026-05-01');
      expect(updated!.retirement_reason).toBe('failed inspection');
      expect(updated!.next_inspection_due).toBeNull();
    });

    it('rolls back BOTH writes if the gear_inspections INSERT fails', async () => {
      const item = await service.createGear({
        category: 'rope',
        first_use_date: '2026-01-01',
      });
      // Pre-seed a PK collision so the INSERT throws inside the BEGIN block.
      uuidCounter = 999; // poison the next testUuid()
      await db.run(
        `INSERT INTO gear_inspections (id, gear_id, inspected_on, result, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['gear-1000', item.id, '2026-04-01', 'pass', fixedNowIso],
      );
      // Reset counter so next call hits 'gear-1000' again — collides on insert.
      uuidCounter = 999;

      await expect(
        service.logInspection({
          gear_id: item.id,
          inspected_on: '2026-05-01',
          result: 'fail',
        }),
      ).rejects.toThrow();

      // Both writes should have rolled back: item is still active, no
      // additional inspection row beyond the pre-seeded one.
      const reread = await service.getGear(item.id);
      expect(reread!.retired_at).toBeNull();
      expect(reread!.next_inspection_due).toBe('2026-07-01');
      const inspections = await db.getAll<{ id: string }>(
        'SELECT id FROM gear_inspections WHERE gear_id = ?',
        [item.id],
      );
      expect(inspections).toHaveLength(1);
      expect(inspections[0].id).toBe('gear-1000');
    });

    it('uses today when inspected_on is omitted', async () => {
      const item = await service.createGear({
        category: 'rope',
        first_use_date: '2026-01-01',
        inspection_interval_months: 6,
      });
      await service.logInspection({ gear_id: item.id, result: 'pass' });
      const updated = await service.getGear(item.id);
      // today (2026-05-06) + 6mo
      expect(updated!.next_inspection_due).toBe('2026-11-06');
    });
  });

  describe('retireGear', () => {
    it('clears next_inspection_due and sets retired_at + reason', async () => {
      const item = await service.createGear({
        category: 'rope',
        first_use_date: '2026-01-01',
      });
      const updated = await service.retireGear(item.id, 'end of service life');
      expect(updated.retired_at).not.toBeNull();
      expect(updated.retirement_reason).toBe('end of service life');
      expect(updated.next_inspection_due).toBeNull();
    });

    it('calls cancelNotifications hook', async () => {
      const cancelled: string[] = [];
      const svc = createGearService(db, testUuid, () => fixedNowIso, {
        cancel: async (id) => {
          cancelled.push(id);
        },
        schedule: async () => {},
      });
      const item = await svc.createGear({ category: 'rope', first_use_date: '2026-01-01' });
      await svc.retireGear(item.id, 'sold');
      expect(cancelled).toContain(item.id);
    });

    it('is idempotent on an already-retired item', async () => {
      const item = await service.createGear({ category: 'rope', first_use_date: '2026-01-01' });
      const a = await service.retireGear(item.id, 'first');
      const b = await service.retireGear(item.id, 'second');
      expect(a.retired_at).toBe(b.retired_at);
      expect(b.retirement_reason).toBe('first');
    });
  });

  describe('deleteGear', () => {
    it('refuses when inspections exist', async () => {
      const item = await service.createGear({ category: 'rope', first_use_date: '2026-01-01' });
      await service.logInspection({ gear_id: item.id, inspected_on: '2026-04-01', result: 'pass' });
      await expect(service.deleteGear(item.id)).rejects.toThrow();
      const reread = await service.getGear(item.id);
      expect(reread).not.toBeNull();
    });

    it('hard-deletes when no inspections exist', async () => {
      const item = await service.createGear({ category: 'rope', first_use_date: '2026-01-01' });
      await service.deleteGear(item.id);
      expect(await service.getGear(item.id)).toBeNull();
    });
  });

  describe('listDue', () => {
    it('returns only active items within window, sorted asc', async () => {
      // Today is 2026-05-06.
      // Active, due in 5 days (in window).
      const soon = await service.createGear({
        category: 'rope',
        first_use_date: '2025-11-11',
        inspection_interval_months: 6,
      });
      // Active, due in 90 days (out of window).
      const later = await service.createGear({
        category: 'rope',
        first_use_date: '2026-02-04',
        inspection_interval_months: 6,
      });
      // Active, overdue (in window — overdue is included).
      const overdue = await service.createGear({
        category: 'rope',
        first_use_date: '2025-09-01',
        inspection_interval_months: 6,
      });
      // Retired — excluded.
      const retiredItem = await service.createGear({
        category: 'rope',
        first_use_date: '2025-11-15',
        inspection_interval_months: 6,
      });
      await service.retireGear(retiredItem.id, 'sold');

      const due = await service.listDue(30);
      expect(due.map((g) => g.id)).toEqual([overdue.id, soon.id]);
      expect(due.find((g) => g.id === later.id)).toBeUndefined();
      expect(due.find((g) => g.id === retiredItem.id)).toBeUndefined();
    });
  });

  describe('updateGear', () => {
    it('refuses on a retired item', async () => {
      const item = await service.createGear({ category: 'rope', first_use_date: '2026-01-01' });
      await service.retireGear(item.id, 'sold');
      await expect(service.updateGear(item.id, { name: 'Renamed' })).rejects.toThrow();
    });

    it('recomputes next_inspection_due when interval changes', async () => {
      const item = await service.createGear({
        category: 'rope',
        first_use_date: '2026-01-01',
        inspection_interval_months: 6,
      });
      const updated = await service.updateGear(item.id, { inspection_interval_months: 12 });
      expect(updated.inspection_interval_months).toBe(12);
      expect(updated.next_inspection_due).toBe('2027-01-01');
    });
  });

  describe('listInspections', () => {
    it('returns inspections newest-first', async () => {
      const item = await service.createGear({ category: 'rope', first_use_date: '2026-01-01' });
      await service.logInspection({ gear_id: item.id, inspected_on: '2026-03-01', result: 'pass' });
      await service.logInspection({ gear_id: item.id, inspected_on: '2026-04-01', result: 'pass_with_concerns' });
      const list = await service.listInspections(item.id);
      expect(list.map((i) => i.inspected_on)).toEqual(['2026-04-01', '2026-03-01']);
    });
  });
});
