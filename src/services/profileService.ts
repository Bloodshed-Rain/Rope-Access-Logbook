// src/services/profileService.ts
import { DbClient } from '../db/client';
import { Profile, CreateProfileInput, UpdateProfileInput } from '../types';
import { generateId } from '../utils/uuid';

type UuidFn = () => string;

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
      return db.get<Profile>('SELECT * FROM profile LIMIT 1');
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
  };
}
