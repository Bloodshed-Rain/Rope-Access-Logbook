// src/hooks/useBackup.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getCloudBackupService, CloudBackupDeps } from '../services/cloudBackupService';
import { BackupResult } from '../types';

export function useBackup(deps: CloudBackupDeps) {
  const qc = useQueryClient();
  // Shared module-level instance so throttle/mutex are honoured across the
  // post-sign trigger, the manual "Back up now" button, and the AppState→
  // background trigger in App.tsx. A per-render service would defeat them.
  const svc = getCloudBackupService(deps);
  return useMutation<BackupResult, Error, void>({
    mutationFn: () => svc.backup(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['backupStatus'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
