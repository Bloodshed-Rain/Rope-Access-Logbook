import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type SubscriptionStripStatus = 'trialing' | 'active' | 'lapsed';

export interface SubscriptionStripProps {
  status: SubscriptionStripStatus;
  trialDaysRemaining?: number | null;
  renewalDate?: string | null;
  onManage?: () => void;
  onRenew?: () => void;
}

export function SubscriptionStrip({
  status,
  trialDaysRemaining,
  renewalDate,
  onManage,
  onRenew,
}: SubscriptionStripProps) {
  const { colors, radii, spacing, typography, borders } = useTheme();

  if (status === 'lapsed') {
    return (
      <View
        style={{
          backgroundColor: colors.statusErrTint,
          borderColor: colors.statusErr,
          borderWidth: borders.hair,
          borderRadius: radii.md,
          padding: spacing.base,
          gap: spacing.sm,
        }}
      >
        <Text style={[typography.bodyMed, { color: colors.statusErr }]}>
          Subscription lapsed — renew to add or sign new entries
        </Text>
        {onRenew && (
          <Pressable
            onPress={onRenew}
            accessibilityRole="button"
            accessibilityLabel="Renew subscription"
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.accentPressed : colors.accentPrimary,
              borderRadius: radii.md,
              paddingVertical: spacing.md,
              alignItems: 'center',
              justifyContent: 'center',
            })}
          >
            <Text style={[typography.bodyMed, { color: colors.textInverse }]}>Renew</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const label =
    status === 'trialing'
      ? trialDaysRemaining != null
        ? `Trial — ${trialDaysRemaining} day${trialDaysRemaining === 1 ? '' : 's'} remaining`
        : 'Trial'
      : 'Subscription active';

  const subText =
    status === 'active' && renewalDate ? `Renews ${renewalDate}` : status === 'trialing' && renewalDate ? `Trial ends ${renewalDate}` : null;

  return (
    <View
      style={{
        backgroundColor: colors.bgMuted,
        borderRadius: radii.md,
        padding: spacing.base,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.md,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>{label}</Text>
        {subText && (
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
            {subText}
          </Text>
        )}
      </View>
      {onManage && (
        <Pressable
          onPress={onManage}
          accessibilityRole="button"
          accessibilityLabel="Manage subscription"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={[typography.label, { color: colors.accentPrimary }]}>
            Manage subscription
          </Text>
        </Pressable>
      )}
    </View>
  );
}
