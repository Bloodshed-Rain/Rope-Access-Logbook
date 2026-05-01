import React from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/RootNavigator';
import { Screen, Button, Card, SectionHeader, LoadingSpinner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSubscriptionPackages, usePurchasePackage, useRestorePurchases } from '../hooks/useSubscription';
import { PurchasesPackage } from 'react-native-purchases';
import { CheckCircle2, ShieldCheck, Share, Cloud } from 'lucide-react-native';

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>;

const BENEFITS = [
  { text: "Advanced Analytics & Reporting Dashboard", icon: ShieldCheck },
  { text: "Unlimited Cloud Backups & multi-device sync", icon: Cloud },
  { text: "Remote Supervisor Signatures directly via cloud", icon: CheckCircle2 },
  { text: "Professional PDF & smart CSV Logbook Exports", icon: Share }
];

export function PaywallScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { data: packages, isLoading: isLoadingPackages } = useSubscriptionPackages();
  const purchase = usePurchasePackage();
  const restore = useRestorePurchases();

  const handlePurchase = async (pkg: PurchasesPackage) => {
    try {
      const status = await purchase.mutateAsync(pkg);
      if (status === 'active' || status === 'trialing') {
        Alert.alert("Success!", "You are now a Pro user.", [{ text: "Awesome", onPress: () => navigation.goBack() }]);
      }
    } catch (e: any) {
      Alert.alert("Purchase Failed", e.message || "Something went wrong.");
    }
  };

  const handleRestore = async () => {
    try {
      const status = await restore.mutateAsync();
      if (status === 'active' || status === 'trialing') {
        Alert.alert("Restored", "Your PRO subscription has been restored.", [{ text: "Awesome", onPress: () => navigation.goBack() }]);
      } else {
        Alert.alert("No Subscription", "We couldn't find an active PRO subscription on this account.");
      }
    } catch (e: any) {
      Alert.alert("Restore Failed", e.message || "Failed to restore purchases.");
    }
  };

  return (
    <Screen topDivider>
      <ScrollView contentContainerStyle={{ padding: spacing.base, paddingBottom: spacing.xxl }}>
        <View style={styles.header}>
          <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center' }]}>
            Upgrade to
          </Text>
          <View style={{ alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.md }}>
            <Text style={[typography.display, { color: colors.accent, fontSize: 56, letterSpacing: 2 }]}>
              PRO
            </Text>
            <View style={{ width: 140, height: 2, backgroundColor: colors.ropeTan }} />
          </View>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            Unlock the full potential of your logbook with powerful cloud and reporting tools designed for professionals.
          </Text>
        </View>

        <SectionHeader label="WHAT YOU GET" />
        <Card accent="orange" style={{ marginBottom: spacing.xl, gap: spacing.md }}>
          {BENEFITS.map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <b.icon color={colors.accent} size={20} />
              <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>{b.text}</Text>
            </View>
          ))}
        </Card>

        {isLoadingPackages ? (
          <LoadingSpinner label="Loading offers" style={{ paddingVertical: spacing.xl }} />
        ) : packages && packages.length > 0 ? (
          <View style={{ gap: spacing.md }}>
            {packages.map((pkg) => (
              <Button
                key={pkg.identifier}
                title={`UNLOCK PRO — ${pkg.product.priceString} / ${pkg.packageType === 'ANNUAL' ? 'YR' : 'MO'}`}
                onPress={() => handlePurchase(pkg)}
                disabled={purchase.isPending}
                haptic
              />
            ))}
          </View>
        ) : (
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            No subscription packages currently available. Please check your internet connection or RevenueCat config.
          </Text>
        )}

        <View style={styles.footer}>
          <Button
            variant="ghost" 
            title={restore.isPending ? "Restoring..." : "Restore Purchases"} 
            onPress={handleRestore} 
            disabled={restore.isPending} 
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginVertical: 32,
    alignItems: 'center',
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  footer: {
    marginTop: 32,
    alignItems: 'center',
  }
});
