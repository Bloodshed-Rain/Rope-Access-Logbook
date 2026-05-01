import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PurchasesPackage } from 'react-native-purchases';
import { createSubscriptionService, SubscriptionStatus } from '../services/subscriptionService';
import { getClient } from '../db/initialize';

export function useSubscriptionStatus() {
  const statusQ = useQuery<SubscriptionStatus>({
    queryKey: ['subscriptionStatus'],
    queryFn: () => createSubscriptionService(getClient()).getStatus(),
    staleTime: 1000 * 60 * 5,
  });

  const trialQ = useQuery<number | null>({
    queryKey: ['subscriptionStatus', 'trialDays'],
    queryFn: () => createSubscriptionService(getClient()).getTrialDaysRemaining(),
    enabled: statusQ.data === 'trialing',
  });

  const renewalQ = useQuery<string | null>({
    queryKey: ['subscriptionStatus', 'renewal'],
    queryFn: () => createSubscriptionService(getClient()).getRenewalDate(),
    enabled: statusQ.data === 'active',
  });

  const status = statusQ.data ?? 'unknown';
  return {
    status,
    isTrialing: status === 'trialing',
    isActive: status === 'active',
    isLapsed: status === 'lapsed',
    isPaid: status === 'trialing' || status === 'active',
    trialDaysRemaining: trialQ.data ?? null,
    renewalDate: renewalQ.data ?? null,
    isLoading: statusQ.isLoading,
  };
}

export function useSubscriptionPackages() {
  return useQuery<PurchasesPackage[]>({
    queryKey: ['subscriptionPackages'],
    queryFn: () => createSubscriptionService(getClient()).getPackages(),
    staleTime: 1000 * 60 * 60,
  });
}

export function usePurchasePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pkg: PurchasesPackage) => createSubscriptionService(getClient()).purchase(pkg),
    onSuccess: (status: SubscriptionStatus) => {
      queryClient.setQueryData(['subscriptionStatus'], status);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useRestorePurchases() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createSubscriptionService(getClient()).restore(),
    onSuccess: (status: SubscriptionStatus) => {
      queryClient.setQueryData(['subscriptionStatus'], status);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
