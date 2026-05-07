import { createTestClient } from '../setup';
import { createNotificationCenterService } from '../../src/services/notificationCenterService';

describe('notificationCenterService', () => {
  let uuidCounter = 0;
  const testUuid = () => `notif-${++uuidCounter}`;
  beforeEach(() => { uuidCounter = 0; });

  test('record() inserts a notification row', async () => {
    const db = await createTestClient();
    const now = () => '2026-04-30T10:00:00Z';
    const svc = createNotificationCenterService(db, now, testUuid);
    const id = await svc.record({ kind: 'sign_request_received', payload: { requestId: 'r1' } });
    const row = await db.get<any>(`SELECT * FROM notifications WHERE id = ?`, [id]);
    expect(row.kind).toBe('sign_request_received');
    expect(row.read_at).toBeNull();
    expect(JSON.parse(row.payload_json)).toEqual({ requestId: 'r1' });
  });

  test('list() returns rows newest-first, excludes dismissed', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z', testUuid);
    const a = await svc.record({ kind: 'cert_expiry_60d', payload: {} });
    const b = await svc.record({ kind: 'sign_request_signed', payload: {} });
    await svc.dismiss(a);
    const items = await svc.list();
    expect(items.map((i) => i.id)).toEqual([b]);
  });

  test('markAllRead() sets read_at on every unread row', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z', testUuid);
    await svc.record({ kind: 'cert_expiry_60d', payload: {} });
    await svc.record({ kind: 'sign_request_signed', payload: {} });
    await svc.markAllRead();
    const unread = await svc.unreadCount();
    expect(unread).toBe(0);
  });

  test('record() with dedupe key skips duplicates within same day', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z', testUuid);
    const a = await svc.record({ kind: 'backup_stale', payload: {}, dedupeOnDay: true });
    const b = await svc.record({ kind: 'backup_stale', payload: {}, dedupeOnDay: true });
    expect(a).toBe(b);
    const all = await db.getAll(`SELECT id FROM notifications WHERE kind = 'backup_stale'`);
    expect(all).toHaveLength(1);
  });

  test('list() returns rows newest-first when both undismissed', async () => {
    const db = await createTestClient();
    const svcA = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z', testUuid);
    const older = await svcA.record({ kind: 'cert_expiry_60d', payload: {} });
    const svcB = createNotificationCenterService(db, () => '2026-04-30T11:00:00Z', testUuid);
    const newer = await svcB.record({ kind: 'sign_request_signed', payload: {} });
    const items = await svcA.list();
    expect(items.map((i) => i.id)).toEqual([newer, older]);
  });

  test('record() without dedupeOnDay creates separate rows for the same kind', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-04-30T10:00:00Z', testUuid);
    const a = await svc.record({ kind: 'backup_stale', payload: {} });
    const b = await svc.record({ kind: 'backup_stale', payload: {} });
    expect(a).not.toBe(b);
    const all = await db.getAll(`SELECT id FROM notifications WHERE kind = 'backup_stale'`);
    expect(all).toHaveLength(2);
  });

  test('per-gearId dedupe lets multiple items due on the same day each record once', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-05-06T12:00:00.000Z', testUuid);

    const id1 = await svc.record({
      kind: 'gear_inspection_30d',
      payload: { gearId: 'g-1', name: 'Harness A' },
      dedupeOnDay: true,
      dedupeKey: 'g-1',
    });
    const id2 = await svc.record({
      kind: 'gear_inspection_30d',
      payload: { gearId: 'g-2', name: 'Harness B' },
      dedupeOnDay: true,
      dedupeKey: 'g-2',
    });
    // Same gear-1 again on the same day → dedupes to first id.
    const id3 = await svc.record({
      kind: 'gear_inspection_30d',
      payload: { gearId: 'g-1', name: 'Harness A (2nd call)' },
      dedupeOnDay: true,
      dedupeKey: 'g-1',
    });

    expect(id1).not.toBe(id2);
    expect(id3).toBe(id1);
    expect((await svc.list()).length).toBe(2);
  });

  test('different kinds do not collide on dedupeKey', async () => {
    const db = await createTestClient();
    const svc = createNotificationCenterService(db, () => '2026-05-06T12:00:00.000Z', testUuid);
    const a = await svc.record({
      kind: 'gear_inspection_30d', payload: {}, dedupeOnDay: true, dedupeKey: 'g-1',
    });
    const b = await svc.record({
      kind: 'gear_inspection_0d', payload: {}, dedupeOnDay: true, dedupeKey: 'g-1',
    });
    expect(a).not.toBe(b);
  });
});
