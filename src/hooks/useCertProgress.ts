import { useQuery } from '@tanstack/react-query';
import { createCertProgressService } from '../services/certProgressService';
import { getClient } from '../db/initialize';
import { useProfile } from './useProfile';
import { CertScheme } from '../types';

function getService() {
  return createCertProgressService(getClient());
}

export function useCertProgress(scheme: CertScheme) {
  const { data: profile } = useProfile();
  return useQuery({
    queryKey: ['certProgress', scheme, profile?.id],
    queryFn: async () => {
      if (!profile) return null;
      return getService().getCertProgress(scheme, profile);
    },
    enabled: !!profile,
  });
}

export function useRecert(scheme: CertScheme) {
  const { data: profile } = useProfile();
  return useQuery({
    queryKey: ['recert', scheme, profile?.id],
    queryFn: () => {
      if (!profile) return null;
      return getService().getRecert(scheme, profile);
    },
    enabled: !!profile,
  });
}

export function useDashboardStats(year: number) {
  return useQuery({
    queryKey: ['dashboardStats', year],
    queryFn: () => getService().getDashboardStats(year),
  });
}

export function useWorkBreakdown(year: number) {
  return useQuery({
    queryKey: ['workBreakdown', year],
    queryFn: () => getService().getWorkBreakdown(year),
  });
}
