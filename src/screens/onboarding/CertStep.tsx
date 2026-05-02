// src/screens/onboarding/CertStep.tsx
// Step 3 — pick IRATA, SPRAT, or both. Spec §3 line 117.
//
// For each cert held, capture: level (L1/L2/L3), cert number, expiry date.
// Card-photo capture is deliberately not wired here yet — the field is in
// state shape for parity but no picker UI is rendered (matches existing
// onboarding behavior).  Photo can be added later from Me → cert edit.

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Button, Input, Screen } from '../../primitives';
import { SegmentedControl } from '../../primitives';
import { useTheme } from '../../theme/ThemeProvider';
import { fromISODate, toISODate, formatDate } from '../../utils/dateRange';
import { CertLevel, CertScheme } from '../../types';
import { OnboardingCertSlice, OnboardingState } from './types';

export interface CertStepProps {
  state: OnboardingState;
  onChange: (certs: OnboardingState['certs']) => void;
  onBack: () => void;
  onNext: () => void;
}

const LEVEL_OPTIONS = [
  { value: 'I', label: 'L1' },
  { value: 'II', label: 'L2' },
  { value: 'III', label: 'L3' },
];

function isCertValid(slice: OnboardingCertSlice): boolean {
  if (!slice.held) return true;
  return (
    slice.level !== null &&
    slice.id.trim().length > 0 &&
    slice.expires.trim().length > 0
  );
}

export function CertStep({ state, onChange, onBack, onNext }: CertStepProps) {
  const { colors, spacing, typography, radii, borders, touchTarget } = useTheme();
  const [showSpratPicker, setShowSpratPicker] = useState(false);
  const [showIrataPicker, setShowIrataPicker] = useState(false);

  const { sprat, irata, primary } = state.certs;
  const bothHeld = sprat.held && irata.held;
  const anyHeld = sprat.held || irata.held;
  const valid = anyHeld && isCertValid(sprat) && isCertValid(irata);

  // Toggling the held flag preserves any captured fields so the user can flip
  // back without retyping; only the held boolean drives validation/render.
  const setHeld = (scheme: CertScheme, held: boolean) => {
    const next = { ...state.certs, [scheme]: { ...state.certs[scheme], held } };
    // Auto-flip primary if the user just turned off the previously-primary cert.
    if (!held && primary === scheme) {
      const otherHeld = scheme === 'sprat' ? next.irata.held : next.sprat.held;
      if (otherHeld) next.primary = scheme === 'sprat' ? 'irata' : 'sprat';
    }
    // If toggling on while no cert was held, default primary to this one.
    if (held && !anyHeld) next.primary = scheme;
    onChange(next);
  };

  const updateCert = (scheme: CertScheme, patch: Partial<OnboardingCertSlice>) => {
    onChange({
      ...state.certs,
      [scheme]: { ...state.certs[scheme], ...patch },
    });
  };

  const renderToggleRow = (scheme: CertScheme, label: string) => {
    const slice = state.certs[scheme];
    return (
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: slice.held }}
        onPress={() => setHeld(scheme, !slice.held)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.base,
          paddingVertical: spacing.md,
          minHeight: touchTarget.preferred,
          borderRadius: radii.md,
          borderWidth: borders.hair,
          borderColor: slice.held ? colors.accentPrimary : colors.border,
          backgroundColor: slice.held
            ? colors.accentTint
            : pressed
              ? colors.bgMuted
              : colors.bgSurface,
        })}
      >
        <Text
          style={[
            typography.bodyMed,
            { color: colors.textPrimary },
          ]}
        >
          I hold {label}
        </Text>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: radii.xs,
            borderWidth: borders.block,
            borderColor: slice.held ? colors.accentPrimary : colors.borderStrong,
            backgroundColor: slice.held ? colors.accentPrimary : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {slice.held && (
            <Text style={{ color: colors.textInverse, fontSize: 14, lineHeight: 16 }}>
              {'✓'}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  const renderCertBlock = (
    scheme: CertScheme,
    schemeLabel: string,
    showPicker: boolean,
    setShowPicker: (b: boolean) => void,
  ) => {
    const slice = state.certs[scheme];
    if (!slice.held) return null;
    return (
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
        <Text style={[typography.title2, { color: colors.textPrimary }]}>
          {schemeLabel} details
        </Text>

        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>Level</Text>
          <SegmentedControl
            options={LEVEL_OPTIONS}
            value={slice.level ?? ''}
            onChange={(v) => updateCert(scheme, { level: v as CertLevel })}
          />
        </View>

        <Input
          label={`${schemeLabel} cert number`}
          value={slice.id}
          onChangeText={(t) => updateCert(scheme, { id: t })}
          placeholder={scheme === 'sprat' ? '12345' : 'XXXX/XX'}
          autoCapitalize="characters"
          autoCorrect={false}
        />

        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>
            Expiry date
          </Text>
          <Pressable
            onPress={() => setShowPicker(true)}
            style={{
              borderWidth: borders.hair,
              borderColor: colors.borderStrong,
              borderRadius: radii.sm,
              paddingHorizontal: spacing.base,
              paddingVertical: spacing.md,
              minHeight: touchTarget.min,
              justifyContent: 'center',
              backgroundColor: colors.bgSurface,
            }}
          >
            <Text
              style={[
                typography.body,
                {
                  color: slice.expires ? colors.textPrimary : colors.textDisabled,
                },
              ]}
            >
              {slice.expires ? formatDate(slice.expires) : 'Select date'}
            </Text>
          </Pressable>
          {showPicker && (
            <DateTimePicker
              value={slice.expires ? fromISODate(slice.expires) : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              minimumDate={new Date()}
              onChange={(e: DateTimePickerEvent, d?: Date) => {
                if (Platform.OS === 'android') setShowPicker(false);
                if (e.type === 'set' && d) {
                  updateCert(scheme, { expires: toISODate(d) });
                  if (Platform.OS === 'ios') setShowPicker(false);
                } else if (Platform.OS === 'ios' && e.type === 'dismissed') {
                  setShowPicker(false);
                }
              }}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            padding: spacing.base,
            paddingBottom: spacing.xxl,
            gap: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.title1, { color: colors.textPrimary }]}>
              Your certifications
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              Pick the schemes you&apos;re certified under. You can update these
              later in your profile.
            </Text>
          </View>

          <View style={{ gap: spacing.sm }}>
            {renderToggleRow('sprat', 'SPRAT')}
            {renderToggleRow('irata', 'IRATA')}
          </View>

          {renderCertBlock('sprat', 'SPRAT', showSpratPicker, setShowSpratPicker)}
          {renderCertBlock('irata', 'IRATA', showIrataPicker, setShowIrataPicker)}

          {bothHeld && (
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.label, { color: colors.textSecondary }]}>
                Primary cert
              </Text>
              <SegmentedControl
                options={[
                  { value: 'sprat', label: 'SPRAT' },
                  { value: 'irata', label: 'IRATA' },
                ]}
                value={primary}
                onChange={(v) => onChange({ ...state.certs, primary: v as CertScheme })}
              />
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                Your primary cert appears first on the dashboard and exported logbook.
              </Text>
            </View>
          )}

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button title="Continue" onPress={onNext} disabled={!valid} />
            <Button title="Back" onPress={onBack} variant="ghost" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
