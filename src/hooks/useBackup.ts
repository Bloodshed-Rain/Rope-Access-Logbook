// src/hooks/useBackup.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createCloudBackupService, CloudBackupDeps } from '../services/cloudBackupService';
import { BackupResult } from '../types';

export function useBackup(deps: CloudBackupDeps) {
  const qc = useQueryClient();
  const svc = createCloudBackupService(deps);
  return useMutation<BackupResult, Error, void>({
    mutationFn: () => svc.backup(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['backupStatus'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
