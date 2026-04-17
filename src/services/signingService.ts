// src/services/signingService.ts
import { DbClient } from '../db/client';
import { Signature, CreateSignatureInput, EntryRow, HashFn } from '../types';
import { canonicalize } from '../utils/canonical';
import { sha256 } from '../utils/hash';
import { generateId } from '../utils/uuid';
import { normalizeAppPath } from '../utils/paths';

type UuidFn = () => string;

// FROZEN: v1 algorithm is retained permanently so that signatures whose v1 hash
// failed verification at migration time (and were left at hash_version=1) remain
// checkable. Do not modify this function — changes would break existing v1 signatures.
function entryRowToHashInputV1(row: EntryRow): Record<string, unknown> {
  return {
    id: row.id,
    date: row.date,
    employer: row.employer,
    site: row.site,
    client: row.client,
    description: row.description,
    work_hours: row.work_hours,
    tech_level_snapshot: row.tech_level_snapshot,
    work_types: row.work_types,
    equipment_notes: row.equipment_notes,
    weather: row.weather,
    photo_paths: row.photo_paths,
    status: row.status,
    amends_entry_id: row.amends_entry_id,
    amendment_reason: row.amendment_reason,
  };
}

// v2: normalizes photo_paths to relative form so hashes are portable across
// device reinstalls (where documentDirectory's per-install UUID changes).
function entryRowToHashInputV2(row: EntryRow): Record<string, unknown> {
  const parsedPaths: string[] = JSON.parse(row.photo_paths);
  const normalized = parsedPaths.map(normalizeAppPath);
  return {
    id: row.id,
    date: row.date,
    employer: row.employer,
    site: row.site,
    client: row.client,
    description: row.description,
    work_hours: row.work_hours,
    tech_level_snapshot: row.tech_level_snapshot,
    work_types: row.work_types,
    equipment_notes: row.equipment_notes,
    weather: row.weather,
    photo_paths: normalized,
    status: row.status,
    amends_entry_id: row.amends_entry_id,
    amendment_reason: row.amendment_reason,
  };
}

export const CURRENT_HASH_VERSION = 2;

export function createSigningService(db: DbClient, hashFn: HashFn = sha256, uuid: UuidFn = generateId) {
  async function computeEntryHash(entryId: string, version: number): Promise<string> {
    const row = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [entryId]);
    if (!row) throw new Error('Entry not found');
    let input: Record<string, unknown>;
    if (version === 2) {
      input = entryRowToHashInputV2(row);
    } else if (version === 1) {
      input = entryRowToHashInputV1(row);
    } else {
      throw new Error(`Unsupported hash_version: ${version}. Please update the app.`);
    }
    const canonical = canonicalize(input);
    return hashFn(canonical);
  }

  return {
    async signEntry(input: CreateSignatureInput): Promise<Signature> {
      const entry = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [input.entry_id]);
      if (!entry) throw new Error('Entry not found');
      if (entry.status !== 'draft') throw new Error('Entry is not in draft status');

      const now = new Date().toISOString();
      const id = uuid();

      await db.run("UPDATE entries SET status = 'signed', updated_at = ? WHERE id = ?", [now, input.entry_id]);

      const entryHash = await computeEntryHash(input.entry_id, CURRENT_HASH_VERSION);

      await db.run(
        `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, gps_lat, gps_lon, entry_hash, hash_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.entry_id, input.supervisor_name, input.supervisor_cert_number,
          input.signature_png_path, now, input.device_id,
          input.gps_lat ?? null, input.gps_lon ?? null,
          entryHash, CURRENT_HASH_VERSION, now,
        ],
      );

      return (await this.getSignatureForEntry(input.entry_id))!;
    },

    async verifyIntegrity(entryId: string): Promise<{ valid: boolean; storedHash: string; computedHash: string; hashVersion: number }> {
      const signature = await this.getSignatureForEntry(entryId);
      if (!signature) throw new Error('No signature found for entry');
      const computedHash = await computeEntryHash(entryId, signature.hash_version);
      return {
        valid: computedHash === signature.entry_hash,
        storedHash: signature.entry_hash,
        computedHash,
        hashVersion: signature.hash_version,
      };
    },

    async getSignatureForEntry(entryId: string): Promise<Signature | null> {
      return db.get<Signature>('SELECT * FROM signatures WHERE entry_id = ?', [entryId]);
    },

    async getAllSignatures(): Promise<Signature[]> {
      return db.getAll<Signature>('SELECT * FROM signatures ORDER BY signed_at DESC');
    },

    async computeEntryHashForVersion(entryId: string, version: number): Promise<string> {
      return computeEntryHash(entryId, version);
    },
  };
}
