import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createSignRequestsService } from '../../src/services/signRequestsService';
import { testSha256 } from '../testHash';
import { AuthSession, Entry, SignRequest } from '../../src/types';
import { DbClient } from '../../src/db/client';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///tmp/test/' }));

const techSession: AuthSession = { user_id: 'tech-1', email: 'tech@example.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };
const supSession: AuthSession = { user_id: 'sup-1', email: 'sup@example.com', access_token: 't2', refresh_token: 'r2', expires_at: Date.now() + 3600_000 };

async function setup() {
  const db = await createTestClient();
  const cloud = createMockCloudClient({ initialSession: techSession });
  const fs = createMockFs();
  let uuidCounter = 0;
  const testUuid = () => `uuid-${++uuidCounter}`;
  const service = createSignRequestsService(db, cloud, fs, testSha256, undefined, testUuid);
  return { db, cloud, fs, service };
}

async function seedDraftEntry(db: DbClient, id = 'e1') {
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES (?, '2026-03-01','2026-03-01','2026-03-01','Acme','Platform A','BigCo','Rope access inspection',8,'II','["inspection"]','[]','draft','2026-03-01','2026-03-01')`,
    [id],
  );
}

async function seedAcceptedConnection(cloud: ReturnType<typeof createMockCloudClient>, id = 'c1') {
  cloud.connections.set(id, {
    id, tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'accepted', invited_email: 'sup@example.com', supervisor_display_name: 'Sup',
    declined_at: null, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  });
}

// ===== Task 22: sendRequest =====

test('sendRequest uploads photos, inserts row, locks entry', async () => {
  const { service, cloud, db } = await setup();
  await seedDraftEntry(db);
  await seedAcceptedConnection(cloud);

  const req = await service.sendRequest({ entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id });
  expect(req.status).toBe('pending');

  const locked = await db.get<{ pending_sign_request_id: string }>(
    'SELECT pending_sign_request_id FROM entries WHERE id = ?', ['e1']);
  expect(locked?.pending_sign_request_id).toBe(req.id);

  const cached = await service.listCached();
  expect(cached).toHaveLength(1);
});

test('sendRequest rejects when connection is not accepted', async () => {
  const { service, cloud, db } = await setup();
  await seedDraftEntry(db);
  cloud.connections.set('c2', {
    id: 'c2', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'pending', invited_email: 'x', supervisor_display_name: null,
    declined_at: null, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  });
  await expect(
    service.sendRequest({ entry_id: 'e1', connection_id: 'c2', supervisor_user_id: supSession.user_id }),
  ).rejects.toThrow('connection_not_accepted');
});

test('sendRequest rejects on incomplete draft', async () => {
  const { service, cloud, db } = await setup();
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES ('e2', '2026-03-01','2026-03-01','2026-03-01','Acme','Site','','', 0, 'II', '[]', '[]', 'draft','2026-03-01','2026-03-01')`,
  );
  await seedAcceptedConnection(cloud);
  await expect(
    service.sendRequest({ entry_id: 'e2', connection_id: 'c1', supervisor_user_id: supSession.user_id }),
  ).rejects.toThrow('missing_required');
});

// ===== Task 23: withdraw, decline, sign =====

test('withdraw unlocks the entry', async () => {
  const { service, cloud, db } = await setup();
  await seedDraftEntry(db);
  await seedAcceptedConnection(cloud);
  const req = await service.sendRequest({ entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id });

  const row = await service.withdraw(req.id);
  expect(row.status).toBe('withdrawn');
  const unlocked = await db.get<{ pending_sign_request_id: string | null }>(
    'SELECT pending_sign_request_id FROM entries WHERE id = ?', ['e1']);
  expect(unlocked?.pending_sign_request_id).toBeNull();
});

test('decline stores reason and transitions to declined', async () => {
  const { service, cloud } = await setup();
  // Seed a request directly on the mock server, act as supervisor
  const entry: Entry = {
    id: 'e1', date_from: '2026-03-01', date_to: '2026-03-01', employer: 'Acme', site: 'Site',
    client: 'Client', description: 'Desc', work_hours: 8, tech_level_snapshot: 'II',
    work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
    photo_paths: [], status: 'draft', amends_entry_id: null, amendment_reason: null,
    pending_sign_request_id: 'r1',
    created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  };
  cloud.requests.set('r1', {
    id: 'r1', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    connection_id: 'c1', entry_payload: entry, assets_manifest: {},
    status: 'pending', decline_reason: null, signature_png_path: null,
    supervisor_name_snapshot: null, supervisor_cert_number_snapshot: null,
    entry_hash: null, hash_version: null, signed_device_id: null,
    signed_gps_lat: null, signed_gps_lon: null,
    created_at: '2026-03-01T00:00:00.000Z', expires_at: '2026-05-01T00:00:00.000Z',
    signed_at: null, updated_at: '2026-03-01T00:00:00.000Z',
  });
  cloud.actAs(supSession);
  const row = await service.decline('r1', "Hours don't match timesheet");
  expect(row.status).toBe('declined');
  expect(row.decline_reason).toBe("Hours don't match timesheet");
});

test('sign uploads PNG, transitions row to signed with v3 hash', async () => {
  const { service, cloud, db } = await setup();
  const entry: Entry = {
    id: 'e1', date_from: '2026-03-01', date_to: '2026-03-01', employer: 'Acme', site: 'Site',
    client: 'Client', description: 'Desc', work_hours: 8, tech_level_snapshot: 'II',
    work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
    photo_paths: [], status: 'draft', amends_entry_id: null, amendment_reason: null,
    pending_sign_request_id: 'r2',
    created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  };
  const reqRow: SignRequest = {
    id: 'r2', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    connection_id: 'c1', entry_payload: entry, assets_manifest: {},
    status: 'pending', decline_reason: null, signature_png_path: null,
    supervisor_name_snapshot: null, supervisor_cert_number_snapshot: null,
    entry_hash: null, hash_version: null, signed_device_id: null,
    signed_gps_lat: null, signed_gps_lon: null,
    created_at: '2026-03-01T00:00:00.000Z', expires_at: '2026-05-01T00:00:00.000Z',
    signed_at: null, updated_at: '2026-03-01T00:00:00.000Z',
  };
  cloud.requests.set('r2', reqRow);
  // Populate the supervisor's cache (simulates a prior sync)
  await db.run(
    `INSERT INTO sign_requests_cache (id, tech_user_id, supervisor_user_id, entry_id, status, decline_reason, signed_at, created_at, expires_at, updated_at, payload_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ['r2', techSession.user_id, supSession.user_id, entry.id, 'pending', null, null,
     reqRow.created_at, reqRow.expires_at, reqRow.updated_at, JSON.stringify(reqRow)],
  );

  cloud.actAs(supSession);
  const tinyPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  const result = await service.sign({
    request_id: 'r2', png_base64: tinyPng,
    supervisor_name: 'Sup Name', supervisor_cert_number: 'L3-00001',
    device_id: 'mock-device',
  });
  expect(result.status).toBe('signed');
  expect(result.entry_hash).toBeTruthy();
  expect(result.hash_version).toBe(3);
  expect(result.supervisor_name_snapshot).toBe('Sup Name');
});
