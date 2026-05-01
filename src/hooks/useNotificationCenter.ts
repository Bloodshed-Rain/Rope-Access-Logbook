import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getClient } from '../db/initialize';
import {
  createNotificationCenterService,
  NotificationCenterService,
} from '../services/notificationCenterService';

const KEY = ['notifications'] as const;

function isoNow() {
  return new Date().toISOString();
}

function getService(): NotificationCenterService {
  return createNotificationCenterService(getClient(), isoNow);
}

export function useNotificationCenter() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: KEY,
    queryFn: () => getService().list(),
  });

  const unread = useQuery({
    queryKey: [...KEY, 'unread'],
    queryFn: () => getService().unreadCount(),
  });

  const markAllRead = useMutation({
    mutationFn: () => getService().markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => getService().dismiss(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
    },
  });

  return {
    items: list.data ?? [],
    unreadCount: unread.data ?? 0,
    markAllRead: () => markAllRead.mutate(),
    dismiss: (id: string) => dismiss.mutate(id),
    isLoading: list.isLoading,
  };
}
