// __tests__/services/profileService.test.ts
import { createTestClient } from '../setup';
import { createMockCloudClient } from '../cloudMock';
import { createProfileService } from '../../src/services/profileService';
import { DbClient } from '../../src/db/client';
import { Profile, CreateProfileInput, CertBlockInput, AuthSession } from '../../src/types';

describe('profileService', () => {
  let db: DbClient;
  let service: ReturnType<typeof createProfileService>;
  const testUuid = () => 'test-uuid-1';

  const validInput: CreateProfileInput = {
    full_name: 'John Doe',
    sprat_id: 'SPRAT-12345',
    level: 'II',
    cert_expires_on: '2027-06-15',
    default_employer: 'Acme Rope Co',
  };

  beforeEach(async () => {
    db = await createTestClient();
    service = createProfileService(db, testUuid);
  });

  describe('createProfile', () => {
    it('creates a profile and returns it', async () => {
      const profile = await service.createProfile(validInput);
      expect(profile.full_name).toBe('John Doe');
      expect(profile.sprat_id).toBe('SPRAT-12345');
      expect(profile.level).toBe('II');
      expect(profile.id).toBe('test-uuid-1');
    });

    it('sets last_backup_at to null', async () => {
      const profile = await service.createProfile(validInput);
      expect(profile.last_backup_at).toBeNull();
    });

    it('defaults the legacy SPRAT-only shape to primary_cert=sprat with no IRATA', async () => {
      const profile = await service.createProfile(validInput);
      expect(profile.holds_sprat).toBe(true);
      expect(profile.holds_irata).toBe(false);
      expect(profile.primary_cert).toBe('sprat');
      expect(profile.irata_id).toBeNull();
      expect(profile.irata_level).toBeNull();
      expect(profile.irata_expires_on).toBeNull();
      expect(profile.irata_card_photo_path).toBeNull();
    });

    it('creates an IRATA-only profile via the irata block (no SPRAT)', async () => {
      const profile = await service.createProfile({
        full_name: 'Sasha IRATA',
        irata: { id: 'IRATA-188421', level: 'I', cert_expires_on: '2027-08-04' },
        default_employer: 'Acme',
      });
      expect(profile.holds_sprat).toBe(false);
      expect(profile.holds_irata).toBe(true);
      expect(profile.sprat_id).toBeNull();
      expect(profile.level).toBeNull();
      expect(profile.cert_expires_on).toBeNull();
      expect(profile.irata_id).toBe('IRATA-188421');
      expect(profile.irata_level).toBe('I');
      expect(profile.irata_expires_on).toBe('2027-08-04');
      // Default primary: SPRAT if held, else IRATA.
      expect(profile.primary_cert).toBe('irata');
    });

    it('creates a dual-cert profile when both blocks supplied + honours explicit primary_cert', async () => {
      const profile = await service.createProfile({
        full_name: 'Dual Tech',
        sprat: { id: 'S-1', level: 'II', cert_expires_on: '2027-06-15' },
        irata: { id: 'I-1', level: 'I', cert_expires_on: '2027-08-04' },
        primary_cert: 'irata',
      });
      expect(profile.holds_sprat).toBe(true);
      expect(profile.holds_irata).toBe(true);
      expect(profile.primary_cert).toBe('irata');
      expect(profile.sprat_id).toBe('S-1');
      expect(profile.irata_id).toBe('I-1');
    });

    it('rejects creation with neither SPRAT nor IRATA block', async () => {
      await expect(
        service.createProfile({ full_name: 'No Certs' } as CreateProfileInput),
      ).rejects.toThrow(/must_hold_at_least_one_cert/);
    });

    it('rejects primary_cert pointing at a cert that is not held', async () => {
      await expect(
        service.createProfile({
          full_name: 'Mismatch',
          sprat: { id: 'S-1', level: 'II', cert_expires_on: '2027-06-15' },
          primary_cert: 'irata',
        }),
      ).rejects.toThrow(/primary_cert_not_held/);
    });
  });

  describe('upsertIrataCert', () => {
    const irataBlock: CertBlockInput = {
      id: 'IRATA-9000',
      level: 'III',
      cert_expires_on: '2028-01-01',
    };

    it('attaches an IRATA block to an existing SPRAT-only profile', async () => {
      await service.createProfile(validInput);
      const updated = await service.upsertIrataCert(irataBlock);
      expect(updated.holds_irata).toBe(true);
      expect(updated.irata_id).toBe('IRATA-9000');
      expect(updated.irata_level).toBe('III');
      expect(updated.irata_expires_on).toBe('2028-01-01');
      // SPRAT block is untouched.
      expect(updated.holds_sprat).toBe(true);
      expect(updated.sprat_id).toBe('SPRAT-12345');
      // Primary stays as it was.
      expect(updated.primary_cert).toBe('sprat');
    });
  });

  describe('removeCert', () => {
    it('refuses to remove the only held cert', async () => {
      await service.createProfile(validInput);
      await expect(service.removeCert('sprat')).rejects.toThrow(/cannot_remove_only_cert/);
    });

    it('auto-flips primary_cert when removing the primary cert', async () => {
      await service.createProfile({
        full_name: 'Dual Primary IRATA',
        sprat: { id: 'S-1', level: 'II', cert_expires_on: '2027-06-15' },
        irata: { id: 'I-1', level: 'I', cert_expires_on: '2027-08-04' },
        primary_cert: 'irata',
      });
      const after = await service.removeCert('irata');
      expect(after.holds_irata).toBe(false);
      expect(after.irata_id).toBeNull();
      expect(after.primary_cert).toBe('sprat');
    });

    it('keeps primary_cert intact when removing the non-primary cert', async () => {
      await service.createProfile({
        full_name: 'Dual Primary SPRAT',
        sprat: { id: 'S-1', level: 'II', cert_expires_on: '2027-06-15' },
        irata: { id: 'I-1', level: 'I', cert_expires_on: '2027-08-04' },
        primary_cert: 'sprat',
      });
      const after = await service.removeCert('irata');
      expect(after.primary_cert).toBe('sprat');
    });
  });

  describe('getProfile', () => {
    it('returns null when no profile exists', async () => {
      const profile = await service.getProfile();
      expect(profile).toBeNull();
    });

    it('returns the profile after creation', async () => {
      await service.createProfile(validInput);
      const profile = await service.getProfile();
      expect(profile).not.toBeNull();
      expect(profile!.full_name).toBe('John Doe');
    });
  });

  describe('updateProfile', () => {
    it('updates specific fields', async () => {
      await service.createProfile(validInput);
      const updated = await service.updateProfile({ level: 'III' });
      expect(updated.level).toBe('III');
      expect(updated.full_name).toBe('John Doe');
    });

    it('updates updated_at timestamp', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const created = await service.createProfile(validInput);
      jest.setSystemTime(new Date('2026-01-01T00:01:00Z'));
      const updated = await service.updateProfile({ full_name: 'Jane Doe' });
      expect(updated.updated_at).not.toBe(created.updated_at);
      jest.useRealTimers();
    });

    it('rejects switching primary_cert to a cert the profile does not hold', async () => {
      await service.createProfile(validInput); // SPRAT-only
      await expect(service.updateProfile({ primary_cert: 'irata' })).rejects.toThrow(
        /primary_cert_not_held/,
      );
    });
  });

  describe('updateLastBackupAt', () => {
    it('sets last_backup_at to the given timestamp', async () => {
      await service.createProfile(validInput);
      const ts = '2026-04-15T10:00:00Z';
      await service.updateLastBackupAt(ts);
      const profile = await service.getProfile();
      expect(profile!.last_backup_at).toBe(ts);
    });
  });

  describe('supervisor capability', () => {
    const session: AuthSession = {
      user_id: 'u',
      email: 'e@x.com',
      access_token: 't',
      refresh_token: 'r',
      expires_at: Date.now() + 3600_000,
    };

    it('enable/disable updates profile and calls directory upsert/delete', async () => {
      await service.createProfile(validInput);
      const cloud = createMockCloudClient({ initialSession: session });

      await service.enableSupervisorCapability('L3-11111', 'Test Tech', true, cloud);
      const p = await service.getProfile();
      expect(p?.supervisor_capability_enabled).toBe(true);
      expect(p?.supervisor_cert_number).toBe('L3-11111');
      expect(p?.supervisor_directory_visible).toBe(true);
      expect(cloud.directory.get('u')?.sprat_cert_number).toBe('L3-11111');

      await service.disableSupervisorCapability(0, cloud);
      const p2 = await service.getProfile();
      expect(p2?.supervisor_capability_enabled).toBe(false);
      expect(cloud.directory.has('u')).toBe(false);
    });

    it('disable is blocked when pending requests exist', async () => {
      await service.createProfile(validInput);
      const cloud = createMockCloudClient({ initialSession: session });
      await expect(service.disableSupervisorCapability(1, cloud)).rejects.toThrow(
        'pending_requests_exist',
      );
    });

    it('enableSupervisorCapability with directoryVisible=false does NOT upsert directory', async () => {
      await service.createProfile(validInput);
      const cloud = createMockCloudClient({ initialSession: session });
      await service.enableSupervisorCapability('L3-22222', 'Test Tech', false, cloud);
      const p = await service.getProfile();
      expect(p?.supervisor_directory_visible).toBe(false);
      expect(cloud.directory.has('u')).toBe(false);
    });
  });
});
