// React Query wrappers for gearService and gearCatalogService.
// The runtime instance is wired with expo-notifications helpers so write
// paths re-schedule local OS notifications on every change. Tests do not
// touch this file — they exercise gearService directly with stubbed hooks.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createGearService, GearNotificationHooks } from '../services/gearService';
import { createGearCatalogService } from '../services/gearCatalogService';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import {
  CreateGearInput,
  UpdateGearInput,
  LogInspectionInput,
} from '../types';
import {
  scheduleGearInspectionNotifications,
  cancelGearInspectionNotifications,
} from '../utils/notifications';

const notifHooks: GearNotificationHooks = {
  schedule: scheduleGearInspectionNotifications,
  cancel: cancelGearInspectionNotifications,
};

function svc() {
  return createGearService(getClient(), undefined, undefined, notifHooks);
}
function catalog() {
  return createGearCatalogService(createSupabaseCloudClient());
}

export function useGearList() {
  return useQuery({
    queryKey: ['gear'],
    queryFn: () => svc().listGear(),
  });
}

export function useGearItem(id: string | null) {
  return useQuery({
    queryKey: ['gear', id],
    queryFn: () => (id ? svc().getGear(id) : Promise.resolve(null)),
    enabled: !!id,
  });
}

export function useGearInspections(gearId: string | null) {
  return useQuery({
    queryKey: ['gear', gearId, 'inspections'],
    queryFn: () => (gearId ? svc().listInspections(gearId) : Promise.resolve([])),
    enabled: !!gearId,
  });
}

export function useDueGear(withinDays: number) {
  return useQuery({
    queryKey: ['gear', 'due', withinDays],
    queryFn: () => svc().listDue(withinDays),
  });
}

export function useCreateGear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGearInput) => svc().createGear(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gear'] });
    },
  });
}

export function useUpdateGear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateGearInput }) =>
      svc().updateGear(id, input),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['gear'] });
      qc.invalidateQueries({ queryKey: ['gear', id] });
    },
  });
}

export function useRetireGear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      svc().retireGear(id, reason),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['gear'] });
      qc.invalidateQueries({ queryKey: ['gear', id] });
    },
  });
}

export function useDeleteGear() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => svc().deleteGear(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gear'] });
    },
  });
}

export function useLogInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogInspectionInput) => svc().logInspection(input),
    onSuccess: (_, { gear_id }) => {
      qc.invalidateQueries({ queryKey: ['gear'] });
      qc.invalidateQueries({ queryKey: ['gear', gear_id] });
      qc.invalidateQueries({ queryKey: ['gear', gear_id, 'inspections'] });
    },
  });
}

export function useGearCatalog() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['gearCatalog'],
    queryFn: async () => {
      const svc = catalog();
      const cached = await svc.getCached();

      // First-run hydration: empty cache means we've never fetched. Block
      // on the fetch so the dropdown doesn't render empty then flicker.
      if (cached.length === 0) {
        try {
          return await svc.fetchAndCache();
        } catch {
          return [];
        }
      }

      // Cache present → return immediately for snappy UI, but fire a
      // background refresh and swap in the fresh result when it lands. This
      // bypasses the service-level 7d staleness gate (which assumes a stable
      // catalog); during active catalog growth that gate left users staring
      // at last week's list. The fetch is small (a few KB of text) and only
      // fires on screen mount, so it's cheap.
      svc.fetchAndCache()
        .then((fresh) => qc.setQueryData(['gearCatalog'], fresh))
        .catch(() => {});
      return cached;
    },
    // Refetch on focus so a hydrated cache lights up immediately after the
    // first fetch, without forcing a manual reload.
    staleTime: 60_000,
  });
}
