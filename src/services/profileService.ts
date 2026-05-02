// src/services/profileService.ts
import { DbClient } from '../db/client';
import {
  Profile,
  CertBlock,
  CertBlockInput,
  CertScheme,
  CreateProfileInput,
  UpdateProfileInput,
} from '../types';
import { generateId } from '../utils/uuid';
import { CloudClient } from '../cloud/cloudClient';
import { scheduleCertExpiryNotifications } from '../utils/notifications';

type UuidFn = () => string;

// Raw SQLite row shape: flat columns; INTEGER booleans come back as 0|1.
interface ProfileRow {
  id: string;
  full_name: string;
  holds_sprat: number;
  sprat_id: string | null;
  level: 'I' | 'II' | 'III' | null;
  cert_expires_on: string | null;
  sprat_card_photo_path: string | null;
  holds_irata: number;
  irata_id: string | null;
  irata_level: 'I' | 'II' | 'III' | null;
  irata_expires_on: string | null;
  irata_card_photo_path: string | null;
  primary_cert: CertScheme;
  default_employer: string;
  last_backup_at: string | null;
  photos_in_backup: number;
  last_cloud_backup_at: string | null;
  last_uploaded_backup_id: string | null;
  supervisor_capability_enabled: number;
  supervisor_cert_number: string | null;
  supervisor_directory_visible: number;
  subscription_status: 'unknown' | 'trialing' | 'active' | 'lapsed';
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: ProfileRow | null | undefined): Profile | null {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    holds_sprat: !!row.holds_sprat,
    sprat_id: row.sprat_id,
    level: row.level,
    cert_expires_on: row.cert_expires_on,
    sprat_card_photo_path: row.sprat_card_photo_path,
    holds_irata: !!row.holds_irata,
    irata_id: row.irata_id,
    irata_level: row.irata_level,
    irata_expires_on: row.irata_expires_on,
    irata_card_photo_path: row.irata_card_photo_path,
    primary_cert: row.primary_cert,
    default_employer: row.default_employer,
    last_backup_at: row.last_backup_at,
    photos_in_backup: !!row.photos_in_backup,
    last_cloud_backup_at: row.last_cloud_backup_at,
    last_uploaded_backup_id: row.last_uploaded_backup_id,
    supervisor_capability_enabled: !!row.supervisor_capability_enabled,
    supervisor_cert_number: row.supervisor_cert_number,
    supervisor_directory_visible: !!row.supervisor_directory_visible,
    subscription_status: row.subscription_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Coerces both legacy SPRAT-only CreateProfileInput shape (`sprat_id` / `level` /
// `cert_expires_on` / `sprat_card_photo_path` flat) and new dual-cert shape
// (`sprat?` / `irata?` blocks) into resolved blocks.
function resolveBlocks(input: CreateProfileInput): {
  sprat: CertBlockInput | null;
  irata: CertBlockInput | null;
} {
  let sprat: CertBlockInput | null = input.sprat ?? null;
  if (!sprat && input.sprat_id && input.level && input.cert_expires_on) {
    sprat = {
      id: input.sprat_id,
      level: input.level,
      cert_expires_on: input.cert_expires_on,
      card_photo_path: input.sprat_card_photo_path ?? null,
    };
  }
  const irata: CertBlockInput | null = input.irata ?? null;
  return { sprat, irata };
}

function validateBlocks(
  blocks: { sprat: CertBlockInput | null; irata: CertBlockInput | null },
  primary: CertScheme | undefined,
): void {
  if (!blocks.sprat && !blocks.irata) {
    throw new Error('must_hold_at_least_one_cert');
  }
  if (primary === 'sprat' && !blocks.sprat) {
    throw new Error('primary_cert_not_held');
  }
  if (primary === 'irata' && !blocks.irata) {
    throw new Error('primary_cert_not_held');
  }
}

export function createProfileService(db: DbClient, uuid: UuidFn = generateId) {
  return {
    async createProfile(input: CreateProfileInput): Promise<Profile> {
      const blocks = resolveBlocks(input);
      validateBlocks(blocks, input.primary_cert);
      const now = new Date().toISOString();
      const id = uuid();
      // Default primary: explicit choice → input; else SPRAT if held; else IRATA.
      const primary: CertScheme =
        input.primary_cert ?? (blocks.sprat ? 'sprat' : 'irata');
      await db.run(
        `INSERT INTO profile (
           id, full_name,
           holds_sprat, sprat_id, level, cert_expires_on, sprat_card_photo_path,
           holds_irata, irata_id, irata_level, irata_expires_on, irata_card_photo_path,
           primary_cert, default_employer, last_backup_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.full_name,
          blocks.sprat ? 1 : 0,
          blocks.sprat?.id ?? null,
          blocks.sprat?.level ?? null,
          blocks.sprat?.cert_expires_on ?? null,
          blocks.sprat?.card_photo_path ?? null,
          blocks.irata ? 1 : 0,
          blocks.irata?.id ?? null,
          blocks.irata?.level ?? null,
          blocks.irata?.cert_expires_on ?? null,
          blocks.irata?.card_photo_path ?? null,
          primary,
          input.default_employer ?? '',
          null,
          now,
          now,
        ],
      );
      // Schedule cert-expiry notifications for whichever certs were attached.
      try {
        if (blocks.sprat) await scheduleCertExpiryNotifications(blocks.sprat.cert_expires_on);
        if (blocks.irata) await scheduleCertExpiryNotifications(blocks.irata.cert_expires_on);
      } catch {
        /* notifications best-effort */
      }
      return (await this.getProfile())!;
    },

    async getProfile(): Promise<Profile | null> {
      const row = await db.get<ProfileRow>('SELECT * FROM profile LIMIT 1');
      return rowToProfile(row ?? null);
    },

    async updateProfile(input: UpdateProfileInput): Promise<Profile> {
      const profile = await this.getProfile();
      if (!profile) throw new Error('No profile exists');

      // Validate primary_cert switch points at a held cert.
      if (input.primary_cert) {
        if (input.primary_cert === 'sprat' && !profile.holds_sprat) {
          throw new Error('primary_cert_not_held');
        }
        if (input.primary_cert === 'irata' && !profile.holds_irata) {
          throw new Error('primary_cert_not_held');
        }
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
          fields.push(`${key} = ?`);
          // SQLite drivers (better-sqlite3, expo-sqlite) don't accept booleans
          // directly. Coerce to 0/1 so columns stored as INTEGER bind correctly.
          values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
        }
      }

      if (fields.length === 0) return profile;

      const now = new Date().toISOString();
      fields.push('updated_at = ?');
      values.push(now);
      values.push(profile.id);

      await db.run(`UPDATE profile SET ${fields.join(', ')} WHERE id = ?`, values);

      if (input.cert_expires_on) {
        try {
          await scheduleCertExpiryNotifications(input.cert_expires_on);
        } catch {
          /* best-effort */
        }
      }

      return (await this.getProfile())!;
    },

    async upsertSpratCert(block: CertBlockInput): Promise<Profile> {
      const profile = await this.getProfile();
      if (!profile) throw new Error('No profile exists');
      const now = new Date().toISOString();
      await db.run(
        `UPDATE profile SET
           holds_sprat = 1,
           sprat_id = ?, level = ?, cert_expires_on = ?, sprat_card_photo_path = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          block.id,
          block.level,
          block.cert_expires_on,
          block.card_photo_path ?? null,
          now,
          profile.id,
        ],
      );
      try {
        await scheduleCertExpiryNotifications(block.cert_expires_on);
      } catch {
        /* best-effort */
      }
      return (await this.getProfile())!;
    },

    async upsertIrataCert(block: CertBlockInput): Promise<Profile> {
      const profile = await this.getProfile();
      if (!profile) throw new Error('No profile exists');
      const now = new Date().toISOString();
      await db.run(
        `UPDATE profile SET
           holds_irata = 1,
           irata_id = ?, irata_level = ?, irata_expires_on = ?, irata_card_photo_path = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          block.id,
          block.level,
          block.cert_expires_on,
          block.card_photo_path ?? null,
          now,
          profile.id,
        ],
      );
      try {
        await scheduleCertExpiryNotifications(block.cert_expires_on);
      } catch {
        /* best-effort */
      }
      return (await this.getProfile())!;
    },

    async removeCert(scheme: CertScheme): Promise<Profile> {
      const profile = await this.getProfile();
      if (!profile) throw new Error('No profile exists');
      const otherHeld =
        scheme === 'sprat' ? profile.holds_irata : profile.holds_sprat;
      if (!otherHeld) throw new Error('cannot_remove_only_cert');
      const now = new Date().toISOString();
      // Auto-flip primary if removing the primary cert.
      const newPrimary: CertScheme =
        profile.primary_cert === scheme
          ? scheme === 'sprat'
            ? 'irata'
            : 'sprat'
          : profile.primary_cert;
      if (scheme === 'sprat') {
        await db.run(
          `UPDATE profile SET
             holds_sprat = 0, sprat_id = NULL, level = NULL,
             cert_expires_on = NULL, sprat_card_photo_path = NULL,
             primary_cert = ?, updated_at = ?
           WHERE id = ?`,
          [newPrimary, now, profile.id],
        );
      } else {
        await db.run(
          `UPDATE profile SET
             holds_irata = 0, irata_id = NULL, irata_level = NULL,
             irata_expires_on = NULL, irata_card_photo_path = NULL,
             primary_cert = ?, updated_at = ?
           WHERE id = ?`,
          [newPrimary, now, profile.id],
        );
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

    // Toggle directory visibility while supervisor capability stays on.
    // Always upserts the cloud row so flipping visible=false actually hides
    // the supervisor from search; relying on an absent upsert would leave
    // the previous visible=true row stale.
    async setSupervisorDirectoryVisible(
      visible: boolean,
      displayName: string,
      cloud: CloudClient,
    ): Promise<void> {
      const profile = await this.getProfile();
      if (!profile) throw new Error('No profile exists');
      if (!profile.supervisor_capability_enabled || !profile.supervisor_cert_number) {
        throw new Error('supervisor_capability_not_enabled');
      }
      const now = new Date().toISOString();
      await db.run(
        `UPDATE profile SET supervisor_directory_visible = ?, updated_at = ?
           WHERE id = (SELECT id FROM profile LIMIT 1)`,
        [visible ? 1 : 0, now],
      );
      await cloud.upsertSupervisorDirectory({
        display_name: displayName,
        sprat_cert_number: profile.supervisor_cert_number,
        visible,
      });
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
