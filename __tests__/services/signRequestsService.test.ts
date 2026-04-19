import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createSignRequestsService, getLocalPhotoPathsFromCache } from '../../src/services/signRequestsService';
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

// ===== Task: downloadRequestPhotos =====

function makeSupervisorService(techCloud: ReturnType<typeof createMockCloudClient>, db: DbClient, fs: ReturnType<typeof createMockFs>) {
  // Switch the session on the same cloud instance so the closure-captured storage
  // and requests Maps remain shared between the tech and supervisor calls.
  // Creating a second CloudClient and overwriting its `.storage` property doesn't
  // work because downloadSignRequestAsset captures `storage` by closure, not via
  // `this.storage`, so the assignment is a no-op on the function's behavior.
  techCloud.actAs(supSession);
  let uuidCounter = 1000;
  const testUuid = () => `sup-uuid-${++uuidCounter}`;
  return createSignRequestsService(db, techCloud, fs, testSha256, undefined, testUuid);
}

async function seedEntryWithPhotos(db: DbClient, fs: ReturnType<typeof createMockFs>, photoCount: number) {
  const paths: string[] = [];
  for (let i = 0; i < photoCount; i++) {
    const p = `file:///tmp/test/logbook/photos/e1_${i}.jpg`;
    const bytes = new Uint8Array([1, 2, 3, i]);
    fs.files.set(p, bytes);
    paths.push(p);
  }
  await db.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES ('e1','2026-03-01','2026-03-01','2026-03-01','Acme','Site','Client','Desc',8,'II','["inspection"]',?,'draft','2026-03-01','2026-03-01')`,
    [JSON.stringify(paths)],
  );
}

test('downloadRequestPhotos writes all photos locally and persists paths', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 3);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(req);

  expect(result.failed).toEqual([]);
  expect(result.localPaths).toHaveLength(3);
  for (const p of result.localPaths) {
    expect(p).toMatch(new RegExp(`/logbook/signrequest_photos/${req.id}/photo_e1_\\d+\\.jpg$`));
    expect(fs.files.has(p)).toBe(true);
  }

  const cached = await db.get<{ local_photo_paths_json: string }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(JSON.parse(cached!.local_photo_paths_json)).toEqual(result.localPaths);
});

test('downloadRequestPhotos is idempotent — second call skips cloud for already-cached photos', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);

  const first = await supService.downloadRequestPhotos(req);
  expect(first.failed).toEqual([]);

  // Remove cloud-side photo bytes after the first pass. If the idempotency
  // branch (local file + matching sha => skip) is working, the second call
  // serves from disk and never touches the cloud. If it were broken, the
  // second call would try to re-download the (now-missing) keys and fail.
  const storage = (techCloud as any).storage as Map<string, Uint8Array>;
  const photoKeys = [...storage.keys()].filter(k => /\/photo_e1_\d+\.jpg$/.test(k));
  expect(photoKeys.length).toBe(2);
  for (const k of photoKeys) storage.delete(k);

  const second = await supService.downloadRequestPhotos(req);
  expect(second.failed).toEqual([]);
  expect(second.localPaths).toEqual(first.localPaths);
});

test('downloadRequestPhotos quarantines photos with sha256 mismatch', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // Corrupt the manifest sha256 for index 1 so the downloaded bytes don't match.
  const corrupt = { ...req, assets_manifest: { ...req.assets_manifest } } as SignRequest;
  const keys = Object.keys(corrupt.assets_manifest);
  const badKey = keys.find(k => k.endsWith('_1.jpg'))!;
  (corrupt.assets_manifest as any)[badKey] = {
    ...(corrupt.assets_manifest as any)[badKey],
    sha256: 'deadbeef'.repeat(8),
  };

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(corrupt);

  expect(result.failed).toEqual([1]);
  expect(result.localPaths[0]).not.toBe('');
  expect(result.localPaths[1]).toBe('');

  // Quarantined file must not linger on disk.
  for (const [path, _] of fs.files.entries()) {
    if (path.includes(`/signrequest_photos/${req.id}/`) && path.endsWith('_1.jpg')) {
      throw new Error(`Expected quarantined file to be deleted: ${path}`);
    }
  }
});

test('downloadRequestPhotos handles download failure per-index without rethrowing', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // Delete one key from the mock storage to force a download failure.
  const storage = (techCloud as any).storage as Map<string, Uint8Array>;
  const doomed = [...storage.keys()].find(k => k.endsWith('_0.jpg'))!;
  storage.delete(doomed);

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(req);

  expect(result.failed).toEqual([0]);
  expect(result.localPaths[0]).toBe('');
  expect(result.localPaths[1]).not.toBe('');
});

// ===== Task 4: cleanupRequestPhotos =====

test('cleanupRequestPhotos deletes cached files and nulls the column', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);
  const dl = await supService.downloadRequestPhotos(req);

  // Pre-condition: files exist, column is set.
  for (const p of dl.localPaths) expect(fs.files.has(p)).toBe(true);
  const pre = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(pre?.local_photo_paths_json).not.toBeNull();

  await supService.cleanupRequestPhotos(req);

  // Post-condition: files gone, column is null.
  for (const p of dl.localPaths) expect(fs.files.has(p)).toBe(false);
  const post = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(post?.local_photo_paths_json).toBeNull();
});

test('cleanupRequestPhotos is a no-op when nothing was downloaded', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 1);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);

  // sendRequest already cached the row (via cacheRow); the column is NULL
  // and no photos have been downloaded. cleanup must not throw AND must
  // not produce any observable state change.
  const filesBefore = fs.files.size;
  await expect(supService.cleanupRequestPhotos(req)).resolves.toBeUndefined();

  const post = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(post?.local_photo_paths_json).toBeNull();

  const photoFiles = [...fs.files.keys()].filter(k =>
    k.includes(`/signrequest_photos/${req.id}/`));
  expect(photoFiles).toHaveLength(0);
  expect(fs.files.size).toBe(filesBefore);
});

test('downloadRequestPhotos aligns output to entry.photo_paths length even when manifest has gaps', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 3);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // Drop the middle manifest entry to simulate a gap.
  const trimmed = { ...req, assets_manifest: { ...req.assets_manifest } } as SignRequest;
  const midKey = Object.keys(trimmed.assets_manifest).find(k => k.endsWith('_1.jpg'))!;
  delete (trimmed.assets_manifest as any)[midKey];

  const supService = makeSupervisorService(techCloud, db, fs);
  const result = await supService.downloadRequestPhotos(trimmed);

  expect(result.localPaths).toHaveLength(3);
  expect(result.localPaths[0]).not.toBe('');
  expect(result.localPaths[1]).toBe('');
  expect(result.localPaths[2]).not.toBe('');
});

// ===== Task 6: sync extensions =====

test('sync downloads photos for new supervisor-side pending rows', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  const supService = makeSupervisorService(techCloud, db, fs);
  // The supervisor's local cache starts empty.
  await db.run('DELETE FROM sign_requests_cache');

  await supService.sync();

  const cached = await db.get<{ local_photo_paths_json: string }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  const paths = JSON.parse(cached!.local_photo_paths_json) as string[];
  expect(paths).toHaveLength(2);
  for (const p of paths) expect(fs.files.has(p)).toBe(true);
});

test('sync calls cleanupRequestPhotos when a supervisor-side row hits a terminal state', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 1);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });
  const supService = makeSupervisorService(techCloud, db, fs);
  await supService.sync(); // downloads photos

  const before = await db.get<{ local_photo_paths_json: string }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  const beforePaths = JSON.parse(before!.local_photo_paths_json) as string[];
  expect(beforePaths.every(p => fs.files.has(p))).toBe(true);

  // Tech withdraws the request.
  techCloud.actAs(techSession);
  await techService.withdraw(req.id);
  techCloud.actAs(supSession);

  await supService.sync();

  const after = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(after?.local_photo_paths_json).toBeNull();
  for (const p of beforePaths) expect(fs.files.has(p)).toBe(false);
});

test('sync top-up pass downloads photos for pre-existing supervisor pending rows with null column', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  const supService = makeSupervisorService(techCloud, db, fs);
  await supService.sync(); // populates cache + downloads

  // Simulate a pre-existing row whose photos were never downloaded
  // (e.g., cached before this feature shipped).
  await db.run(
    'UPDATE sign_requests_cache SET local_photo_paths_json = NULL WHERE id = ?', [req.id]);
  // Also remove the on-disk files, since we're simulating they never existed.
  const paths = [...fs.files.keys()].filter(k => k.includes(`/signrequest_photos/${req.id}/`));
  for (const p of paths) fs.files.delete(p);

  await supService.sync();

  const cached = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(cached?.local_photo_paths_json).not.toBeNull();
});

test('sync does not download photos for tech-side pending rows', async () => {
  const { service: techService, cloud: techCloud, db, fs } = await setup();
  await seedEntryWithPhotos(db, fs, 2);
  await seedAcceptedConnection(techCloud);
  const req = await techService.sendRequest({
    entry_id: 'e1', connection_id: 'c1', supervisor_user_id: supSession.user_id,
  });

  // The tech is syncing their own outgoing request. They should NOT get
  // a supervisor-side cache of the photos (they already have the originals).
  await techService.sync();

  const cached = await db.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(cached?.local_photo_paths_json).toBeNull();
});

// ===== Task 5: getLocalPhotoPathsFromCache =====

describe('getLocalPhotoPathsFromCache', () => {
  test('returns pending when column is null', () => {
    const result = getLocalPhotoPathsFromCache({ local_photo_paths_json: null });
    expect(result).toEqual({ paths: [], missingCount: 0, pending: true });
  });

  test('parses paths and counts empty slots', () => {
    const json = JSON.stringify([
      '/abs/a.jpg',
      '',
      '/abs/c.jpg',
    ]);
    const result = getLocalPhotoPathsFromCache({ local_photo_paths_json: json });
    expect(result).toEqual({
      paths: ['/abs/a.jpg', '', '/abs/c.jpg'],
      missingCount: 1,
      pending: false,
    });
  });

  test('handles empty array', () => {
    const result = getLocalPhotoPathsFromCache({ local_photo_paths_json: '[]' });
    expect(result).toEqual({ paths: [], missingCount: 0, pending: false });
  });
});
