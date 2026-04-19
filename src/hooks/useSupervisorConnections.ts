import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSupervisorConnectionsService } from '../services/supervisorConnectionsService';
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { SupervisorSearchResult } from '../types';

export interface UseSupervisorConnectionsDeps {
  db: DbClient;
  cloud: CloudClient;
}

const KEY = ['supervisor_connections'];

export function useSupervisorConnections({ db, cloud }: UseSupervisorConnectionsDeps) {
  const qc = useQueryClient();
  const service = createSupervisorConnectionsService(db, cloud);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      await service.sync();
      return service.listCached();
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });

  const inviteByEmail = useMutation({
    mutationFn: (email: string) => service.inviteByEmail(email),
    onSuccess: invalidate,
  });
  const inviteByDirectoryResult = useMutation({
    mutationFn: (args: { result: SupervisorSearchResult; invitedEmail: string }) =>
      service.inviteByDirectoryResult(args.result, args.invitedEmail),
    onSuccess: invalidate,
  });
  const accept = useMutation({ mutationFn: (id: string) => service.accept(id), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: (id: string) => service.decline(id), onSuccess: invalidate });
  const revoke = useMutation({ mutationFn: (id: string) => service.revoke(id), onSuccess: invalidate });
  const reinvite = useMutation({ mutationFn: (id: string) => service.reinvite(id), onSuccess: invalidate });

  useEffect(() => {
    const unsubscribe = cloud.subscribeConnections((_row) => {
      qc.invalidateQueries({ queryKey: KEY });
    });
    return unsubscribe;
  }, [cloud, qc]);

  return { query, inviteByEmail, inviteByDirectoryResult, accept, decline, revoke, reinvite };
}
