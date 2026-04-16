// src/services/backupService.ts
export type CertExpiryStatus = 'ok' | 'warning' | 'expired';

export function createBackupService() {
  function daysBetween(dateStr: string, now: Date): number {
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }

  return {
    shouldShowReminder(lastBackupAt: string | null): boolean {
      if (!lastBackupAt) return true;
      return daysBetween(lastBackupAt, new Date()) > 30;
    },
    shouldShowPostSigningNudge(lastBackupAt: string | null): boolean {
      if (!lastBackupAt) return true;
      return daysBetween(lastBackupAt, new Date()) > 7;
    },
    daysSinceBackup(lastBackupAt: string | null): number | null {
      if (!lastBackupAt) return null;
      return daysBetween(lastBackupAt, new Date());
    },
    certExpiryStatus(certExpiresOn: string): CertExpiryStatus {
      const todayStr = new Date().toISOString().split('T')[0];
      if (certExpiresOn < todayStr) return 'expired';
      const nowMs = Date.now();
      const expiryMs = new Date(certExpiresOn + 'T00:00:00Z').getTime();
      const daysUntil = Math.floor((expiryMs - nowMs) / (24 * 60 * 60 * 1000));
      if (daysUntil <= 60) return 'warning';
      return 'ok';
    },
  };
}
