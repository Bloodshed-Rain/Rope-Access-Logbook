// src/hooks/useBackupStatus.ts
import { useQuery } from '@tanstack/react-query';
import { DbClient } from '../db/client';
import { Profile } from '../types';

export function useBackupStatus(db: DbClient | null) {
  return useQuery({
    queryKey: ['backupStatus'],
    enabled: !!db,
    queryFn: async () => {
      const p = await db!.get<Profile>('SELECT last_cloud_backup_at, last_uploaded_backup_id FROM profile LIMIT 1');
      return {
        last_cloud_backup_at: p?.last_cloud_backup_at ?? null,
        last_uploaded_backup_id: p?.last_uploaded_backup_id ?? null,
      };
    },
  });
}
