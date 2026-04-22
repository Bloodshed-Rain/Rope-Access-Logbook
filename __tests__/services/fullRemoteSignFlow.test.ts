import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createMockFs } from '../fsMock';
import { createSupervisorConnectionsService } from '../../src/services/supervisorConnectionsService';
import { createSignRequestsService } from '../../src/services/signRequestsService';
import { createSigningService } from '../../src/services/signingService';
import { testSha256 } from '../testHash';
import { AuthSession } from '../../src/types';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///tmp/test/' }));

const techSession: AuthSession = { user_id: 'tech-1', email: 'tech@x.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };
const supSession: AuthSession = { user_id: 'sup-1', email: 'sup@x.com', access_token: 't2', refresh_token: 'r2', expires_at: Date.now() + 3600_000 };

test('full remote sign flow: invite -> accept -> send -> sign -> tech gets signature', async () => {
  const techDb = await createTestClient();
  const supDb = await createTestClient();
  // Shared mock cloud -- both "devices" talk to the same backend
  const cloud = createMockCloudClient({ initialSession: techSession });
  const fs = createMockFs();

  const techConns = createSupervisorConnectionsService(techDb, cloud);
  const techReqs = createSignRequestsService(techDb, cloud, fs, testSha256);
  const supConns = createSupervisorConnectionsService(supDb, cloud);
  const supReqs = createSignRequestsService(supDb, cloud, fs, testSha256);
  const techSigning = createSigningService(techDb, testSha256);

  // Supervisor: enable directory entry so search finds them
  cloud.actAs(supSession);
  await cloud.upsertSupervisorDirectory({ display_name: 'Sup Name', sprat_cert_number: 'L3-00001', visible: true });

  // Tech: search directory and invite by user_id
  cloud.actAs(techSession);
  const results = await techConns.search('sprat_id', 'L3-00001');
  expect(results).toHaveLength(1);
  const invited = await techConns.inviteByDirectoryResult(results[0], 'sup@x.com');
  expect(invited.status).toBe('pending');

  // Supervisor: sync and accept
  cloud.actAs(supSession);
  await supConns.sync();
  await supConns.accept(invited.id);

  // Tech: sync (to get accepted status), create an entry with photos, send it
  cloud.actAs(techSession);
  await techConns.sync();
  const originalPhotoCount = 2;
  const photoPaths: string[] = [];
  for (let i = 0; i < originalPhotoCount; i++) {
    const p = `file:///tmp/test/logbook/photos/e1_${i}.jpg`;
    fs.files.set(p, new Uint8Array([1, 2, 3, i]));
    photoPaths.push(p);
  }
  await techDb.run(
    `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, work_types, photo_paths, status, created_at, updated_at)
     VALUES ('e1','2026-03-01','2026-03-01','2026-03-01','Acme','Platform','Client','Inspected welds',8,'II','["inspection"]',?,'draft','2026-03-01','2026-03-01')`,
    [JSON.stringify(photoPaths)],
  );
  const req = await techReqs.sendRequest({ entry_id: 'e1', connection_id: invited.id, supervisor_user_id: supSession.user_id });
  expect(req.status).toBe('pending');

  // Supervisor: sync (downloads photos for pending request), sign, then sync again (cleanup)
  cloud.actAs(supSession);
  await supReqs.sync();

  // Assert photos are downloaded to supervisor's cache after pending sync
  const pendingCached = await supDb.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(pendingCached?.local_photo_paths_json).not.toBeNull();
  const localPaths = JSON.parse(pendingCached!.local_photo_paths_json!) as string[];
  expect(localPaths).toHaveLength(originalPhotoCount);
  for (const p of localPaths) {
    expect(p).not.toBe('');
    expect(fs.files.has(p)).toBe(true);
  }

  const tinyPng = Buffer.from([137, 80, 78, 71]).toString('base64');
  await supReqs.sign({
    request_id: req.id, png_base64: tinyPng,
    supervisor_name: 'Sup Name', supervisor_cert_number: 'L3-00001',
    device_id: 'sup-device',
  });

  // Second supervisor sync: triggers cleanup for the now-signed request
  await supReqs.sync();

  // Assert supervisor's photo cache is cleared after signing + cleanup sync
  const afterSigned = await supDb.get<{ local_photo_paths_json: string | null }>(
    'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
  expect(afterSigned?.local_photo_paths_json).toBeNull();
  // On-disk photo files (supervisor's copies) are gone
  for (const p of localPaths) {
    expect(fs.files.has(p)).toBe(false);
  }

  // Tech: sync catches up -> applyIncomingSignature writes local signature row
  cloud.actAs(techSession);
  await techReqs.sync();

  // Verify tech's local DB
  const entryNow = await techDb.get<{ status: string; pending_sign_request_id: string | null }>(
    'SELECT status, pending_sign_request_id FROM entries WHERE id = ?', ['e1']);
  expect(entryNow?.status).toBe('signed');
  expect(entryNow?.pending_sign_request_id).toBeNull();

  const sig = await techSigning.getSignatureForEntry('e1');
  expect(sig).toBeTruthy();
  expect(sig?.supervisor_name).toBe('Sup Name');
  expect(sig?.hash_version).toBe(3);
});
