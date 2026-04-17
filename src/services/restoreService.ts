import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import { CloudSnapshot, CloudStatePreview } from '../types';
import { rehydrateAppPath } from '../utils/paths';

const MAX_CLOUD_SCHEMA_VERSION = 1;
const MAX_DB_SCHEMA_VERSION = 1;

export interface RestoreDeps {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  appVersion: string;
}

export type RestoreResult =
  | { kind: 'restored'; entries: number; signatures: number; assets: number; assets_failed: string[] }
  | { kind: 'version_too_new'; which: 'cloud' | 'db' }
  | { kind: 'no_snapshot' };

function storageKeyToRelativePath(storageKey: string): string {
  if (storageKey.startsWith('assets/sig_')) {
    const sigId = storageKey.replace('assets/sig_', '').replace(/\.[^.]+$/, '');
    return `logbook/signatures/${sigId}.png`;
  }
  if (storageKey.startsWith('assets/spratcard_')) {
    const ext = storageKey.split('.').pop() ?? 'jpg';
    return `logbook/cards/sprat_card.${ext}`;
  }
  if (storageKey.startsWith('assets/photo_')) {
    const rest = storageKey.replace('assets/photo_', '');
    return `logbook/photos/${rest}`;
  }
  throw new Error(`Unknown storage key format: ${storageKey}`);
}

export function createRestoreService(deps: RestoreDeps) {
  const { db, cloud, fs } = deps;

  async function fetchSnapshot(uid: string): Promise<CloudSnapshot | null> {
    if (!(await cloud.objectExists(`${uid}/snapshot.json`))) return null;
    const bytes = await cloud.downloadObject(`${uid}/snapshot.json`);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  return {
    async previewCloudState(): Promise<CloudStatePreview> {
      const session = await cloud.getSession();
      if (!session) throw new Error('not_authenticated');
      const snap = await fetchSnapshot(session.user_id);
      if (!snap) {
        return { has_cloud_data: false, entries_count: 0, signatures_count: 0, cloud_backed_up_at: null, backup_id: null };
      }
      return {
        has_cloud_data: true,
        entries_count: snap.entries.length,
        signatures_count: snap.signatures.length,
        cloud_backed_up_at: snap.exported_at,
        backup_id: snap.backup_id,
      };
    },

    async restore(): Promise<RestoreResult> {
      const session = await cloud.getSession();
      if (!session) throw new Error('not_authenticated');
      const snap = await fetchSnapshot(session.user_id);
      if (!snap) return { kind: 'no_snapshot' };

      if (snap.cloud_schema_version > MAX_CLOUD_SCHEMA_VERSION) {
        return { kind: 'version_too_new', which: 'cloud' };
      }
      if (snap.schema_version > MAX_DB_SCHEMA_VERSION) {
        return { kind: 'version_too_new', which: 'db' };
      }

      const assets_failed: string[] = [];
      let assets_downloaded = 0;
      for (const [storageKey, manifestEntry] of Object.entries(snap.binary_manifest)) {
        try {
          const bytes = await cloud.downloadObject(`${session.user_id}/${storageKey}`);
          const relativePath = storageKeyToRelativePath(storageKey);
          const localPath = rehydrateAppPath(relativePath);
          await fs.ensureDir(localPath.substring(0, localPath.lastIndexOf('/')));
          await fs.writeBytes(localPath, bytes);
          const actual = await fs.getSha256(localPath);
          if (actual !== manifestEntry.sha256) {
            await fs.deletePath(localPath);
            assets_failed.push(storageKey);
            continue;
          }
          assets_downloaded++;
        } catch {
          assets_failed.push(storageKey);
        }
      }

      await db.exec('BEGIN');
      try {
        await db.exec('DELETE FROM signatures; DELETE FROM entries; DELETE FROM profile;');

        const p = snap.profile;
        const rehydratedCard = p.sprat_card_photo_path
          ? rehydrateAppPath(p.sprat_card_photo_path)
          : null;
        await db.run(
          `INSERT INTO profile (id, full_name, sprat_id, level, cert_expires_on, default_employer,
            sprat_card_photo_path, last_backup_at, photos_in_backup, last_cloud_backup_at,
            last_uploaded_backup_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id, p.full_name, p.sprat_id, p.level, p.cert_expires_on, p.default_employer,
            rehydratedCard, p.last_backup_at, p.photos_in_backup ? 1 : 0,
            snap.exported_at, snap.backup_id, p.created_at, p.updated_at,
          ],
        );

        for (const e of snap.entries) {
          const rehydratedPhotos = e.photo_paths.map(rehydrateAppPath);
          await db.run(
            `INSERT INTO entries (id, date, employer, site, client, description, work_hours,
              tech_level_snapshot, work_types, equipment_notes, weather, photo_paths, status,
              amends_entry_id, amendment_reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              e.id, e.date, e.employer, e.site, e.client, e.description, e.work_hours,
              e.tech_level_snapshot, JSON.stringify(e.work_types),
              e.equipment_notes, e.weather, JSON.stringify(rehydratedPhotos),
              e.status, e.amends_entry_id, e.amendment_reason,
              e.created_at, e.updated_at,
            ],
          );
        }

        for (const s of snap.signatures) {
          const rehydratedSigPath = rehydrateAppPath(s.signature_png_path);
          await db.run(
            `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number,
              signature_png_path, signed_at, device_id, gps_lat, gps_lon, entry_hash, hash_version, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              s.id, s.entry_id, s.supervisor_name, s.supervisor_cert_number,
              rehydratedSigPath, s.signed_at, s.device_id, s.gps_lat, s.gps_lon,
              s.entry_hash, s.hash_version, s.created_at,
            ],
          );
        }

        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }

      return {
        kind: 'restored',
        entries: snap.entries.length,
        signatures: snap.signatures.length,
        assets: assets_downloaded,
        assets_failed,
      };
    },

    async uploadCurrentAsCloud(): Promise<void> {
      throw new Error('not_implemented');
    },
  };
}
