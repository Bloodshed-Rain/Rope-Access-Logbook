import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PurchasesPackage } from 'react-native-purchases';
import { createSubscriptionService, SubscriptionTier } from '../services/subscriptionService';
import { getClient } from '../db/initialize';

export function useSubscriptionTier() {
  return useQuery<SubscriptionTier>({
    queryKey: ['subscriptionTier'],
    queryFn: () => createSubscriptionService(getClient()).getTier(),
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes before checking RevenueCat again
  });
}

export function useSubscriptionPackages() {
  return useQuery<PurchasesPackage[]>({
    queryKey: ['subscriptionPackages'],
    queryFn: () => createSubscriptionService(getClient()).getPackages(),
    staleTime: 1000 * 60 * 60, // Packages rarely change
  });
}

export function usePurchasePackage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pkg: PurchasesPackage) => createSubscriptionService(getClient()).purchase(pkg),
    onSuccess: (tier) => {
      queryClient.setQueryData(['subscriptionTier'], tier);
      // Invalidate profile since profile also stores the tier
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useRestorePurchases() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createSubscriptionService(getClient()).restore(),
    onSuccess: (tier) => {
      queryClient.setQueryData(['subscriptionTier'], tier);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
