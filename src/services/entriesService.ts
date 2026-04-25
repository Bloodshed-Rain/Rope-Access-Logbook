// src/services/entriesService.ts
import { DbClient } from '../db/client';
import { Entry, EntryRow, CreateEntryInput, UpdateEntryInput, SpratLevel, CertLevel } from '../types';
import { generateId } from '../utils/uuid';

type UuidFn = () => string;

function rowToEntry(row: EntryRow): Entry {
  // date_from / date_to are NOT NULL on new writes, but a legacy row inserted
  // before the migration could still have them NULL before the backfill runs.
  // Fall back to the legacy date column in that case.
  const dateFrom = row.date_from ?? row.date;
  const dateTo = row.date_to ?? row.date;
  return {
    id: row.id,
    date_from: dateFrom,
    date_to: dateTo,
    employer: row.employer,
    site: row.site,
    client: row.client,
    description: row.description,
    work_hours: row.work_hours,
    tech_level_snapshot: row.tech_level_snapshot,
    irata_level_snapshot: row.irata_level_snapshot ?? null,
    work_types: JSON.parse(row.work_types),
    other_work_description: row.other_work_description,
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

export function createEntriesService(db: DbClient, uuid: UuidFn = generateId) {
  return {
    async createEntry(input: CreateEntryInput, techLevel: SpratLevel, iratLevel: CertLevel | null = null): Promise<Entry> {
      const now = new Date().toISOString();
      const id = uuid();
      const today = now.substring(0, 10);
      const dateFrom = input.date_from ?? today;
      const dateTo = input.date_to ?? dateFrom;
      // `date` column kept in sync with date_from so legacy v1/v2 hash algorithms
      // that still read it continue to work for newly-written rows.
      await db.run(
        `INSERT INTO entries (id, date, date_from, date_to, employer, site, client, description, work_hours, tech_level_snapshot, irata_level_snapshot, work_types, other_work_description, equipment_notes, weather, photo_paths, status, amends_entry_id, amendment_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [
          id, dateFrom, dateFrom, dateTo,
          input.employer ?? '', input.site ?? '', input.client ?? '', input.description ?? '',
          input.work_hours ?? 0, techLevel, iratLevel, JSON.stringify(input.work_types ?? []),
          input.other_work_description ?? null,
          input.equipment_notes ?? null, input.weather ?? null,
          JSON.stringify(input.photo_paths ?? []),
          input.amends_entry_id ?? null, input.amendment_reason ?? null, now, now,
        ],
      );
      return (await this.getEntry(id))!;
    },

    async getEntry(id: string): Promise<Entry | null> {
      const row = await db.get<EntryRow>('SELECT * FROM entries WHERE id = ?', [id]);
      return row ? rowToEntry(row) : null;
    },

    async listEntries(): Promise<Entry[]> {
      const rows = await db.getAll<EntryRow>('SELECT * FROM entries ORDER BY date DESC, created_at DESC');
      return rows.map(rowToEntry);
    },

    async updateEntry(id: string, input: UpdateEntryInput): Promise<Entry> {
      const existing = await this.getEntry(id);
      if (!existing) throw new Error('Entry not found');
      if (existing.status === 'signed') throw new Error('Cannot modify a signed entry');
      if (existing.pending_sign_request_id) throw new Error('entry_locked_pending_request');

      const fields: string[] = [];
      const values: unknown[] = [];

      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (key === 'work_types') {
          fields.push('work_types = ?');
          values.push(JSON.stringify(value));
        } else if (key === 'photo_paths') {
          fields.push('photo_paths = ?');
          values.push(JSON.stringify(value));
        } else if (key === 'date_from') {
          // Keep the legacy `date` column in sync with date_from so v1/v2 hashes
          // of any pre-v3-signed rows keep verifying after the update.
          fields.push('date_from = ?', 'date = ?');
          values.push(value, value);
        } else {
          fields.push(`${key} = ?`);
          values.push(value);
        }
      }

      if (fields.length === 0) return existing;

      const now = new Date().toISOString();
      fields.push('updated_at = ?');
      values.push(now);
      values.push(id);

      await db.run(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`, values);
      return (await this.getEntry(id))!;
    },

    async deleteEntry(id: string): Promise<void> {
      const entry = await this.getEntry(id);
      if (!entry) throw new Error('Entry not found');
      if (entry.status === 'signed') {
        const hasSignedAmendment = await db.get<{ id: string }>(
          "SELECT id FROM entries WHERE amends_entry_id = ? AND status = 'signed'", [id],
        );
        if (hasSignedAmendment) throw new Error('Cannot delete an entry with a signed amendment');
        throw new Error('Cannot delete a signed entry');
      }
      if (entry.pending_sign_request_id) throw new Error('entry_locked_pending_request');
      await db.run('DELETE FROM entries WHERE id = ?', [id]);
    },

    async createAmendment(originalEntryId: string, reason: string, techLevel: SpratLevel, iratLevel: CertLevel | null = null): Promise<Entry> {
      const original = await this.getEntry(originalEntryId);
      if (!original) throw new Error('Entry not found');
      if (original.status !== 'signed') throw new Error('Can only amend signed entries');

      return this.createEntry(
        {
          date_from: original.date_from,
          date_to: original.date_to,
          employer: original.employer,
          site: original.site,
          client: original.client,
          description: original.description,
          work_hours: original.work_hours,
          work_types: original.work_types,
          other_work_description: original.other_work_description,
          equipment_notes: original.equipment_notes ?? undefined,
          weather: original.weather ?? undefined,
          photo_paths: [...original.photo_paths],
          amends_entry_id: originalEntryId,
          amendment_reason: reason,
        },
        techLevel,
        iratLevel,
      );
    },

    async getTotalWorkHours(year: number): Promise<number> {
      const result = await db.get<{ total: number | null }>(
        "SELECT SUM(work_hours) as total FROM entries WHERE status = 'signed' AND date LIKE ?",
        [`${year}%`],
      );
      return result?.total ?? 0;
    },

    async getAmendmentForEntry(entryId: string): Promise<Entry | null> {
      const row = await db.get<EntryRow>('SELECT * FROM entries WHERE amends_entry_id = ?', [entryId]);
      return row ? rowToEntry(row) : null;
    },

    async getOriginalEntry(amendmentEntryId: string): Promise<Entry | null> {
      const amendment = await this.getEntry(amendmentEntryId);
      if (!amendment?.amends_entry_id) return null;
      return this.getEntry(amendment.amends_entry_id);
    },

    async getLifetimeHoursByLevel(): Promise<Record<SpratLevel, number>> {
      const rows = await db.getAll<{ tech_level_snapshot: SpratLevel; total: number }>(
        "SELECT tech_level_snapshot, SUM(work_hours) as total FROM entries WHERE status = 'signed' GROUP BY tech_level_snapshot",
      );
      const result: Record<SpratLevel, number> = { I: 0, II: 0, III: 0 };
      for (const row of rows) {
        result[row.tech_level_snapshot] = row.total;
      }
      return result;
    },
  };
}
