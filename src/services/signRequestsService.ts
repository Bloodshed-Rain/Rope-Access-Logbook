import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import { Entry, EntryRow, SignRequest, HashFn, Signature } from '../types';
import { computeEntryHashFromPayload } from '../utils/entryPayloadHash';
import {
  saveSignaturePng,
  saveSignRequestPhoto,
  deleteSignRequestPhotosDir,
  signRequestPhotoPath,
} from '../utils/fileStorage';
import { generateId } from '../utils/uuid';

type Clock = () => string;
type UuidFn = () => string;

const EXPIRATION_DAYS = 30;

export function getLocalPhotoPathsFromCache(row: { local_photo_paths_json: string | null }): {
  paths: string[];
  missingCount: number;
  pending: boolean;
} {
  if (row.local_photo_paths_json == null) {
    return { paths: [], missingCount: 0, pending: true };
  }
  const paths = JSON.parse(row.local_photo_paths_json) as string[];
  const missingCount = paths.filter(p => p === '').length;
  return { paths, missingCount, pending: false };
}

export function createSignRequestsService(
  db: DbClient,
  cloud: CloudClient,
  fs: FileSystemAbstraction,
  hash: HashFn,
  clock: Clock = () => new Date().toISOString(),
  uuid: UuidFn = generateId,
) {
  async function cacheRow(row: SignRequest): Promise<void> {
    await db.run(
      `INSERT OR REPLACE INTO sign_requests_cache
         (id, tech_user_id, supervisor_user_id, entry_id, status,
          decline_reason, signed_at, created_at, expires_at, updated_at, payload_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        row.id, row.tech_user_id, row.supervisor_user_id,
        (row.entry_payload as Entry).id, row.status, row.decline_reason,
        row.signed_at, row.created_at, row.expires_at, row.updated_at,
        JSON.stringify(row),
      ],
    );
  }

  async function getMaxUpdatedAt(): Promise<string | undefined> {
    const r = await db.get<{ max: string | null }>(
      'SELECT MAX(updated_at) as max FROM sign_requests_cache',
    );
    return r?.max ?? undefined;
  }

  function rowToEntry(row: EntryRow): Entry {
    return {
      id: row.id,
      date_from: row.date_from ?? row.date,
      date_to: row.date_to ?? row.date,
      employer: row.employer,
      site: row.site,
      client: row.client,
      description: row.description,
      work_hours: row.work_hours,
      tech_level_snapshot: row.tech_level_snapshot,
      work_types: JSON.parse(row.work_types),
      other_work_description: row.other_work_description ?? null,
      equipment_notes: row.equipment_notes,
      weather: row.weather,
      photo_paths: JSON.parse(row.photo_paths),
      status: row.status,
      amends_entry_id: row.amends_entry_id,
      amendment_reason: row.amendment_reason,
      pending_sign_request_id: row.pending_sign_request_id ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async function sendRequest(args: { entry_id: string; connection_id: string; supervisor_user_id: string }): Promise<SignRequest> {
    const row = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [args.entry_id]);
    if (!row) throw new Error('Entry not found');
    if (row.status !== 'draft') throw new Error('Entry not in draft status');
    if (row.pending_sign_request_id) throw new Error('entry_locked_pending_request');
    if (!row.date_from || !row.date_to || row.work_hours <= 0 || !row.description?.trim()) {
      throw new Error('missing_required');
    }

    const entry = rowToEntry(row);

    // Per-photo manifest: hash the bytes on disk via fs.getSha256 to match
    // the convention used by cloudBackupService (see fsAbstraction.getSha256).
    const manifest: Record<string, { sha256: string; size_bytes: number }> = {};
    const uploads: Array<{ key: string; bytes: Uint8Array }> = [];
    for (let i = 0; i < entry.photo_paths.length; i++) {
      const path = entry.photo_paths[i];
      const bytes = await fs.readAsBytes(path);
      const sha256 = await fs.getSha256(path);
      const size_bytes = await fs.getSize(path);
      const ext = path.split('.').pop() ?? 'jpg';
      const key = `sign-requests/PENDING/photo_${entry.id}_${i}.${ext}`;
      manifest[key] = { sha256, size_bytes };
      uploads.push({ key, bytes });
    }

    const expiresAt = new Date(Date.now() + EXPIRATION_DAYS * 24 * 3600_000).toISOString();

    const cloudRow = await cloud.sendSignRequest({
      connection_id: args.connection_id,
      supervisor_user_id: args.supervisor_user_id,
      entry_payload: entry,
      assets_manifest: manifest,
      asset_uploads: uploads,
      expires_at: expiresAt,
    });

    await db.run(
      'UPDATE entries SET pending_sign_request_id = ?, updated_at = ? WHERE id = ?',
      [cloudRow.id, clock(), entry.id],
    );
    await cacheRow(cloudRow);
    return cloudRow;
  }

  async function withdraw(id: string): Promise<SignRequest> {
    const row = await cloud.withdrawRequest(id);
    await cacheRow(row);
    const entryId = (row.entry_payload as Entry).id;
    await db.run(
      'UPDATE entries SET pending_sign_request_id = NULL, updated_at = ? WHERE id = ? AND pending_sign_request_id = ?',
      [clock(), entryId, row.id],
    );
    return row;
  }

  async function decline(id: string, reason: string): Promise<SignRequest> {
    const row = await cloud.declineRequest(id, reason);
    await cacheRow(row);
    return row;
  }

  async function sign(args: {
    request_id: string; png_base64: string; supervisor_name: string;
    supervisor_cert_number: string; device_id: string;
    gps_lat?: number; gps_lon?: number;
  }): Promise<SignRequest> {
    const cached = await db.get<{ payload_json: string }>(
      'SELECT payload_json FROM sign_requests_cache WHERE id = ?',
      [args.request_id],
    );
    if (!cached) throw new Error('request_not_found_in_cache');
    const req = JSON.parse(cached.payload_json) as SignRequest;
    const entry = req.entry_payload as Entry;
    const entry_hash = await computeEntryHashFromPayload(entry, hash, 3);
    const png_bytes = Uint8Array.from(Buffer.from(args.png_base64, 'base64'));
    const result = await cloud.signRequest({
      request_id: args.request_id,
      png_bytes,
      supervisor_name: args.supervisor_name,
      supervisor_cert_number: args.supervisor_cert_number,
      entry_hash,
      hash_version: 3,
      signed_device_id: args.device_id,
      signed_gps_lat: args.gps_lat,
      signed_gps_lon: args.gps_lon,
    });
    await cacheRow(result);
    return result;
  }

  async function applyIncomingSignature(row: SignRequest): Promise<Signature> {
    if (row.status !== 'signed') throw new Error('not_signed');
    const entry = row.entry_payload as Entry;

    // Idempotency: if a signature already exists for this entry, short-circuit.
    const existing = await db.get<Signature>('SELECT * FROM signatures WHERE entry_id = ?', [entry.id]);
    if (existing) return existing;

    // Download PNG (best-effort — quarantine on failure so the signature row
    // still lands and the UI can surface a "signature image missing" banner).
    let localPngPath = '';
    if (row.signature_png_path) {
      try {
        // signature_png_path is stored as "sign-requests/{id}/sig.png" — strip the bucket prefix
        // before calling the bucket-specific download.
        const bucketKey = (row.signature_png_path ?? '').replace(/^sign-requests\//, '');
        const bytes = await cloud.downloadSignRequestAsset(bucketKey);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = Buffer.from(binary, 'binary').toString('base64');
        const sigFileId = uuid();
        localPngPath = await saveSignaturePng(base64, sigFileId);
      } catch {
        localPngPath = '';
      }
    }

    const now = clock();
    const sigId = uuid();
    await db.run(
      `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, gps_lat, gps_lon, entry_hash, hash_version, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        sigId, entry.id,
        row.supervisor_name_snapshot ?? '',
        row.supervisor_cert_number_snapshot ?? '',
        localPngPath,
        row.signed_at ?? now,
        row.signed_device_id ?? 'unknown',
        row.signed_gps_lat, row.signed_gps_lon,
        row.entry_hash ?? '',
        row.hash_version ?? 3,
        now,
      ],
    );
    await db.run(
      `UPDATE entries SET status='signed', pending_sign_request_id=NULL, updated_at=? WHERE id=?`,
      [now, entry.id],
    );
    return (await db.get<Signature>('SELECT * FROM signatures WHERE id = ?', [sigId]))!;
  }

  const PHOTO_BASENAME_RE = /^photo_[^_]+_(\d+)\.[^.]+$/;

  function parsePhotoIndex(basename: string): number | null {
    const m = basename.match(PHOTO_BASENAME_RE);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isInteger(n) ? n : null;
  }

  async function downloadRequestPhotos(row: SignRequest): Promise<{ localPaths: string[]; failed: number[] }> {
    const entry = row.entry_payload as Entry;
    const count = entry.photo_paths.length;
    const localPaths: string[] = new Array(count).fill('');
    const failed: number[] = [];

    const manifest = row.assets_manifest as Record<string, { sha256: string; size_bytes: number }>;
    for (const [key, meta] of Object.entries(manifest ?? {})) {
      const basename = key.split('/').pop() ?? '';
      const idx = parsePhotoIndex(basename);
      if (idx === null || idx < 0 || idx >= count) continue;

      try {
        const bucketKey = key.replace(/^sign-requests\//, '');
        const targetPath = signRequestPhotoPath(row.id, basename);

        if (await fs.exists(targetPath)) {
          const existingSha = await fs.getSha256(targetPath);
          if (existingSha === meta.sha256) {
            localPaths[idx] = targetPath;
            continue;
          }
          try { await fs.deletePath(targetPath); } catch {}
        }

        const bytes = await cloud.downloadSignRequestAsset(bucketKey);
        const writtenPath = await saveSignRequestPhoto(fs, row.id, basename, bytes);
        const writtenSha = await fs.getSha256(writtenPath);
        if (writtenSha !== meta.sha256) {
          try { await fs.deletePath(writtenPath); } catch {}
          failed.push(idx);
          continue;
        }
        localPaths[idx] = writtenPath;
      } catch {
        failed.push(idx);
      }
    }

    try {
      await db.run(
        'UPDATE sign_requests_cache SET local_photo_paths_json = ? WHERE id = ?',
        [JSON.stringify(localPaths), row.id],
      );
    } catch {}

    return { localPaths, failed };
  }

  async function cleanupRequestPhotos(row: SignRequest): Promise<void> {
    try {
      await deleteSignRequestPhotosDir(fs, row.id);
      await db.run(
        'UPDATE sign_requests_cache SET local_photo_paths_json = NULL WHERE id = ?',
        [row.id],
      );
    } catch {}
  }

  async function sync(): Promise<void> {
    const since = await getMaxUpdatedAt();
    const rows = await cloud.listSignRequests(since);
    const currentUid = cloud.getCurrentUserId();
    for (const r of rows) {
      await cacheRow(r);
      if (currentUid && r.tech_user_id === currentUid && r.status === 'signed') {
        await applyIncomingSignature(r);
      }
      if (currentUid && r.tech_user_id === currentUid &&
          (r.status === 'withdrawn' || r.status === 'declined' || r.status === 'expired')) {
        const entryId = (r.entry_payload as Entry).id;
        await db.run(
          'UPDATE entries SET pending_sign_request_id = NULL, updated_at = ? WHERE id = ? AND pending_sign_request_id = ?',
          [clock(), entryId, r.id],
        );
      }
    }
  }

  return {
    sync,
    listCached: async (): Promise<SignRequest[]> => {
      const rows = await db.getAll<{ payload_json: string }>(
        'SELECT payload_json FROM sign_requests_cache ORDER BY created_at DESC',
      );
      return rows.map(r => JSON.parse(r.payload_json) as SignRequest);
    },
    sendRequest,
    withdraw,
    decline,
    sign,
    applyIncomingSignature,
    downloadRequestPhotos,
    cleanupRequestPhotos,
  };
}
