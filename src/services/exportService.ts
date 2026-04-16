// src/services/exportService.ts
import { DbClient } from '../db/client';
import { Profile, Entry, EntryRow, Signature, JsonBackup } from '../types';

function rowToEntry(row: EntryRow): Entry {
  return {
    ...row,
    work_types: JSON.parse(row.work_types),
    photo_paths: JSON.parse(row.photo_paths),
  };
}

export function createExportService(db: DbClient) {
  return {
    async exportAsJson(appVersion: string): Promise<JsonBackup> {
      const profile = await db.get<Profile>('SELECT * FROM profile LIMIT 1');
      if (!profile) throw new Error('No profile found');

      const entryRows = await db.getAll<EntryRow>('SELECT * FROM entries ORDER BY date ASC, created_at ASC');
      const entries = entryRows.map(rowToEntry);

      const signatures = await db.getAll<Signature>('SELECT * FROM signatures ORDER BY signed_at ASC');

      return {
        app_version: appVersion,
        exported_at: new Date().toISOString(),
        profile,
        entries,
        signatures,
        schema_version: 1,
      };
    },
  };
}
