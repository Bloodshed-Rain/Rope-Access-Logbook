// src/screens/onboarding/SubscribeStep.tsx
// Step 5 — RevenueCat trial-start. Spec §3 lines 121-122.
//
// No skip CTA per spec — completing onboarding requires a successful purchase
// (trial or active). On success the wizard host advances to either
// cloud_signin (supervisor) or completion (tech). Restore-purchase is the
// secondary affordance for users with an existing subscription on this Apple
// ID / Google account.

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, Banner, Screen } from '../../primitives';
import { useTheme } from '../../theme/ThemeProvider';
import {
  usePurchasePackage,
  useRestorePurchases,
  useSubscriptionPackages,
  useSubscriptionStatus,
} from '../../hooks/useSubscription';

export interface SubscribeStepProps {
  onBack: () => void;
  onPurchased: () => void;
}

export function SubscribeStep({ onBack, onPurchased }: SubscribeStepProps) {
  const { colors, spacing, typography, radii, borders } = useTheme();
  const packagesQ = useSubscriptionPackages();
  const purchase = usePurchasePackage();
  const restore = useRestorePurchases();
  const { isPaid } = useSubscriptionStatus();
  const [error, setError] = React.useState<string | null>(null);

  // If the user already has a paid entitlement when this step mounts (e.g.
  // restore-on-cold-boot resolved before they reached this step), advance
  // automatically rather than asking them to purchase again.
  React.useEffect(() => {
    if (isPaid) onPurchased();
  }, [isPaid, onPurchased]);

  const pkg = packagesQ.data?.[0] ?? null;
  const busy = purchase.isPending || restore.isPending;

  async function handlePurchase() {
    if (!pkg) return;
    setError(null);
    try {
      const status = await purchase.mutateAsync(pkg);
      if (status === 'trialing' || status === 'active') {
        onPurchased();
      } else {
        // User cancelled or RC returned an unexpected state — stay on step.
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message ?? 'Purchase failed. Try again.');
    }
  }

  async function handleRestore() {
    setError(null);
    try {
      const status = await restore.mutateAsync();
      if (status === 'trialing' || status === 'active') {
        onPurchased();
      } else {
        setError('No active subscription found on this account.');
      }
    } catch (e) {
      setError((e as Error).message ?? 'Restore failed. Try again.');
    }
  }

  return (
    <Screen padded={false}>
      <View style={{ flex: 1, padding: spacing.base, gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.title1, { color: colors.textPrimary }]}>
            Start your free trial
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            $2.99/mo with a 7-day free trial. Cancel anytime in your App Store
            or Play settings.
          </Text>
        </View>

        <View
          style={{
            padding: spacing.base,
            borderRadius: radii.md,
            borderWidth: borders.hair,
            borderColor: colors.border,
            backgroundColor: colors.bgSurface,
            gap: spacing.sm,
          }}
        >
          <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
            Logbook Pro includes
          </Text>
          {[
            'Cloud backup and cross-device restore',
            'Search supervisors by name',
            'Unlimited entries, signatures, and exports',
          ].map((line) => (
            <Text
              key={line}
              style={[typography.body, { color: colors.textSecondary }]}
            >
              {`•  ${line}`}
            </Text>
          ))}
        </View>

        {error && <Banner variant="error" message={error} />}

        {packagesQ.isLoading && (
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
            <ActivityIndicator color={colors.accentPrimary} />
          </View>
        )}

        {packagesQ.isError && !packagesQ.data && (
          <Banner
            variant="error"
            message="Couldn't reach the App Store. Check your connection and try again."
          />
        )}

        <View style={{ gap: spacing.sm, marginTop: 'auto' }}>
          <Button
            title="Start free trial"
            onPress={handlePurchase}
            disabled={!pkg || busy}
            loading={purchase.isPending}
          />
          <Button
            title="Restore purchase"
            variant="ghost"
            onPress={handleRestore}
            disabled={busy}
            loading={restore.isPending}
          />
          <Button
            title="Back"
            variant="ghost"
            onPress={onBack}
            disabled={busy}
          />
        </View>
      </View>
    </Screen>
  );
}
