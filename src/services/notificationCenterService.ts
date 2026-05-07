import { DbClient } from '../db/client';
import { generateId } from '../utils/uuid';

type UuidFn = () => string;

export type NotificationKind =
  | 'cert_expiry_60d'
  | 'cert_expiry_0d'
  | 'sign_request_received'
  | 'sign_request_signed'
  | 'sign_request_declined'
  | 'sign_request_withdrawn'
  | 'level_upgrade'
  | 'backup_stale'
  | 'gear_inspection_30d'
  | 'gear_inspection_0d';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  dismissed_at: string | null;
}

export interface NotificationCenterService {
  record(input: {
    kind: NotificationKind;
    payload: Record<string, unknown>;
    dedupeOnDay?: boolean;
    /** Narrows dedupe to (kind + day + dedupeKey). Used for gear notifications
     * so several items due on the same day each get their own bell row. The
     * key is mirrored into payload.dedupe_key so subsequent calls can match it. */
    dedupeKey?: string;
  }): Promise<string>;
  list(): Promise<NotificationRow[]>;
  unreadCount(): Promise<number>;
  markAllRead(): Promise<void>;
  dismiss(id: string): Promise<void>;
}

export function createNotificationCenterService(
  db: DbClient,
  now: () => string,
  uuid: UuidFn = generateId
): NotificationCenterService {
  return {
    async record({ kind, payload, dedupeOnDay, dedupeKey }) {
      if (dedupeOnDay) {
        const today = now().slice(0, 10);
        const params: unknown[] = [kind, today];
        let sql = `SELECT id FROM notifications
                    WHERE kind = ? AND substr(created_at, 1, 10) = ? AND dismissed_at IS NULL`;
        if (dedupeKey !== undefined) {
          // We previously mirrored the key into payload.dedupe_key; SQLite's
          // json_extract finds it without a separate column.
          sql += ` AND json_extract(payload_json, '$.dedupe_key') = ?`;
          params.push(dedupeKey);
        }
        sql += ` ORDER BY created_at DESC LIMIT 1`;
        // dismissed_at IS NULL: a dismissed nag can re-fire later — dedupe
        // protects only against undismissed duplicates within the same day.
        const existing = await db.get<{ id: string }>(sql, params);
        if (existing) return existing.id;
      }
      const id = uuid();
      const finalPayload = dedupeKey !== undefined
        ? { ...payload, dedupe_key: dedupeKey }
        : payload;
      await db.run(
        `INSERT INTO notifications (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)`,
        [id, kind, JSON.stringify(finalPayload), now()]
      );
      return id;
    },

    async list() {
      const rows = await db.getAll<{
        id: string;
        kind: NotificationKind;
        payload_json: string;
        created_at: string;
        read_at: string | null;
        dismissed_at: string | null;
      }>(
        `SELECT id, kind, payload_json, created_at, read_at, dismissed_at
         FROM notifications WHERE dismissed_at IS NULL ORDER BY created_at DESC`
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        payload: JSON.parse(r.payload_json),
        created_at: r.created_at,
        read_at: r.read_at,
        dismissed_at: r.dismissed_at,
      }));
    },

    async unreadCount() {
      const row = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND dismissed_at IS NULL`
      );
      return row?.n ?? 0;
    },

    async markAllRead() {
      await db.run(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL`, [now()]);
    },

    async dismiss(id) {
      await db.run(`UPDATE notifications SET dismissed_at = ? WHERE id = ?`, [now(), id]);
    },
  };
}
