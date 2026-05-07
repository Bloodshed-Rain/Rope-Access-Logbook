import AsyncStorage from '@react-native-async-storage/async-storage';
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import { CloudSnapshot, CloudStatePreview } from '../types';
import { rehydrateAppPath } from '../utils/paths';
import { scheduleCertExpiryNotifications } from '../utils/notifications';

// Bumped to 3 with the gear inventory addition (equipment-inventory-design §7.1).
// `schema_version` (the inner JsonBackup envelope) stays at 2 because the
// shape of entries / signatures / profile is unchanged — only the snapshot
// envelope grew the new gear / gear_inspections arrays.
const MAX_CLOUD_SCHEMA_VERSION = 3;
const MAX_DB_SCHEMA_VERSION = 2;

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
  // Gear inventory (cloud_schema_version 3). Mirrors the entry-photo
  // round-trip invariant: `saveGearPhoto` writes locally to the same
  // `logbook/photos/gearphoto_{id}.{ext}` path that this resolves to,
  // so backup → restore preserves gear.photo_path byte-for-byte.
  if (storageKey.startsWith('assets/gearphoto_')) {
    const rest = storageKey.replace('assets/gearphoto_', '');
    return `logbook/photos/gearphoto_${rest}`;
  }
  if (storageKey.startsWith('assets/inspcert_')) {
    const rest = storageKey.replace('assets/inspcert_', '');
    return `logbook/photos/inspcert_${rest}`;
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
        await db.exec('DELETE FROM signatures');
        await db.exec('DELETE FROM entries');
        await db.exec('DELETE FROM profile');
        // Gear tables — additive. Snapshots from cloud_schema_version < 3
        // don't carry these arrays; the local tables come back empty in that
        // case (we still wipe so a v3 → v2 → v3 round-trip stays consistent).
        await db.exec('DELETE FROM gear_inspections');
        await db.exec('DELETE FROM gear');

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
            rehydratedCard, null, p.photos_in_backup ? 1 : 0, snap.exported_at,
            snap.backup_id, p.created_at, p.updated_at,
          ],
          );

          try {
            if (p.cert_expires_on) {
              await scheduleCertExpiryNotifications(p.cert_expires_on);
            }
          } catch {}

          for (const e of snap.entries) {
          const rehydratedPhotos = e.photo_paths.map(rehydrateAppPath);
          // Back-compat: a v1 cloud snapshot serialized entries with a single
          // `date` field and no range or other-work-description columns.
          const legacy = e as unknown as { date?: string };
          const dateFrom = e.date_from ?? legacy.date ?? '';
          const dateTo = e.date_to ?? legacy.date ?? dateFrom;
          const otherDesc = e.other_work_description ?? null;
          // `date` stays populated from date_from so v1/v2 hashes on restored
          // signed entries keep verifying.
          await db.run(
            `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours,
              tech_level_snapshot, work_types, other_work_description, equipment_notes, weather, photo_paths, status,
              amends_entry_id, amendment_reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              e.id, dateFrom, dateFrom, dateTo,
              e.employer, e.site, e.client, e.description, e.work_hours,
              e.tech_level_snapshot, JSON.stringify(e.work_types), otherDesc,
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

        // Gear inventory (cloud_schema_version 3). Pre-feature snapshots have
        // no `gear` field — `?? []` keeps the loops empty in that case.
        for (const g of snap.gear ?? []) {
          const rehydratedPhoto = g.photo_path ? rehydrateAppPath(g.photo_path) : null;
          await db.run(
            `INSERT INTO gear (id, name, category, manufacturer, model, serial_number,
                manufacture_date, first_use_date, retired_at, retirement_reason,
                inspection_interval_months, next_inspection_due, photo_path, notes,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              g.id, g.name, g.category, g.manufacturer, g.model, g.serial_number,
              g.manufacture_date, g.first_use_date, g.retired_at, g.retirement_reason,
              g.inspection_interval_months, g.next_inspection_due, rehydratedPhoto,
              g.notes, g.created_at, g.updated_at,
            ],
          );
        }
        for (const insp of snap.gear_inspections ?? []) {
          const rehydratedCert = insp.cert_photo_path ? rehydrateAppPath(insp.cert_photo_path) : null;
          await db.run(
            `INSERT INTO gear_inspections (id, gear_id, inspected_on, result, inspector_name, notes, cert_photo_path, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              insp.id, insp.gear_id, insp.inspected_on, insp.result,
              insp.inspector_name, insp.notes, rehydratedCert, insp.created_at,
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
      const session = await cloud.getSession();
      if (!session) throw new Error('not_authenticated');
      await cloud.deletePrefix(`${session.user_id}/`);
      await AsyncStorage.removeItem('logbook:last_uploaded_manifest');
    },
  };
}
