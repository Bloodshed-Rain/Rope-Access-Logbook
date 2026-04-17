import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import { CloudSnapshot, CloudStatePreview } from '../types';

export interface RestoreDeps {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  appVersion: string;
}

export type RestoreResult =
  | { kind: 'restored'; entries: number; signatures: number; assets: number; assets_failed: string[] }
  | { kind: 'version_too_new'; which: 'cloud' | 'db' }
  | { kind: 'no_snapshot' };

export function createRestoreService(deps: RestoreDeps) {
  const { cloud } = deps;

  async function fetchSnapshot(uid: string): Promise<CloudSnapshot | null> {
    if (!(await cloud.objectExists(`${uid}/snapshot.json`))) return null;
    const bytes = await cloud.downloadObject(`${uid}/snapshot.json`);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  return {
    async previewCloudState(): Promise<CloudStatePreview> {
      const session = await cloud.getSession();
      if (!session) throw new Error('not_authenticated');
      const snap = await fetchSnapshot(session.user_id);
      if (!snap) {
        return { has_cloud_data: false, entries_count: 0, signatures_count: 0, cloud_backed_up_at: null, backup_id: null };
      }
      return {
        has_cloud_data: true,
        entries_count: snap.entries.length,
        signatures_count: snap.signatures.length,
        cloud_backed_up_at: snap.exported_at,
        backup_id: snap.backup_id,
      };
    },

    async restore(): Promise<RestoreResult> {
      throw new Error('not_implemented');
    },

    async uploadCurrentAsCloud(): Promise<void> {
      throw new Error('not_implemented');
    },
  };
}
