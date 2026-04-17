import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRestoreService, RestoreDeps, RestoreResult } from '../services/restoreService';
import { CloudStatePreview } from '../types';

export function useCloudStatePreview(deps: RestoreDeps, enabled: boolean) {
  return useQuery<CloudStatePreview>({
    queryKey: ['cloudPreview'],
    queryFn: () => createRestoreService(deps).previewCloudState(),
    enabled,
    retry: false,
  });
}

export function useRestore(deps: RestoreDeps) {
  const qc = useQueryClient();
  const svc = createRestoreService(deps);
  return useMutation<RestoreResult, Error, void>({
    mutationFn: () => svc.restore(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
      qc.invalidateQueries({ queryKey: ['signatures'] });
      qc.invalidateQueries({ queryKey: ['backupStatus'] });
    },
  });
}

export function useReplaceCloud(deps: RestoreDeps) {
  const svc = createRestoreService(deps);
  return useMutation<void, Error, void>({
    mutationFn: () => svc.uploadCurrentAsCloud(),
  });
}
