import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSignRequestsService } from '../services/signRequestsService';
import { DbClient } from '../db/client';
import { CloudClient } from '../cloud/cloudClient';
import { FileSystemAbstraction } from '../cloud/fsAbstraction';
import { HashFn } from '../types';

export interface UseSignRequestsDeps {
  db: DbClient;
  cloud: CloudClient;
  fs: FileSystemAbstraction;
  hash: HashFn;
}

const KEY = ['sign_requests'];

export function useSignRequests({ db, cloud, fs, hash }: UseSignRequestsDeps) {
  const qc = useQueryClient();
  const service = createSignRequestsService(db, cloud, fs, hash);

  const query = useQuery({
    queryKey: KEY,
    queryFn: async () => {
      await service.sync();
      return service.listCached();
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });

  const send = useMutation({
    mutationFn: (args: { entry_id: string; connection_id: string; supervisor_user_id: string }) =>
      service.sendRequest(args),
    onSuccess: invalidate,
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => service.withdraw(id),
    onSuccess: invalidate,
  });
  const decline = useMutation({
    mutationFn: (args: { id: string; reason: string }) => service.decline(args.id, args.reason),
    onSuccess: invalidate,
  });
  const sign = useMutation({
    mutationFn: (args: {
      request_id: string;
      png_base64: string;
      supervisor_name: string;
      supervisor_cert_number: string;
      device_id: string;
      gps_lat?: number;
      gps_lon?: number;
    }) => service.sign(args),
    onSuccess: invalidate,
  });

  useEffect(() => {
    const unsub = cloud.subscribeSignRequests(async () => {
      await service.sync();
      invalidate();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);

  return { query, send, withdraw, decline, sign };
}
