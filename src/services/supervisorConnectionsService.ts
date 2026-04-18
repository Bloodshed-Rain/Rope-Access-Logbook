import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import {
  SupervisorConnection,
  SupervisorSearchKind,
  SupervisorSearchResult,
} from '../types';

type Clock = () => string;

export function createSupervisorConnectionsService(
  db: DbClient,
  cloud: CloudClient,
  clock: Clock = () => new Date().toISOString(),
) {
  async function cacheRow(row: SupervisorConnection): Promise<void> {
    await db.run(
      `INSERT OR REPLACE INTO supervisor_connections_cache
         (id, tech_user_id, supervisor_user_id, status, invited_email,
          supervisor_display_name, declined_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        row.id, row.tech_user_id, row.supervisor_user_id, row.status,
        row.invited_email, row.supervisor_display_name, row.declined_at,
        row.created_at, row.updated_at,
      ],
    );
  }

  async function getLastSyncedAt(): Promise<string | undefined> {
    const r = await db.get<{ max: string | null }>(
      'SELECT MAX(updated_at) as max FROM supervisor_connections_cache',
    );
    return r?.max ?? undefined;
  }

  return {
    async sync(): Promise<void> {
      const since = await getLastSyncedAt();
      const rows = await cloud.listSupervisorConnections(since);
      for (const r of rows) await cacheRow(r);
    },

    async listCached(): Promise<SupervisorConnection[]> {
      const rows = await db.getAll<SupervisorConnection>(
        'SELECT * FROM supervisor_connections_cache ORDER BY created_at DESC',
      );
      // SQLite stores INTEGER for booleans — but this cache table has no booleans.
      // Convert supervisor_user_id from the row as-is (it may be null).
      return rows;
    },

    async inviteByEmail(email: string): Promise<SupervisorConnection> {
      const row = await cloud.inviteSupervisorByEmail(email);
      await cacheRow(row);
      return row;
    },

    async inviteByDirectoryResult(result: SupervisorSearchResult, invitedEmail: string): Promise<SupervisorConnection> {
      const row = await cloud.inviteSupervisorByUserId(result.user_id, invitedEmail);
      await cacheRow(row);
      return row;
    },

    async accept(id: string): Promise<SupervisorConnection> {
      const row = await cloud.respondToConnection(id, true);
      await cacheRow(row);
      return row;
    },

    async decline(id: string): Promise<SupervisorConnection> {
      const row = await cloud.respondToConnection(id, false);
      await cacheRow(row);
      return row;
    },

    async revoke(id: string): Promise<SupervisorConnection> {
      const row = await cloud.revokeConnection(id);
      await cacheRow(row);
      return row;
    },

    async reinvite(id: string): Promise<SupervisorConnection> {
      const row = await cloud.reinviteDeclinedConnection(id);
      await cacheRow(row);
      return row;
    },

    async search(kind: SupervisorSearchKind, query: string): Promise<SupervisorSearchResult[]> {
      return cloud.searchSupervisors(kind, query);
    },
  };
}
