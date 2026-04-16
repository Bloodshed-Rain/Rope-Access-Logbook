import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSigningService } from '../services/signingService';
import { getClient } from '../db/initialize';
import { CreateSignatureInput } from '../types';

function getService() { return createSigningService(getClient()); }

export function useSignatureForEntry(entryId: string) {
  return useQuery({ queryKey: ['signature', entryId], queryFn: () => getService().getSignatureForEntry(entryId), enabled: !!entryId });
}

export function useSignEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSignatureInput) => getService().signEntry(input),
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['entries'] });
      queryClient.invalidateQueries({ queryKey: ['entries', input.entry_id] });
      queryClient.invalidateQueries({ queryKey: ['signature', input.entry_id] });
      queryClient.invalidateQueries({ queryKey: ['totalWorkHours'] });
    },
  });
}

export function useVerifyIntegrity(entryId: string) {
  return useQuery({ queryKey: ['integrity', entryId], queryFn: () => getService().verifyIntegrity(entryId), enabled: !!entryId });
}
