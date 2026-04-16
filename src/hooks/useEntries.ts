import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createEntriesService } from '../services/entriesService';
import { getClient } from '../db/initialize';
import { CreateEntryInput, UpdateEntryInput, SpratLevel } from '../types';

function getService() { return createEntriesService(getClient()); }

export function useEntries() {
  return useQuery({ queryKey: ['entries'], queryFn: () => getService().listEntries() });
}

export function useEntry(id: string) {
  return useQuery({ queryKey: ['entries', id], queryFn: () => getService().getEntry(id), enabled: !!id });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, techLevel }: { input: CreateEntryInput; techLevel: SpratLevel }) =>
      getService().createEntry(input, techLevel),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['entries'] }),
  });
}

export function useUpdateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEntryInput }) => getService().updateEntry(id, input),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['entries'] });
      queryClient.invalidateQueries({ queryKey: ['entries', id] });
    },
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => getService().deleteEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['entries'] }),
  });
}

export function useCreateAmendment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, reason, techLevel }: { entryId: string; reason: string; techLevel: SpratLevel }) =>
      getService().createAmendment(entryId, reason, techLevel),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['entries'] }),
  });
}

export function useTotalWorkHours(year: number) {
  return useQuery({ queryKey: ['totalWorkHours', year], queryFn: () => getService().getTotalWorkHours(year) });
}

export function useAmendmentForEntry(entryId: string) {
  return useQuery({ queryKey: ['amendment', entryId], queryFn: () => getService().getAmendmentForEntry(entryId), enabled: !!entryId });
}
