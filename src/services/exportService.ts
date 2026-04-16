// src/services/exportService.ts
import { DbClient } from '../db/client';
import { Profile, Entry, EntryRow, Signature, JsonBackup } from '../types';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { pdfStyles } from '../templates/pdfStyles';
import { renderCoverPageHtml } from '../templates/coverPageHtml';
import { renderEntryPageHtml } from '../templates/entryPageHtml';
import { renderSummaryPageHtml } from '../templates/summaryPageHtml';
import { SpratLevel } from '../types';

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

    async exportAsPdf(
      profile: Profile,
      entries: Entry[],
      signatures: Signature[],
      hoursByLevel: Record<SpratLevel, number>,
      appVersion: string,
    ): Promise<string> {
      const signedEntries = entries.filter((e) => e.status === 'signed');
      const totalHours = signedEntries.reduce((sum, e) => sum + e.work_hours, 0);
      const dates = signedEntries.map((e) => e.date).sort();
      const dateRange = { earliest: dates[0] ?? 'N/A', latest: dates[dates.length - 1] ?? 'N/A' };

      const sigMap = new Map<string, Signature>();
      for (const sig of signatures) sigMap.set(sig.entry_id, sig);

      const coverHtml = renderCoverPageHtml({ profile, totalHours, hoursByLevel, dateRange, appVersion });
      const entryPages = entries.map((entry) => {
        const sig = sigMap.get(entry.id) ?? null;
        return renderEntryPageHtml({ entry, signature: sig, integrityValid: sig ? true : null });
      }).join('');

      const hoursByYear: Record<number, number> = {};
      const hoursByWorkType: Record<string, number> = {};
      for (const e of signedEntries) {
        const year = parseInt(e.date.substring(0, 4));
        hoursByYear[year] = (hoursByYear[year] ?? 0) + e.work_hours;
        for (const wt of e.work_types) {
          hoursByWorkType[wt] = (hoursByWorkType[wt] ?? 0) + e.work_hours;
        }
      }

      const amendments = entries.filter((e) => e.amends_entry_id && e.amendment_reason)
        .map((e) => {
          const original = entries.find((o) => o.id === e.amends_entry_id);
          return { originalDate: original?.date ?? '?', amendmentDate: e.date, reason: e.amendment_reason! };
        });

      const summaryHtml = renderSummaryPageHtml({ hoursByYear, hoursByWorkType, amendments });

      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${pdfStyles}</style></head><body>${coverHtml}${entryPages}${summaryHtml}</body></html>`;

      const { uri } = await Print.printToFileAsync({ html: fullHtml });
      return uri;
    },
  };
}
