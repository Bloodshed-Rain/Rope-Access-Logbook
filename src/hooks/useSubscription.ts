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
    staleTime: 1000 * 60 * 5,
  });

  const renewalQ = useQuery<string | null>({
    queryKey: ['subscriptionStatus', 'renewal'],
    queryFn: () => createSubscriptionService(getClient()).getRenewalDate(),
    enabled: statusQ.data === 'active',
    staleTime: 1000 * 60 * 5,
  });

  const status = statusQ.data ?? 'unknown';
  return {
    status,
    isTrialing: status === 'trialing',
    isActive: status === 'active',
    isLapsed: status === 'lapsed',
    isPaid: status === 'trialing' || status === 'active',
    trialDaysRemaining: status === 'trialing' ? (trialQ.data ?? null) : null,
    renewalDate: status === 'active' ? (renewalQ.data ?? null) : null,
    isLoading: statusQ.isLoading,
  };
}

/**
 * Convenience for write-CTA gating across screens. `true` only when the
 * subscription has actually lapsed; `'unknown'` (RevenueCat not yet loaded
 * on cold start) is intentionally NOT lapsed so we don't block legitimate
 * users during boot. Trialing/active are full-access.
 */
export function useReadOnly(): boolean {
  const { status } = useSubscriptionStatus();
  return status === 'lapsed';
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
