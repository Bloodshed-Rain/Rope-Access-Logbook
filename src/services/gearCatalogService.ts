// src/services/gearCatalogService.ts
//
// Cached read-only access to the public Supabase `gear_catalog` table.
// Powers the make/model autocomplete in AddGearScreen / EditGearScreen.
// Catalog matches are cosmetic — free-form typing always works, so a stale
// or empty cache is never user-blocking. See spec §5.1.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CloudClient } from '../cloud/cloudClient';
import { GearCatalogEntry } from '../types';

const CACHE_KEY = 'logbook:gear_catalog';

// 12h hard floor on refetch consideration (don't even *think* about hitting
// the network more often than this), 7d staleness threshold (only refetch
// when the cache is older than this). Net effect: ≤ 1 fetch per week per
// device under normal usage.
export const REFRESH_THROTTLE_MS = 12 * 60 * 60 * 1000;
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheShape {
  items: GearCatalogEntry[];
  fetched_at: number;
}

export interface GearCatalogService {
  fetchAndCache(): Promise<GearCatalogEntry[]>;
  getCached(): Promise<GearCatalogEntry[]>;
  refreshIfStale(now?: number): Promise<void>;
}

export function createGearCatalogService(
  cloud: CloudClient,
  storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'> = AsyncStorage,
): GearCatalogService {
  let lastConsideredAt = 0;

  async function readCache(): Promise<CacheShape | null> {
    const raw = await storage.getItem(CACHE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CacheShape;
      if (!Array.isArray(parsed.items)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async function writeCache(items: GearCatalogEntry[]): Promise<void> {
    const shape: CacheShape = { items, fetched_at: Date.now() };
    await storage.setItem(CACHE_KEY, JSON.stringify(shape));
  }

  return {
    async fetchAndCache(): Promise<GearCatalogEntry[]> {
      const items = await cloud.listGearCatalog();
      await writeCache(items);
      return items;
    },

    async getCached(): Promise<GearCatalogEntry[]> {
      const cache = await readCache();
      return cache?.items ?? [];
    },

    async refreshIfStale(now: number = Date.now()): Promise<void> {
      // 12h consideration throttle.
      if (now - lastConsideredAt < REFRESH_THROTTLE_MS) return;
      lastConsideredAt = now;

      const cache = await readCache();
      const cachedAge = cache ? now - cache.fetched_at : Infinity;
      if (cachedAge < STALE_AFTER_MS) return;

      try {
        await this.fetchAndCache();
      } catch {
        // Best-effort. The autocomplete is cosmetic and falls back to free-
        // form input when the cache is missing or stale.
      }
    },
  };
}
