// src/services/signingService.ts
import { DbClient } from '../db/client';
import { Signature, CreateSignatureInput, EntryRow, HashFn } from '../types';
import { canonicalize } from '../utils/canonical';
import { sha256 } from '../utils/hash';
import { generateId } from '../utils/uuid';

type UuidFn = () => string;

function entryRowToHashInput(row: EntryRow): Record<string, unknown> {
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

export function createSigningService(db: DbClient, hashFn: HashFn = sha256, uuid: UuidFn = generateId) {
  async function computeEntryHash(entryId: string): Promise<string> {
    const row = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [entryId]);
    if (!row) throw new Error('Entry not found');
    const canonical = canonicalize(entryRowToHashInput(row));
    return hashFn(canonical);
  }

  return {
    async signEntry(input: CreateSignatureInput): Promise<Signature> {
      const entry = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [input.entry_id]);
      if (!entry) throw new Error('Entry not found');
      if (entry.status !== 'draft') throw new Error('Entry is not in draft status');

      const now = new Date().toISOString();
      const id = uuid();

      // Update status to 'signed' before computing the hash so that sign-time
      // and verify-time both hash the same row (with status = 'signed').
      await db.run("UPDATE entries SET status = 'signed', updated_at = ? WHERE id = ?", [now, input.entry_id]);

      const entryHash = await computeEntryHash(input.entry_id);

      await db.run(
        `INSERT INTO signatures (id, entry_id, supervisor_name, supervisor_cert_number, signature_png_path, signed_at, device_id, gps_lat, gps_lon, entry_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.entry_id, input.supervisor_name, input.supervisor_cert_number,
          input.signature_png_path, now, input.device_id,
          input.gps_lat ?? null, input.gps_lon ?? null,
          entryHash, now,
        ],
      );

      return (await this.getSignatureForEntry(input.entry_id))!;
    },

    async verifyIntegrity(entryId: string): Promise<{ valid: boolean; storedHash: string; computedHash: string }> {
      const signature = await this.getSignatureForEntry(entryId);
      if (!signature) throw new Error('No signature found for entry');
      const computedHash = await computeEntryHash(entryId);
      return {
        valid: computedHash === signature.entry_hash,
        storedHash: signature.entry_hash,
        computedHash,
      };
    },

    async getSignatureForEntry(entryId: string): Promise<Signature | null> {
      return db.get<Signature>('SELECT * FROM signatures WHERE entry_id = ?', [entryId]);
    },

    async getAllSignatures(): Promise<Signature[]> {
      return db.getAll<Signature>('SELECT * FROM signatures ORDER BY signed_at DESC');
    },
  };
}
