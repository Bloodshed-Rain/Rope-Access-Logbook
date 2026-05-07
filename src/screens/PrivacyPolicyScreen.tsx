// src/screens/PrivacyPolicyScreen.tsx
//
// Placeholder screen surfaced from Settings → Privacy policy. Replaces the
// "Coming soon" alert with a navigable screen so the link actually works
// and reads as legitimate. The body text is pre-launch boilerplate; swap
// in the real document before listing the app on either store.

import React from 'react';
import { ScrollView, Text } from 'react-native';
import { Screen } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';

export function PrivacyPolicyScreen() {
  const { colors, spacing, typography } = useTheme();
  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.md,
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Privacy policy</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          Effective date: pending publication
        </Text>

        <Text style={[typography.body, { color: colors.textPrimary }]}>
          Rope Access Logbook stores your work history, certification details,
          and signatures locally on your device. When you sign in, an encrypted
          backup of this data is uploaded to your private Supabase storage so
          the logbook survives reinstalls and moves with you across devices.
        </Text>

        <Text style={[typography.body, { color: colors.textPrimary }]}>
          We do not sell your data. We do not share it with third parties for
          advertising. The supervisor directory only shows your name and SPRAT
          cert number when you opt in via Settings, and only authenticated
          users searching the rate-limited supervisor search can see results.
        </Text>

        <Text style={[typography.body, { color: colors.textPrimary }]}>
          Subscription billing is handled by RevenueCat in conjunction with
          Apple App Store / Google Play. Card numbers are never visible to us.
        </Text>

        <Text style={[typography.body, { color: colors.textPrimary }]}>
          You can delete your account at any time from Settings → Delete
          account. This permanently removes the cloud copy of your data; the
          local copy on your device is not exported anywhere first.
        </Text>

        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.md }]}>
          The above is pre-launch boilerplate, not a final legal document.
          For pre-launch questions or data requests, email
          strsmichael@gmail.com.
        </Text>
      </ScrollView>
    </Screen>
  );
}
