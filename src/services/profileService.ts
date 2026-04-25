// src/services/profileService.ts
import { DbClient } from '../db/client';
import { Profile, CreateProfileInput, UpdateProfileInput } from '../types';
import { generateId } from '../utils/uuid';
import { CloudClient } from '../cloud/cloudClient';
import { scheduleCertExpiryNotifications } from '../utils/notifications';

type UuidFn = () => string;

// Raw row shape returned by SQLite: INTEGER columns come back as 0|1 rather than
// true|false. The domain `Profile` type exposes them as booleans, so `getProfile`
// converts before returning.
type ProfileRow = Omit<
  Profile,
  'photos_in_backup' | 'supervisor_capability_enabled' | 'supervisor_directory_visible' | 'holds_sprat' | 'holds_irata'
> & {
  photos_in_backup: number;
  supervisor_capability_enabled: number;
  supervisor_directory_visible: number;
  holds_sprat: number;
  holds_irata: number;
};

function rowToProfile(row: ProfileRow | null | undefined): Profile | null {
  if (!row) return null;
  return {
    ...row,
    photos_in_backup: !!row.photos_in_backup,
    supervisor_capability_enabled: !!row.supervisor_capability_enabled,
    supervisor_directory_visible: !!row.supervisor_directory_visible,
    holds_sprat: !!row.holds_sprat,
    holds_irata: !!row.holds_irata,
  };
}

export function createProfileService(db: DbClient, uuid: UuidFn = generateId) {
  return {
    async createProfile(input: CreateProfileInput): Promise<Profile> {
      const now = new Date().toISOString();
      const id = uuid();
      const holdsIrata = input.holds_irata ?? false;
      // Validate IRATA block coherence: if holds_irata, all IRATA fields required.
      if (holdsIrata && (!input.irata_id || !input.irata_level || !input.irata_expires_on)) {
        throw new Error('IRATA block incomplete');
      }
      await db.run(
        `INSERT INTO profile (
            id, full_name,
            holds_sprat, sprat_id, level, cert_expires_on, sprat_card_photo_path,
            holds_irata, irata_id, irata_level, irata_expires_on, irata_card_photo_path,
            primary_cert,
            default_employer, last_backup_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.full_name,
          1, input.sprat_id, input.level, input.cert_expires_on, input.sprat_card_photo_path ?? null,
          holdsIrata ? 1 : 0, input.irata_id ?? null, input.irata_level ?? null, input.irata_expires_on ?? null, input.irata_card_photo_path ?? null,
          input.primary_cert ?? 'sprat',
          input.default_employer, null, now, now,
        ],
      );
      return (await this.getProfile())!;
    },

    async getProfile(): Promise<Profile | null> {
      const row = await db.get<ProfileRow>('SELECT * FROM profile LIMIT 1');
      return rowToProfile(row ?? null);
    },

    async updateProfile(input: UpdateProfileInput): Promise<Profile> {
      const profile = await this.getProfile();
      if (!profile) throw new Error('No profile exists');

      const fields: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }

      const now = new Date().toISOString();
      fields.push('updated_at = ?');
      values.push(now);
      values.push(profile.id);

      await db.run(`UPDATE profile SET ${fields.join(', ')} WHERE id = ?`, values);
      
      if (input.cert_expires_on) {
        try {
          await scheduleCertExpiryNotifications(input.cert_expires_on);
        } catch {}
      }
      
      return (await this.getProfile())!;
    },

    async updateLastBackupAt(timestamp: string): Promise<void> {
      await db.run(
        'UPDATE profile SET last_backup_at = ?, updated_at = ? WHERE id = (SELECT id FROM profile LIMIT 1)',
        [timestamp, new Date().toISOString()],
      );
    },

    async enableSupervisorCapability(
      certNumber: string,
      displayName: string,
      directoryVisible: boolean,
      cloud: CloudClient,
    ): Promise<void> {
      const now = new Date().toISOString();
      await db.run(
        `UPDATE profile SET supervisor_capability_enabled = 1,
                            supervisor_cert_number = ?,
                            supervisor_directory_visible = ?,
                            updated_at = ?
         WHERE id = (SELECT id FROM profile LIMIT 1)`,
        [certNumber, directoryVisible ? 1 : 0, now],
      );
      if (directoryVisible) {
        await cloud.upsertSupervisorDirectory({
          display_name: displayName,
          sprat_cert_number: certNumber,
          visible: true,
        });
      }
    },

    async disableSupervisorCapability(
      pendingRequestCount: number,
      cloud: CloudClient,
    ): Promise<void> {
      if (pendingRequestCount > 0) throw new Error('pending_requests_exist');
      const now = new Date().toISOString();
      await db.run(
        `UPDATE profile SET supervisor_capability_enabled = 0,
                            updated_at = ?
         WHERE id = (SELECT id FROM profile LIMIT 1)`,
        [now],
      );
      await cloud.deleteSupervisorDirectory();
    },
  };
}
