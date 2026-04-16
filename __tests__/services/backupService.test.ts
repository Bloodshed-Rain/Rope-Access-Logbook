// __tests__/services/backupService.test.ts
import { createBackupService } from '../../src/services/backupService';

describe('backupService', () => {
  const service = createBackupService();

  describe('shouldShowReminder', () => {
    it('returns true when lastBackupAt is null', () => {
      expect(service.shouldShowReminder(null)).toBe(true);
    });
    it('returns true when last backup was more than 30 days ago', () => {
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      expect(service.shouldShowReminder(fortyDaysAgo)).toBe(true);
    });
    it('returns false when last backup was less than 30 days ago', () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      expect(service.shouldShowReminder(fiveDaysAgo)).toBe(false);
    });
  });

  describe('shouldShowPostSigningNudge', () => {
    it('returns true when last backup was more than 7 days ago', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      expect(service.shouldShowPostSigningNudge(tenDaysAgo)).toBe(true);
    });
    it('returns false when last backup was less than 7 days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      expect(service.shouldShowPostSigningNudge(twoDaysAgo)).toBe(false);
    });
    it('returns true when lastBackupAt is null', () => {
      expect(service.shouldShowPostSigningNudge(null)).toBe(true);
    });
  });

  describe('daysSinceBackup', () => {
    it('returns null when lastBackupAt is null', () => {
      expect(service.daysSinceBackup(null)).toBeNull();
    });
    it('returns the number of days since last backup', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      expect(service.daysSinceBackup(tenDaysAgo)).toBe(10);
    });
  });

  describe('certExpiryStatus', () => {
    it('returns "expired" when cert is past expiry', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      expect(service.certExpiryStatus(yesterday)).toBe('expired');
    });
    it('returns "warning" when cert expires within 60 days', () => {
      const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      expect(service.certExpiryStatus(in30Days)).toBe('warning');
    });
    it('returns "ok" when cert is more than 60 days away', () => {
      const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      expect(service.certExpiryStatus(in90Days)).toBe('ok');
    });
  });
});
