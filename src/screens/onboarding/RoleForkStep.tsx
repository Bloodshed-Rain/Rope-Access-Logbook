// src/screens/onboarding/RoleForkStep.tsx
// Step 4 — conditional. Shown only when at least one cert is L3.
// Spec §3 lines 118-121.

import React from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Briefcase, ShieldCheck } from 'lucide-react-native';
import { Button, Input, Screen } from '../../primitives';
import { useTheme } from '../../theme/ThemeProvider';
import { OnboardingState } from './types';

export interface RoleForkStepProps {
  state: OnboardingState;
  onChange: (
    patch: Partial<
      Pick<OnboardingState, 'role' | 'supervisorCertNumber' | 'directoryVisible'>
    >,
  ) => void;
  onBack: () => void;
  onNext: () => void;
}

export function RoleForkStep({
  state,
  onChange,
  onBack,
  onNext,
}: RoleForkStepProps) {
  const { colors, spacing, typography, radii, borders, touchTarget } = useTheme();

  const valid =
    state.role === 'tech' || state.supervisorCertNumber.trim().length > 0;

  const renderCard = (
    role: 'tech' | 'supervisor',
    title: string,
    subtitle: string,
    Icon: typeof Briefcase,
  ) => {
    const selected = state.role === role;
    return (
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={() => onChange({ role })}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.base,
          borderRadius: radii.md,
          borderWidth: selected ? borders.block : borders.hair,
          borderColor: selected ? colors.accentPrimary : colors.border,
          backgroundColor: selected
            ? colors.accentTint
            : pressed
              ? colors.bgMuted
              : colors.bgSurface,
          minHeight: touchTarget.preferred + 16,
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radii.md,
            backgroundColor: selected ? colors.accentPrimary : colors.bgMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            color={selected ? colors.textInverse : colors.textSecondary}
            size={22}
          />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
            {title}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen padded={false}>
      <View style={{ flex: 1, padding: spacing.base, gap: spacing.lg }}>
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.title1, { color: colors.textPrimary }]}>
            How will you use the app?
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Level III techs can sign for others. Pick how you&apos;ll start —
            you can switch later from your profile.
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          {renderCard(
            'tech',
            'Use as Tech',
            'Log your own work and collect signatures.',
            Briefcase,
          )}
          {renderCard(
            'supervisor',
            'Use as Supervisor',
            'Sign other techs’ entries plus your own.',
            ShieldCheck,
          )}
        </View>

        {state.role === 'supervisor' && (
          <View
            style={{
              gap: spacing.md,
              padding: spacing.base,
              borderRadius: radii.md,
              borderWidth: borders.hair,
              borderColor: colors.border,
              backgroundColor: colors.bgSurface,
            }}
          >
            <Input
              label="Supervisor cert number"
              value={state.supervisorCertNumber}
              onChangeText={(t) => onChange({ supervisorCertNumber: t })}
              placeholder="Your L3 cert number"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: spacing.sm,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={[typography.bodyMed, { color: colors.textPrimary }]}
                >
                  Findable in directory
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  Other techs can search for you by cert number.
                </Text>
              </View>
              <Switch
                value={state.directoryVisible}
                onValueChange={(v) => onChange({ directoryVisible: v })}
                trackColor={{
                  false: colors.borderStrong,
                  true: colors.accentPrimary,
                }}
                thumbColor={colors.bgSurface}
              />
            </View>
          </View>
        )}

        <View style={{ gap: spacing.sm, marginTop: 'auto' }}>
          <Button title="Continue" onPress={onNext} disabled={!valid} />
          <Button title="Back" onPress={onBack} variant="ghost" />
        </View>
      </View>
    </Screen>
  );
}
