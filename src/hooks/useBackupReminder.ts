import { useMemo } from 'react';
import { useProfile } from './useProfile';
import { createBackupService } from '../services/backupService';

export function useBackupReminder() {
  const { data: profile } = useProfile();
  const service = useMemo(() => createBackupService(), []);
  const lastBackupAt = profile?.last_backup_at ?? null;
  return {
    showReminder: service.shouldShowReminder(lastBackupAt),
    showPostSigningNudge: service.shouldShowPostSigningNudge(lastBackupAt),
    daysSinceBackup: service.daysSinceBackup(lastBackupAt),
    certExpiryStatus: profile?.cert_expires_on
      ? service.certExpiryStatus(profile.cert_expires_on)
      : ('ok' as const),
  };
}
