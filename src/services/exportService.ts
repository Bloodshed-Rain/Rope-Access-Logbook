// src/services/exportService.ts
import { DbClient } from '../db/client';
import { Profile, Entry, EntryRow, Signature, JsonBackup } from '../types';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { pdfStyles } from '../templates/pdfStyles';
import { renderCoverPageHtml } from '../templates/coverPageHtml';
import { renderEntryPageHtml } from '../templates/entryPageHtml';
import { renderSummaryPageHtml } from '../templates/summaryPageHtml';
import { SpratLevel } from '../types';

function rowToEntry(row: EntryRow): Entry {
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
        schema_version: 2,
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
      const froms = signedEntries.map((e) => e.date_from).sort();
      const tos = signedEntries.map((e) => e.date_to).sort();
      const dateRange = {
        earliest: froms[0] ?? 'N/A',
        latest: tos[tos.length - 1] ?? 'N/A',
      };

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
        const year = parseInt(e.date_from.substring(0, 4));
        hoursByYear[year] = (hoursByYear[year] ?? 0) + e.work_hours;
        for (const wt of e.work_types) {
          hoursByWorkType[wt] = (hoursByWorkType[wt] ?? 0) + e.work_hours;
        }
      }

      const amendments = entries.filter((e) => e.amends_entry_id && e.amendment_reason)
        .map((e) => {
          const original = entries.find((o) => o.id === e.amends_entry_id);
          return {
            originalDate: original?.date_from ?? '?',
            amendmentDate: e.date_from,
            reason: e.amendment_reason!,
          };
        });

      const summaryHtml = renderSummaryPageHtml({ hoursByYear, hoursByWorkType, amendments });

      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${pdfStyles}</style></head><body>${coverHtml}${entryPages}${summaryHtml}</body></html>`;

      const { uri } = await Print.printToFileAsync({ html: fullHtml });
      return uri;
    },

    async exportAsCsv(entries: Entry[], signatures: Signature[]): Promise<string> {
      const header = ['Date From', 'Date To', 'Employer', 'Site', 'Client', 'Work Hours', 'Work Types', 'Status', 'Supervisor Name', 'Supervisor Cert'];
      const rows = entries.map(e => {
        const sig = signatures.find(s => s.entry_id === e.id);
        const types = e.work_types.join(';');
        return [
          e.date_from,
          e.date_to,
          `"${e.employer.replace(/"/g, '""')}"`,
          `"${e.site.replace(/"/g, '""')}"`,
          `"${e.client.replace(/"/g, '""')}"`,
          e.work_hours.toString(),
          `"${types}"`,
          e.status,
          `"${sig?.supervisor_name?.replace(/"/g, '""') ?? ''}"`,
          `"${sig?.supervisor_cert_number?.replace(/"/g, '""') ?? ''}"`
        ].join(',');
      });

      const csv = [header.join(','), ...rows].join('\n');
      const uri = `${FileSystem.cacheDirectory}logbook-export.csv`;
      await FileSystem.writeAsStringAsync(uri, csv);
      return uri;
    },
  };
}
