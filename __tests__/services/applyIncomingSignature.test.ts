import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createSignRequestsService } from '../../src/services/signRequestsService';
import { testSha256 } from '../testHash';
import { AuthSession, SignRequest, Entry } from '../../src/types';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///tmp/test/' }));

const techSession: AuthSession = { user_id: 'tech-1', email: 't@e.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };

async function setup() {
  const db = await createTestClient();
  const cloud = createMockCloudClient({ initialSession: techSession });
  const fs = createMockFs();
  let uuidCounter = 0;
  const testUuid = () => `uuid-${++uuidCounter}`;
  const service = createSignRequestsService(db, cloud, fs, testSha256, undefined, testUuid);
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, pending_sign_request_id, created_at, updated_at)
     VALUES ('e1','2026-03-01','2026-03-01','2026-03-01','Acme','Site','Client','Desc', 8, 'II', '["inspection"]', '[]', 'draft', 'r1', '2026-03-01', '2026-03-01')`,
  );
  return { db, cloud, fs, service };
}

function signedRequest(path: string | null = 'sign-requests/r1/sig.png'): SignRequest {
  const entry: Entry = {
    id: 'e1', date_from: '2026-03-01', date_to: '2026-03-01', employer: 'Acme', site: 'Site',
    client: 'Client', description: 'Desc', work_hours: 8, tech_level_snapshot: 'II', irata_level_snapshot: null,
    work_types: ['inspection'], other_work_description: null, equipment_notes: null, weather: null,
    photo_paths: [], status: 'draft', amends_entry_id: null, amendment_reason: null,
    pending_sign_request_id: 'r1',
    created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z',
  };
  return {
    id: 'r1', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-1',
    connection_id: 'c1', entry_payload: entry, assets_manifest: {},
    status: 'signed', decline_reason: null, signature_png_path: path,
    supervisor_name_snapshot: 'Sup', supervisor_cert_number_snapshot: 'L3-00001',
    entry_hash: 'abc', hash_version: 3, signed_device_id: 'dev',
    signed_gps_lat: null, signed_gps_lon: null,
    created_at: '2026-03-01T00:00:00.000Z', expires_at: '2026-05-01T00:00:00.000Z',
    signed_at: '2026-03-02T00:00:00.000Z', updated_at: '2026-03-02T00:00:00.000Z',
  };
}

test('applyIncomingSignature inserts signature, flips entry to signed, clears lock', async () => {
  const { service, cloud, db } = await setup();
  await cloud.uploadObject('sign-requests/r1/sig.png', new Uint8Array([137, 80, 78, 71]));
  const row = signedRequest();
  const sig = await service.applyIncomingSignature(row);
  expect(sig.supervisor_name).toBe('Sup');
  const entryNow = await db.get<{ status: string; pending_sign_request_id: string | null }>(
    'SELECT status, pending_sign_request_id FROM entries WHERE id = ?', ['e1']);
  expect(entryNow?.status).toBe('signed');
  expect(entryNow?.pending_sign_request_id).toBeNull();
});

test('applyIncomingSignature is idempotent', async () => {
  const { service, cloud, db } = await setup();
  await cloud.uploadObject('sign-requests/r1/sig.png', new Uint8Array([137]));
  const row = signedRequest();
  await service.applyIncomingSignature(row);
  await service.applyIncomingSignature(row);
  const sigs = await db.getAll('SELECT id FROM signatures WHERE entry_id = ?', ['e1']);
  expect(sigs).toHaveLength(1);
});

test('applyIncomingSignature quarantines missing PNG but still creates signature row', async () => {
  const { service, db } = await setup();
  // Do NOT upload the PNG; signature_png_path points to missing key
  const row = signedRequest();
  await service.applyIncomingSignature(row);
  const sig = await db.get<{ signature_png_path: string }>(
    'SELECT signature_png_path FROM signatures WHERE entry_id = ?', ['e1']);
  expect(sig?.signature_png_path).toBe('');
});
