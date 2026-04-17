import AsyncStorage from '@react-native-async-storage/async-storage';
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import {
  BackupResult, BinaryManifest, BinaryManifestEntry, CloudSnapshot,
  HashFn, Profile, Signature, Entry,
} from '../types';
import { createExportService } from './exportService';
import { normalizeAppPath } from '../utils/paths';

const THROTTLE_MS = 30_000;
const MANIFEST_CACHE_KEY = 'logbook:last_uploaded_manifest';

export interface CloudBackupDeps {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  hash: HashFn;
  exportService: ReturnType<typeof createExportService>;
  clock: () => string;
  appVersion: string;
  uuid?: () => string;
}

function genBackupId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

export function createCloudBackupService(deps: CloudBackupDeps) {
  const { db, cloud, fs, hash, exportService, clock, appVersion } = deps;
  const makeBackupId = deps.uuid ?? genBackupId;
  let lastBackupAt = 0;
  let inFlight: Promise<BackupResult> | null = null;
  let lastSignaturesCount = -1;

  async function loadCachedManifest(): Promise<BinaryManifest> {
    const raw = await AsyncStorage.getItem(MANIFEST_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  }
  async function saveCachedManifest(m: BinaryManifest): Promise<void> {
    await AsyncStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(m));
  }

  async function buildAssetRef(fsPath: string, storageKeyBase: string): Promise<{ key: string; bytes: Uint8Array; entry: BinaryManifestEntry }> {
    const bytes = await fs.readAsBytes(fsPath);
    const sha = await fs.getSha256(fsPath);
    const size = bytes.length;
    return {
      key: storageKeyBase,
      bytes,
      entry: { sha256: sha, size_bytes: size, created_at: clock() },
    };
  }

  async function doBackup(): Promise<BackupResult> {
    const uid = (await cloud.getSession())?.user_id;
    if (!uid) return { kind: 'skipped_no_auth' };

    if (!(await cloud.isOnline())) return { kind: 'skipped_offline' };

    const profile = await db.get<Profile>('SELECT * FROM profile LIMIT 1');
    if (!profile) return { kind: 'skipped_no_auth' };
    const photosIncluded = !!profile.photos_in_backup;

    const base = await exportService.exportAsJson(appVersion);

    const binary_manifest: BinaryManifest = {};
    const assetsToUpload: Array<{ key: string; bytes: Uint8Array }> = [];

    for (const sig of base.signatures) {
      if (!sig.signature_png_path) continue;
      const ref = await buildAssetRef(sig.signature_png_path, `assets/sig_${sig.id}.png`);
      binary_manifest[ref.key] = ref.entry;
      assetsToUpload.push({ key: ref.key, bytes: ref.bytes });
    }

    if (profile.sprat_card_photo_path) {
      const ext = profile.sprat_card_photo_path.split('.').pop() ?? 'jpg';
      const ref = await buildAssetRef(profile.sprat_card_photo_path, `assets/spratcard_${profile.id}.${ext}`);
      binary_manifest[ref.key] = ref.entry;
      assetsToUpload.push({ key: ref.key, bytes: ref.bytes });
    }

    if (photosIncluded) {
      for (const e of base.entries) {
        for (let i = 0; i < e.photo_paths.length; i++) {
          const p = e.photo_paths[i];
          const ext = p.split('.').pop() ?? 'jpg';
          const ref = await buildAssetRef(p, `assets/photo_${e.id}_${i}.${ext}`);
          binary_manifest[ref.key] = ref.entry;
          assetsToUpload.push({ key: ref.key, bytes: ref.bytes });
        }
      }
    }

    const profileForSnapshot: Profile = {
      ...base.profile,
      sprat_card_photo_path: base.profile.sprat_card_photo_path
        ? normalizeAppPath(base.profile.sprat_card_photo_path)
        : null,
    };
    const entriesForSnapshot: Entry[] = base.entries.map((e) => ({
      ...e,
      photo_paths: e.photo_paths.map(normalizeAppPath),
    }));
    const signaturesForSnapshot: Signature[] = base.signatures.map((s) => ({
      ...s,
      signature_png_path: normalizeAppPath(s.signature_png_path),
    }));

    const backup_id = makeBackupId();
    const snapshot: CloudSnapshot = {
      ...base,
      profile: profileForSnapshot,
      entries: entriesForSnapshot,
      signatures: signaturesForSnapshot,
      cloud_schema_version: 1,
      backup_id,
      binary_manifest,
      photos_included: photosIncluded,
    };

    const cached = await loadCachedManifest();

    for (const { key, bytes } of assetsToUpload) {
      const cachedEntry = cached[key];
      if (cachedEntry && cachedEntry.sha256 === binary_manifest[key].sha256) {
        continue;
      }
      await cloud.uploadObject(`${uid}/${key}`, bytes, 'application/octet-stream');
    }

    for (const key of Object.keys(cached)) {
      if (!binary_manifest[key]) {
        try {
          await cloud.deleteObject(`${uid}/${key}`);
        } catch {
          // Best-effort; continue
        }
      }
    }

    const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot));
    await cloud.uploadObject(`${uid}/snapshot.json`, snapshotBytes, 'application/json');

    await saveCachedManifest(binary_manifest);
    const now = clock();
    await db.run(
      'UPDATE profile SET last_cloud_backup_at = ?, last_uploaded_backup_id = ?, updated_at = ? WHERE id = ?',
      [now, backup_id, now, profile.id],
    );
    lastBackupAt = Date.now();
    lastSignaturesCount = base.signatures.length;

    return { kind: 'uploaded', backup_id, bytes_uploaded: snapshotBytes.length };
  }

  // Suppress unused-variable warning for hash — it's kept in deps for future tasks.
  void hash;

  return {
    async backup(): Promise<BackupResult> {
      const profile = await db.get<Profile>('SELECT * FROM profile LIMIT 1');
      const sigsCount = (await db.getAll<Signature>('SELECT id FROM signatures')).length;
      if (Date.now() - lastBackupAt < THROTTLE_MS && sigsCount === lastSignaturesCount && profile?.last_uploaded_backup_id) {
        return { kind: 'throttled' };
      }
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          return await doBackup();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('quota')) return { kind: 'failed', reason: 'quota', message: msg };
          if (msg.includes('offline')) return { kind: 'skipped_offline' };
          if (msg.includes('upload_failed')) return { kind: 'failed', reason: 'asset_failed', message: msg };
          return { kind: 'failed', reason: 'unknown', message: msg };
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },

    async getLastBackupStatus(): Promise<{ last_cloud_backup_at: string | null; last_uploaded_backup_id: string | null }> {
      const profile = await db.get<Profile>('SELECT last_cloud_backup_at, last_uploaded_backup_id FROM profile LIMIT 1');
      return {
        last_cloud_backup_at: profile?.last_cloud_backup_at ?? null,
        last_uploaded_backup_id: profile?.last_uploaded_backup_id ?? null,
      };
    },
  };
}
