// src/screens/PaywallScreen.tsx
// Light-theme paywall. Two modes:
//   • trial-start  — for unsubscribed users landing here outside onboarding.
//                    CTA "Start free trial".
//   • renew        — lapsed-user re-entry path. CTA "Renew subscription".
//                    Explanatory copy reassures the user that the logbook
//                    stays viewable + exportable as PDF, satisfying Apple's
//                    retained-content policy on subscription expiry.
//
// Active/trialing users who land here are an unlikely path (deep link or
// stale nav state); render a "You're already subscribed" confirmation with
// a Close button. Restore-purchase is always available at the bottom.
//
// Spec §3 lines 126-144 (light-theme redesign).

import React from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CheckCircle2, Cloud, FileText, Send, X } from 'lucide-react-native';
import { Screen, Button, LoadingSpinner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import {
  useSubscriptionStatus,
  useSubscriptionPackages,
  usePurchasePackage,
  useRestorePurchases,
} from '../hooks/useSubscription';
import { PurchasesPackage } from 'react-native-purchases';
import { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>;

const BENEFITS: Array<{ text: string; Icon: typeof CheckCircle2 }> = [
  { text: 'Cloud backup across all your devices', Icon: Cloud },
  { text: 'Remote supervisor signatures', Icon: Send },
  { text: 'Professional PDF + JSON exports', Icon: FileText },
  { text: 'Unlimited entries, signed forever', Icon: CheckCircle2 },
];

export function PaywallScreen({ navigation }: Props) {
  const { colors, spacing, typography, radii, borders, shadows } = useTheme();
  const sub = useSubscriptionStatus();
  const { data: packages, isLoading: isLoadingPackages } = useSubscriptionPackages();
  const purchase = usePurchasePackage();
  const restore = useRestorePurchases();

  // Mode derivation — keep loading-state behavior conservative. While the
  // status query is pending we render the trial-start mode (the more common
  // unauthenticated path) rather than flicker the renew copy.
  const mode: 'trial' | 'renew' | 'already-subscribed' =
    sub.status === 'lapsed'
      ? 'renew'
      : sub.status === 'trialing' || sub.status === 'active'
        ? 'already-subscribed'
        : 'trial';

  const handleClose = () => navigation.goBack();

  const handlePurchase = async (pkg: PurchasesPackage) => {
    try {
      const status = await purchase.mutateAsync(pkg);
      if (status === 'active' || status === 'trialing') {
        Alert.alert(
          mode === 'renew' ? 'Subscription renewed' : 'You’re all set',
          mode === 'renew'
            ? 'Welcome back. You can add and sign entries again.'
            : 'Your free trial has started. Enjoy the full logbook.',
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      }
    } catch (e) {
      Alert.alert('Purchase failed', (e as Error)?.message ?? 'Something went wrong.');
    }
  };

  const handleRestore = async () => {
    try {
      const status = await restore.mutateAsync();
      if (status === 'active' || status === 'trialing') {
        Alert.alert(
          'Subscription restored',
          'Your subscription has been restored on this device.',
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } else {
        Alert.alert(
          'No subscription found',
          'We couldn’t find an active subscription on this account.',
        );
      }
    } catch (e) {
      Alert.alert('Restore failed', (e as Error)?.message ?? 'Failed to restore purchases.');
    }
  };

  // Pick the primary CTA label per mode + package. Annual packages get a
  // "/yr" suffix; default to "/mo".
  const ctaLabel = (pkg: PurchasesPackage): string => {
    const period = pkg.packageType === 'ANNUAL' ? 'yr' : 'mo';
    const price = `${pkg.product.priceString} / ${period}`;
    if (mode === 'renew') return `Renew — ${price}`;
    return `Start free trial — ${price}`;
  };

  const headline =
    mode === 'renew'
      ? 'Renew your subscription'
      : mode === 'already-subscribed'
        ? 'You’re already subscribed'
        : 'Logbook Pro';

  const subhead =
    mode === 'renew'
      ? 'Your logbook stays viewable and exportable as PDF. Renew to add or sign new entries.'
      : mode === 'already-subscribed'
        ? 'You have full access. There’s nothing to do here.'
        : 'Everything you need to keep a re-cert-ready logbook on the road.';

  return (
    <Screen padded={false}>
      {/* Header — dismiss X top right */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingHorizontal: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={handleClose}
          hitSlop={12}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={22} color={colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.base,
        }}
      >
        {/* Headline + subhead */}
        <View style={{ gap: spacing.sm, paddingTop: spacing.md }}>
          <Text style={[typography.title1, { color: colors.textPrimary }]}>{headline}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{subhead}</Text>
        </View>

        {/* Already-subscribed: short close path. Surface Restore at the
            bottom in case the user expected to restore on a fresh device
            but the live status already reflects a paid entitlement. */}
        {mode === 'already-subscribed' ? (
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            <Button title="Close" variant="primary" onPress={handleClose} />
            <Button
              title={restore.isPending ? 'Restoring…' : 'Restore purchases'}
              variant="ghost"
              onPress={handleRestore}
              disabled={restore.isPending}
            />
          </View>
        ) : (
          <>
            {/* Benefits card */}
            <View
              style={[
                {
                  backgroundColor: colors.bgSurface,
                  borderRadius: radii.md,
                  borderWidth: borders.hair,
                  borderColor: colors.border,
                  padding: spacing.base,
                  gap: spacing.md,
                  marginTop: spacing.sm,
                },
                shadows.sm,
              ]}
            >
              {BENEFITS.map(({ text, Icon }) => (
                <View
                  key={text}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                  }}
                >
                  <Icon size={20} color={colors.accentPrimary} />
                  <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>
                    {text}
                  </Text>
                </View>
              ))}
            </View>

            {/* Renew-mode reassurance row — also rendered as a tinted strip
                so users glancing at the screen catch it before reading the
                subhead. Skipped in trial-start mode. */}
            {mode === 'renew' && (
              <View
                style={{
                  backgroundColor: colors.statusInfoTint,
                  borderRadius: radii.md,
                  padding: spacing.base,
                  gap: spacing.xs,
                }}
              >
                <Text style={[typography.bodyMed, { color: colors.statusInfo }]}>
                  Your data is safe
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary }]}>
                  All previously signed entries remain in your logbook and can be exported as PDF
                  at any time.
                </Text>
              </View>
            )}

            {/* Packages */}
            {isLoadingPackages ? (
              <View style={{ paddingVertical: spacing.xl }}>
                <LoadingSpinner label="Loading offers" />
              </View>
            ) : packages && packages.length > 0 ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {packages.map((pkg) => (
                  <Button
                    key={pkg.identifier}
                    title={ctaLabel(pkg)}
                    variant="primary"
                    onPress={() => handlePurchase(pkg)}
                    disabled={purchase.isPending}
                    loading={purchase.isPending}
                  />
                ))}
              </View>
            ) : (
              <Text
                style={[
                  typography.body,
                  {
                    color: colors.textSecondary,
                    textAlign: 'center',
                    paddingVertical: spacing.lg,
                  },
                ]}
              >
                No subscription packages currently available. Check your connection and try again.
              </Text>
            )}

            {/* Restore */}
            <View style={{ marginTop: spacing.md, alignItems: 'center' }}>
              <Button
                title={restore.isPending ? 'Restoring…' : 'Restore purchases'}
                variant="ghost"
                onPress={handleRestore}
                disabled={restore.isPending}
              />
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
