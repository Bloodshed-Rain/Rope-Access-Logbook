// __tests__/services/gearCatalogService.test.ts
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
      clear: async () => { store.clear(); },
    },
  };
});

import { createMockCloudClient } from '../cloudMock';
import {
  createGearCatalogService,
  REFRESH_THROTTLE_MS,
  STALE_AFTER_MS,
} from '../../src/services/gearCatalogService';
import { GearCatalogEntry } from '../../src/types';

function memStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k: string) => map.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const sample: GearCatalogEntry[] = [
  { id: 'c1', manufacturer: 'Petzl', model: 'Avao Bod', category: 'harness' },
  { id: 'c2', manufacturer: 'Beal', model: 'Industrie 11mm', category: 'rope' },
];

describe('gearCatalogService', () => {
  it('fetchAndCache writes the catalog to storage', async () => {
    const cloud = createMockCloudClient();
    cloud.setGearCatalog(sample);
    const storage = memStorage();
    const svc = createGearCatalogService(cloud, storage);

    const items = await svc.fetchAndCache();
    expect(items).toHaveLength(2);
    const raw = await storage.getItem('logbook:gear_catalog');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).items).toHaveLength(2);
  });

  it('getCached returns [] when missing', async () => {
    const cloud = createMockCloudClient();
    const svc = createGearCatalogService(cloud, memStorage());
    expect(await svc.getCached()).toEqual([]);
  });

  it('getCached returns previously written items', async () => {
    const cloud = createMockCloudClient();
    cloud.setGearCatalog(sample);
    const storage = memStorage();
    const svc = createGearCatalogService(cloud, storage);
    await svc.fetchAndCache();
    const items = await svc.getCached();
    expect(items.map((i) => i.model)).toEqual(['Avao Bod', 'Industrie 11mm']);
  });

  it('refreshIfStale skips when cache is fresh', async () => {
    const cloud = createMockCloudClient();
    cloud.setGearCatalog(sample);
    const storage = memStorage();
    const svc = createGearCatalogService(cloud, storage);

    await svc.fetchAndCache();
    cloud.setGearCatalog([
      ...sample,
      { id: 'c3', manufacturer: 'Sterling', model: 'HTP Static', category: 'rope' },
    ]);
    await svc.refreshIfStale(Date.now() + REFRESH_THROTTLE_MS + 1);

    // Cache fresh ⇒ no fetch ⇒ size still 2.
    expect((await svc.getCached()).length).toBe(2);
  });

  it('refreshIfStale fetches when cache is older than STALE_AFTER_MS', async () => {
    const cloud = createMockCloudClient();
    const storage = memStorage();
    const svc = createGearCatalogService(cloud, storage);

    // Seed an old cache directly.
    const oldFetchedAt = Date.now() - STALE_AFTER_MS - 1000;
    await storage.setItem(
      'logbook:gear_catalog',
      JSON.stringify({ items: [], fetched_at: oldFetchedAt }),
    );

    cloud.setGearCatalog(sample);
    await svc.refreshIfStale();

    expect((await svc.getCached()).length).toBe(2);
  });

  it('refreshIfStale honours the 12h consideration throttle within a single instance', async () => {
    const cloud = createMockCloudClient();
    const storage = memStorage();
    const svc = createGearCatalogService(cloud, storage);

    // Seed an old cache so the staleness check would otherwise fire.
    await storage.setItem(
      'logbook:gear_catalog',
      JSON.stringify({ items: [], fetched_at: Date.now() - STALE_AFTER_MS - 1000 }),
    );
    cloud.setGearCatalog(sample);
    await svc.refreshIfStale();
    const afterFirstFetch = (await svc.getCached()).length;
    expect(afterFirstFetch).toBe(2);

    // Bump catalog and call again — within 12h window, refresh must skip.
    cloud.setGearCatalog([...sample, { id: 'c3', manufacturer: 'X', model: 'Y', category: 'other' }]);
    await svc.refreshIfStale(Date.now() + 1000); // < REFRESH_THROTTLE_MS
    expect((await svc.getCached()).length).toBe(2);
  });

  it('refreshIfStale swallows network errors', async () => {
    const cloud = createMockCloudClient();
    cloud.setOnline(false);
    const storage = memStorage();
    const svc = createGearCatalogService(cloud, storage);

    // No cache, offline. Should not throw.
    await expect(svc.refreshIfStale()).resolves.toBeUndefined();
    expect(await svc.getCached()).toEqual([]);
  });
});
