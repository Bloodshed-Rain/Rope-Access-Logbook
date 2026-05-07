// src/services/gearService.ts
//
// Equipment inventory + per-item inspection records. See
// docs/superpowers/specs/2026-05-04-equipment-inventory-design.md §5.
//
// Pure CRUD over a DbClient with optional notification-scheduling hooks.
// Notifications are injected so the service can be exercised from Node tests
// without touching expo-notifications. The runtime call site (e.g. App.tsx,
// gear screens) wires in the real expo-notifications-backed helpers from
// `src/utils/notifications.ts`.

import { DbClient } from '../db/client';
import {
  CreateGearInput,
  GearItem,
  GearInspection,
  GearInspectionResult,
  LogInspectionInput,
  UpdateGearInput,
} from '../types';
import { generateId } from '../utils/uuid';

type UuidFn = () => string;
type Clock = () => string;

export interface GearNotificationHooks {
  schedule: (gear: GearItem) => Promise<void>;
  cancel: (gearId: string) => Promise<void>;
}

interface GearRow {
  id: string;
  name: string;
  category: GearItem['category'];
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  manufacture_date: string | null;
  first_use_date: string | null;
  retired_at: string | null;
  retirement_reason: string | null;
  inspection_interval_months: number;
  next_inspection_due: string | null;
  photo_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface InspectionRow {
  id: string;
  gear_id: string;
  inspected_on: string;
  result: GearInspectionResult;
  inspector_name: string | null;
  notes: string | null;
  cert_photo_path: string | null;
  created_at: string;
}

function rowToGear(row: GearRow): GearItem {
  return { ...row };
}
function rowToInspection(row: InspectionRow): GearInspection {
  return { ...row };
}

// Add `months` to a YYYY-MM-DD date, clamping the day to the last day of the
// target month (Jan 31 + 1mo → Feb 28/29). Matches Postgres `+ interval`.
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${dateStr}`);
  const totalMonths = (m - 1) + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12; // 0-based
  // Day 0 of next month = last day of target month.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(d, lastDay);
  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function createGearService(
  db: DbClient,
  uuid: UuidFn = generateId,
  clock: Clock = () => new Date().toISOString(),
  notifs?: GearNotificationHooks,
) {
  async function getRow(id: string): Promise<GearRow | null> {
    return await db.get<GearRow>('SELECT * FROM gear WHERE id = ?', [id]);
  }

  async function lastPassInspectionDate(gearId: string): Promise<string | null> {
    const row = await db.get<{ inspected_on: string }>(
      `SELECT inspected_on FROM gear_inspections
         WHERE gear_id = ? AND result IN ('pass', 'pass_with_concerns')
         ORDER BY inspected_on DESC LIMIT 1`,
      [gearId],
    );
    return row?.inspected_on ?? null;
  }

  async function computeNextDue(item: GearRow): Promise<string> {
    const today = clock().slice(0, 10);
    const lastPass = await lastPassInspectionDate(item.id);
    const anchor =
      lastPass ??
      item.first_use_date ??
      item.manufacture_date ??
      today;
    return addMonths(anchor, item.inspection_interval_months);
  }

  // Best-effort wrapper — schedule/cancel must never break a write path.
  async function safeSchedule(gear: GearItem): Promise<void> {
    if (!notifs) return;
    try { await notifs.schedule(gear); } catch { /* ignore */ }
  }
  async function safeCancel(gearId: string): Promise<void> {
    if (!notifs) return;
    try { await notifs.cancel(gearId); } catch { /* ignore */ }
  }

  return {
    async listGear(): Promise<GearItem[]> {
      // Active items (retired_at IS NULL) first, sorted by due date ASC.
      // Retired items below, newest-retired first. NULLS FIRST is supported
      // by SQLite 3.30+ and bundled better-sqlite3 / Expo SQLite.
      const rows = await db.getAll<GearRow>(
        `SELECT * FROM gear
          ORDER BY retired_at IS NULL DESC,
                   next_inspection_due ASC NULLS LAST,
                   retired_at DESC,
                   created_at DESC`,
      );
      return rows.map(rowToGear);
    },

    async getGear(id: string): Promise<GearItem | null> {
      const row = await getRow(id);
      return row ? rowToGear(row) : null;
    },

    async createGear(input: CreateGearInput): Promise<GearItem> {
      const now = clock();
      const id = uuid();
      const interval = input.inspection_interval_months ?? 6;
      const today = now.slice(0, 10);
      const anchor =
        input.first_use_date ??
        input.manufacture_date ??
        today;
      const nextDue = addMonths(anchor, interval);

      const manufacturer = input.manufacturer ?? null;
      const model = input.model ?? null;
      const fallbackName = [manufacturer, model].filter(Boolean).join(' ').trim();
      const name = input.name?.trim() || fallbackName || 'Unnamed item';

      await db.run(
        `INSERT INTO gear (id, name, category, manufacturer, model, serial_number,
            manufacture_date, first_use_date, retired_at, retirement_reason,
            inspection_interval_months, next_inspection_due, photo_path, notes,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          id, name, input.category, manufacturer, model, input.serial_number ?? null,
          input.manufacture_date ?? null, input.first_use_date ?? null,
          interval, nextDue, input.photo_path ?? null, input.notes ?? null,
          now, now,
        ],
      );
      const item = (await this.getGear(id))!;
      await safeSchedule(item);
      return item;
    },

    async updateGear(id: string, input: UpdateGearInput): Promise<GearItem> {
      const existing = await getRow(id);
      if (!existing) throw new Error('Gear not found');
      if (existing.retired_at) throw new Error('Cannot modify a retired gear item');

      const fields: string[] = [];
      const values: unknown[] = [];
      let dueAffectingChange = false;

      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        fields.push(`${key} = ?`);
        values.push(value);
        if (key === 'first_use_date' || key === 'manufacture_date' || key === 'inspection_interval_months') {
          dueAffectingChange = true;
        }
      }

      if (fields.length === 0) return rowToGear(existing);

      const now = clock();
      fields.push('updated_at = ?');
      values.push(now);
      values.push(id);

      await db.run(`UPDATE gear SET ${fields.join(', ')} WHERE id = ?`, values);

      if (dueAffectingChange) {
        const after = (await getRow(id))!;
        const newDue = await computeNextDue(after);
        await db.run(
          'UPDATE gear SET next_inspection_due = ?, updated_at = ? WHERE id = ?',
          [newDue, now, id],
        );
      }

      const updated = (await this.getGear(id))!;
      if (dueAffectingChange) await safeSchedule(updated);
      return updated;
    },

    async retireGear(id: string, reason: string): Promise<GearItem> {
      const existing = await getRow(id);
      if (!existing) throw new Error('Gear not found');
      // Idempotent: re-retiring keeps the original retired_at and reason.
      if (existing.retired_at) return rowToGear(existing);

      const now = clock();
      const today = now.slice(0, 10);
      await db.run(
        `UPDATE gear
            SET retired_at = ?, retirement_reason = ?, next_inspection_due = NULL, updated_at = ?
          WHERE id = ?`,
        [today, reason, now, id],
      );
      await safeCancel(id);
      return (await this.getGear(id))!;
    },

    async deleteGear(id: string): Promise<void> {
      const existing = await getRow(id);
      if (!existing) throw new Error('Gear not found');
      const inspectionsCount = await db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM gear_inspections WHERE gear_id = ?',
        [id],
      );
      if ((inspectionsCount?.n ?? 0) > 0) {
        throw new Error('Cannot delete gear with inspection history — retire it instead');
      }
      await db.run('DELETE FROM gear WHERE id = ?', [id]);
      await safeCancel(id);
    },

    async listInspections(gearId: string): Promise<GearInspection[]> {
      const rows = await db.getAll<InspectionRow>(
        `SELECT * FROM gear_inspections WHERE gear_id = ?
          ORDER BY inspected_on DESC, created_at DESC`,
        [gearId],
      );
      return rows.map(rowToInspection);
    },

    async logInspection(input: LogInspectionInput): Promise<GearInspection> {
      const gear = await getRow(input.gear_id);
      if (!gear) throw new Error('Gear not found');
      if (gear.retired_at) throw new Error('Cannot log inspection on a retired item');

      const now = clock();
      const inspectedOn = (input.inspected_on ?? now.slice(0, 10));
      const inspId = uuid();

      // Transactional INSERT + parent UPDATE so a process kill can't leave
      // the inspection row without the matching gear-state change. Mirrors
      // the split-write pattern in signRequestsService.applyIncomingSignature.
      await db.exec('BEGIN');
      try {
        await db.run(
          `INSERT INTO gear_inspections (id, gear_id, inspected_on, result, inspector_name, notes, cert_photo_path, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            inspId, input.gear_id, inspectedOn, input.result,
            input.inspector_name ?? null, input.notes ?? null, input.cert_photo_path ?? null,
            now,
          ],
        );

        if (input.result === 'fail') {
          await db.run(
            `UPDATE gear
                SET retired_at = ?, retirement_reason = 'failed inspection',
                    next_inspection_due = NULL, updated_at = ?
              WHERE id = ?`,
            [inspectedOn, now, input.gear_id],
          );
        } else {
          const newDue = addMonths(inspectedOn, gear.inspection_interval_months);
          await db.run(
            'UPDATE gear SET next_inspection_due = ?, updated_at = ? WHERE id = ?',
            [newDue, now, input.gear_id],
          );
        }

        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }

      // Reschedule notifications outside the transaction. On fail the item
      // is retired so we cancel; otherwise we re-schedule with the new due.
      const after = await this.getGear(input.gear_id);
      if (after) {
        if (after.retired_at) await safeCancel(after.id);
        else await safeSchedule(after);
      }

      const row = await db.get<InspectionRow>('SELECT * FROM gear_inspections WHERE id = ?', [inspId]);
      return rowToInspection(row!);
    },

    async listDue(withinDays: number): Promise<GearItem[]> {
      const today = clock().slice(0, 10);
      const cutoff = addDaysIso(today, withinDays);
      const rows = await db.getAll<GearRow>(
        `SELECT * FROM gear
          WHERE retired_at IS NULL AND next_inspection_due IS NOT NULL
            AND next_inspection_due <= ?
          ORDER BY next_inspection_due ASC`,
        [cutoff],
      );
      return rows.map(rowToGear);
    },
  };
}

// Add `n` whole days to a YYYY-MM-DD date. Local-only helper for listDue.
function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}
