// src/screens/SignatureOptionsSheet.tsx
// Spec §7 lines 350-358. Bottom sheet asking how an entry will be signed.
// Reachable from PostSaveSheet's "Sign now" action and (D4) from
// EntryDetail's "Get signature" button.
//
// Two big tap targets:
//   • Sign on this device  — pushes the existing Signature flow
//   • Send to supervisor   — pushes the SendSignRequest modal (built in D3)
// Plus a Cancel ghost button that goes back to wherever the sheet was opened
// from. Hardware back / swipe-down dismiss likewise goes back, so this sheet
// is a transient picker rather than a one-shot landing target.

import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pen, Send, LucideProps } from 'lucide-react-native';
import { Button } from '../primitives';
import { Sheet } from '../primitives/Sheet';
import { useTheme } from '../theme/ThemeProvider';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'SignatureOptionsSheet'>;

interface BigTapTargetProps {
  Icon: React.ComponentType<LucideProps>;
  title: string;
  subtitle: string;
  onPress: () => void;
}

function BigTapTarget({ Icon, title, subtitle, onPress }: BigTapTargetProps) {
  const { colors, spacing, radii, borders, typography, touchTarget } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.base,
        backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
        borderRadius: radii.md,
        padding: spacing.base,
        borderWidth: borders.hair,
        borderColor: colors.border,
        minHeight: Math.max(touchTarget.preferred, 56),
      })}
    >
      <Icon size={28} color={colors.accentPrimary} />
      <View style={{ flex: 1, gap: spacing.xs / 2 }}>
        <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

export function SignatureOptionsSheet() {
  const { spacing } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { entryId } = route.params;

  // goBack rather than popToTop: SignatureOptionsSheet is reachable from
  // multiple entry points (PostSaveSheet now, EntryDetail in D4). goBack
  // returns to whichever screen pushed the sheet; popToTop would wrongly
  // dump the user past EntryDetail when they expected to return to it.
  const handleClose = () => navigation.goBack();

  return (
    <Sheet
      open={true}
      onClose={handleClose}
      title="How will this be signed?"
      scrollable={false}
    >
      <View style={{ gap: spacing.sm }}>
        <BigTapTarget
          Icon={Pen}
          title="Sign on this device"
          subtitle="Supervisor is with you right now."
          onPress={() => navigation.replace('Signature', { entryId })}
        />
        <BigTapTarget
          Icon={Send}
          title="Send to supervisor"
          subtitle="Request a remote signature."
          // TODO(D3): SendSignRequest screen will be registered in the next
          // task. Route name + param shape are settled now so this call
          // type-checks and starts working as soon as D3 lands.
          onPress={() => navigation.replace('SendSignRequest', { entryId })}
        />
        <View style={{ marginTop: spacing.sm }}>
          <Button title="Cancel" variant="ghost" onPress={handleClose} />
        </View>
      </View>
    </Sheet>
  );
}
