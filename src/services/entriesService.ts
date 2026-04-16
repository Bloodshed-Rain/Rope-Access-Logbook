// src/services/entriesService.ts
import { DbClient } from '../db/client';
import { Entry, EntryRow, CreateEntryInput, UpdateEntryInput, SpratLevel } from '../types';
import { generateId } from '../utils/uuid';

type UuidFn = () => string;

function rowToEntry(row: EntryRow): Entry {
  return {
    ...row,
    work_types: JSON.parse(row.work_types),
    photo_paths: JSON.parse(row.photo_paths),
  };
}

export function createEntriesService(db: DbClient, uuid: UuidFn = generateId) {
  return {
    async createEntry(input: CreateEntryInput, techLevel: SpratLevel): Promise<Entry> {
      const now = new Date().toISOString();
      const id = uuid();
      await db.run(
        `INSERT INTO entries (id, date, employer, site, client, description, work_hours, tech_level_snapshot, work_types, equipment_notes, weather, photo_paths, status, amends_entry_id, amendment_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [
          id, input.date, input.employer, input.site, input.client, input.description,
          input.work_hours, techLevel, JSON.stringify(input.work_types),
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
      await db.run('DELETE FROM entries WHERE id = ?', [id]);
    },

    async createAmendment(originalEntryId: string, reason: string, techLevel: SpratLevel): Promise<Entry> {
      const original = await this.getEntry(originalEntryId);
      if (!original) throw new Error('Entry not found');
      if (original.status !== 'signed') throw new Error('Can only amend signed entries');

      return this.createEntry(
        {
          date: original.date,
          employer: original.employer,
          site: original.site,
          client: original.client,
          description: original.description,
          work_hours: original.work_hours,
          work_types: original.work_types,
          equipment_notes: original.equipment_notes ?? undefined,
          weather: original.weather ?? undefined,
          photo_paths: [...original.photo_paths],
          amends_entry_id: originalEntryId,
          amendment_reason: reason,
        },
        techLevel,
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
