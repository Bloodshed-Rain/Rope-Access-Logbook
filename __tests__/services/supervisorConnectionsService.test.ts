import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createSupervisorConnectionsService } from '../../src/services/supervisorConnectionsService';
import { AuthSession } from '../../src/types';

const techSession: AuthSession = { user_id: 'tech-1', email: 'tech@example.com', access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };
const supSession: AuthSession = { user_id: 'sup-1', email: 'sup@example.com', access_token: 't2', refresh_token: 'r2', expires_at: Date.now() + 3600_000 };

async function setup() {
  const db = await createTestClient();
  const cloud = createMockCloudClient({ initialSession: techSession });
  const service = createSupervisorConnectionsService(db, cloud);
  return { db, cloud, service };
}

test('inviteByEmail creates a pending row, caches it, and surfaces via listCached', async () => {
  const { service, cloud } = await setup();
  const row = await service.inviteByEmail('newboss@example.com');
  expect(row.status).toBe('pending');
  expect(row.supervisor_user_id).toBeNull();
  expect(row.invited_email).toBe('newboss@example.com');
  expect(cloud.edgeFunctionCalls).toContainEqual({ name: 'invite-supervisor', body: { email: 'newboss@example.com' } });
  const cached = await service.listCached();
  expect(cached).toHaveLength(1);
  expect(cached[0].id).toBe(row.id);
});

test('sync pulls rows from the cloud into the local cache', async () => {
  const { service, cloud } = await setup();
  cloud.connections.set('remote-1', {
    id: 'remote-1', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-1',
    status: 'accepted', invited_email: 'boss@example.com',
    supervisor_display_name: 'Boss', declined_at: null,
    created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
  });
  await service.sync();
  const cached = await service.listCached();
  expect(cached.map(c => c.id)).toContain('remote-1');
});

test('accept flips status to accepted', async () => {
  const { service, cloud } = await setup();
  cloud.connections.set('c1', {
    id: 'c1', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'pending', invited_email: 'sup@example.com', supervisor_display_name: null,
    declined_at: null, created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
  });
  cloud.setDirectoryEntry({
    user_id: supSession.user_id, display_name: 'Sup Name',
    sprat_cert_number: 'L3-00001', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  cloud.actAs(supSession);
  const row = await service.accept('c1');
  expect(row.status).toBe('accepted');
  expect(row.supervisor_display_name).toBe('Sup Name');
});

test('decline sets declined_at', async () => {
  const { service, cloud } = await setup();
  cloud.connections.set('c2', {
    id: 'c2', tech_user_id: techSession.user_id, supervisor_user_id: supSession.user_id,
    status: 'pending', invited_email: 'sup@example.com', supervisor_display_name: null,
    declined_at: null, created_at: '2026-04-01T00:00:00.000Z', updated_at: '2026-04-01T00:00:00.000Z',
  });
  cloud.actAs(supSession);
  const row = await service.decline('c2');
  expect(row.status).toBe('declined');
  expect(row.declined_at).toBeTruthy();
});

test('search by SPRAT ID returns unmasked cert', async () => {
  const { service, cloud } = await setup();
  cloud.setDirectoryEntry({
    user_id: 'other-sup', display_name: 'Jim Target',
    sprat_cert_number: 'L3-12345', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  const results = await service.search('sprat_id', 'L3-12345');
  expect(results).toHaveLength(1);
  expect(results[0].sprat_cert_number).toBe('L3-12345');
  expect(results[0].sprat_cert_number_is_masked).toBe(false);
});

test('search by name returns masked cert when >= 3 chars prefix', async () => {
  const { service, cloud } = await setup();
  cloud.setDirectoryEntry({
    user_id: 'sup-a', display_name: 'Alicia Ford',
    sprat_cert_number: 'L3-99999', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  const results = await service.search('name', 'ali');
  expect(results).toHaveLength(1);
  expect(results[0].sprat_cert_number_is_masked).toBe(true);
  expect(results[0].sprat_cert_number).toBe('L3-***99');
});

test('search by name returns empty with < 3 chars', async () => {
  const { service, cloud } = await setup();
  cloud.setDirectoryEntry({
    user_id: 'sup-a', display_name: 'Alicia',
    sprat_cert_number: 'L3-99999', visible: true, updated_at: '2026-04-01T00:00:00.000Z',
  });
  expect(await service.search('name', 'al')).toEqual([]);
});

test('cannot reinvite within 30-day cooldown; can after', async () => {
  const { service, cloud } = await setup();
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600_000).toISOString();
  cloud.connections.set('c3', {
    id: 'c3', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-2',
    status: 'declined', invited_email: 'sup2@example.com',
    supervisor_display_name: null, declined_at: tenDaysAgo,
    created_at: tenDaysAgo, updated_at: tenDaysAgo,
  });
  await expect(service.reinvite('c3')).rejects.toThrow('cooldown_active');

  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 3600_000).toISOString();
  cloud.connections.set('c4', {
    id: 'c4', tech_user_id: techSession.user_id, supervisor_user_id: 'sup-3',
    status: 'declined', invited_email: 'sup3@example.com',
    supervisor_display_name: null, declined_at: thirtyOneDaysAgo,
    created_at: thirtyOneDaysAgo, updated_at: thirtyOneDaysAgo,
  });
  const reinvited = await service.reinvite('c4');
  expect(reinvited.status).toBe('pending');
  expect(reinvited.declined_at).toBeNull();
});
