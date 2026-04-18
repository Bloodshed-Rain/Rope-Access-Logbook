// src/services/profileService.ts
import { DbClient } from '../db/client';
import { Profile, CreateProfileInput, UpdateProfileInput } from '../types';
import { generateId } from '../utils/uuid';
import { CloudClient } from '../cloud/cloudClient';

type UuidFn = () => string;

// Raw row shape returned by SQLite: INTEGER columns come back as 0|1 rather than
// true|false. The domain `Profile` type exposes them as booleans, so `getProfile`
// converts before returning.
type ProfileRow = Omit<
  Profile,
  'photos_in_backup' | 'supervisor_capability_enabled' | 'supervisor_directory_visible'
> & {
  photos_in_backup: number;
  supervisor_capability_enabled: number;
  supervisor_directory_visible: number;
};

function rowToProfile(row: ProfileRow | null | undefined): Profile | null {
  if (!row) return null;
  return {
    ...row,
    photos_in_backup: !!row.photos_in_backup,
    supervisor_capability_enabled: !!row.supervisor_capability_enabled,
    supervisor_directory_visible: !!row.supervisor_directory_visible,
  };
}

export function createProfileService(db: DbClient, uuid: UuidFn = generateId) {
  return {
    async createProfile(input: CreateProfileInput): Promise<Profile> {
      const now = new Date().toISOString();
      const id = uuid();
      await db.run(
        `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, default_employer, sprat_card_photo_path, last_backup_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.full_name, input.sprat_id, input.level, input.cert_expires_on, input.default_employer, input.sprat_card_photo_path ?? null, null, now, now],
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
