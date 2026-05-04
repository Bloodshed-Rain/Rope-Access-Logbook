// src/screens/EditCertsScreen.tsx
//
// Edit screen for SPRAT + IRATA cert details on an existing profile.
// Mirrors the structure of onboarding/CertStep but writes through
// profileService.upsertSpratCert / upsertIrataCert / removeCert /
// updateProfile (for the primary toggle), and only allows save when
// something has actually changed.
//
// Important invariants preserved here:
//   - tech_level_snapshot / irata_level_snapshot on existing entries are
//     NOT touched. Editing the profile's level only affects new entries
//     going forward (signed entries snapshot the level at creation time
//     to keep their hash stable).
//   - removing the only held cert is rejected (matches the service guard).

import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, Input, SegmentedControl, useToast } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { getClient } from '../db/initialize';
import { createProfileService } from '../services/profileService';
import { fromISODate, toISODate, formatDate } from '../utils/dateRange';
import { CertLevel, CertScheme } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface CertSlice {
  held: boolean;
  level: CertLevel | null;
  id: string;
  expires: string;
}

interface FormState {
  sprat: CertSlice;
  irata: CertSlice;
  primary: CertScheme;
}

const LEVEL_OPTIONS = [
  { value: 'I', label: 'L1' },
  { value: 'II', label: 'L2' },
  { value: 'III', label: 'L3' },
];

function isSliceComplete(slice: CertSlice): boolean {
  if (!slice.held) return true;
  return slice.level !== null && slice.id.trim().length > 0 && !!slice.expires;
}

export function EditCertsScreen() {
  const { colors, spacing, typography, radii, borders, touchTarget } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: profile } = useProfile();
  const toast = useToast();

  const db = useMemo(() => getClient(), []);
  const service = useMemo(() => createProfileService(db), [db]);

  const initialFromProfile = useMemo<FormState | null>(() => {
    if (!profile) return null;
    return {
      sprat: {
        held: profile.holds_sprat,
        level: profile.level,
        id: profile.sprat_id ?? '',
        expires: profile.cert_expires_on ?? '',
      },
      irata: {
        held: profile.holds_irata,
        level: profile.irata_level,
        id: profile.irata_id ?? '',
        expires: profile.irata_expires_on ?? '',
      },
      primary: profile.primary_cert,
    };
  }, [profile]);

  const [state, setState] = useState<FormState | null>(initialFromProfile);
  const [showSpratPicker, setShowSpratPicker] = useState(false);
  const [showIrataPicker, setShowIrataPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed once when the profile query resolves on first mount.
  React.useEffect(() => {
    if (!state && initialFromProfile) setState(initialFromProfile);
  }, [state, initialFromProfile]);

  if (!state || !profile || !initialFromProfile) {
    return <Screen padded={false}><View /></Screen>;
  }

  const updateSlice = (scheme: CertScheme, patch: Partial<CertSlice>) => {
    setState((p) =>
      p ? { ...p, [scheme]: { ...p[scheme], ...patch } } : p,
    );
  };

  const setHeld = (scheme: CertScheme, held: boolean) => {
    setState((p) => {
      if (!p) return p;
      const next = { ...p, [scheme]: { ...p[scheme], held } };
      // If the user just turned off the primary cert, flip primary to the
      // other scheme (if held). The save step rejects the case where both
      // are off, so we can blindly auto-flip here.
      if (!held && next.primary === scheme) {
        const other: CertScheme = scheme === 'sprat' ? 'irata' : 'sprat';
        if (next[other].held) next.primary = other;
      }
      return next;
    });
  };

  const anyHeld = state.sprat.held || state.irata.held;
  const allComplete = isSliceComplete(state.sprat) && isSliceComplete(state.irata);
  const dirty =
    JSON.stringify(state) !== JSON.stringify(initialFromProfile);
  const canSave = anyHeld && allComplete && dirty && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      // SPRAT: add / update / remove based on held flag transitions.
      if (state.sprat.held) {
        if (state.sprat.level && state.sprat.id && state.sprat.expires) {
          await service.upsertSpratCert({
            id: state.sprat.id.trim(),
            level: state.sprat.level,
            cert_expires_on: state.sprat.expires,
            card_photo_path: profile.sprat_card_photo_path,
          });
        }
      } else if (initialFromProfile.sprat.held) {
        await service.removeCert('sprat');
      }

      // IRATA same.
      if (state.irata.held) {
        if (state.irata.level && state.irata.id && state.irata.expires) {
          await service.upsertIrataCert({
            id: state.irata.id.trim(),
            level: state.irata.level,
            cert_expires_on: state.irata.expires,
            card_photo_path: profile.irata_card_photo_path,
          });
        }
      } else if (initialFromProfile.irata.held) {
        await service.removeCert('irata');
      }

      // Primary cert switch — only fires if both held, since removing the
      // only cert wouldn't reach this branch (removeCert auto-flips primary).
      if (state.primary !== initialFromProfile.primary) {
        await service.updateProfile({ primary_cert: state.primary });
      }

      toast.show({ message: 'Certifications updated.', variant: 'ok' });
      navigation.goBack();
    } catch (e) {
      toast.show({ message: (e as Error).message, variant: 'err' });
    } finally {
      setSaving(false);
    }
  };

  const renderHeldRow = (scheme: CertScheme, label: string) => {
    const slice = state[scheme];
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
        <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>I hold {label}</Text>
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
    label: string,
    showPicker: boolean,
    setShowPicker: (b: boolean) => void,
  ) => {
    const slice = state[scheme];
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
        <Text style={[typography.title2, { color: colors.textPrimary }]}>{label} details</Text>

        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>Level</Text>
          <SegmentedControl
            options={LEVEL_OPTIONS}
            value={slice.level ?? ''}
            onChange={(v) => updateSlice(scheme, { level: v as CertLevel })}
          />
        </View>

        <Input
          label={`${label} cert number`}
          value={slice.id}
          onChangeText={(t) =>
            updateSlice(scheme, { id: t.replace(/\D/g, '').slice(0, 5) })
          }
          placeholder="12345"
          keyboardType="number-pad"
          maxLength={5}
          autoCorrect={false}
        />

        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>Expiry date</Text>
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
                { color: slice.expires ? colors.textPrimary : colors.textDisabled },
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
                  updateSlice(scheme, { expires: toISODate(d) });
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

  const bothHeld = state.sprat.held && state.irata.held;

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
            <Text style={[typography.title1, { color: colors.textPrimary }]}>Edit certifications</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              Changing your level here applies to entries you log going forward.
              Existing signed entries keep the level they were signed at.
            </Text>
          </View>

          <View style={{ gap: spacing.sm }}>
            {renderHeldRow('sprat', 'SPRAT')}
            {renderHeldRow('irata', 'IRATA')}
          </View>

          {renderCertBlock('sprat', 'SPRAT', showSpratPicker, setShowSpratPicker)}
          {renderCertBlock('irata', 'IRATA', showIrataPicker, setShowIrataPicker)}

          {bothHeld && (
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.label, { color: colors.textSecondary }]}>Primary cert</Text>
              <SegmentedControl
                options={[
                  { value: 'sprat', label: 'SPRAT' },
                  { value: 'irata', label: 'IRATA' },
                ]}
                value={state.primary}
                onChange={(v) =>
                  setState((p) => (p ? { ...p, primary: v as CertScheme } : p))
                }
              />
            </View>
          )}

          {!anyHeld && (
            <Text style={[typography.caption, { color: colors.statusErr }]}>
              You must hold at least one certification.
            </Text>
          )}

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => {
                  if (dirty) {
                    Alert.alert(
                      'Discard changes?',
                      'Your edits will be lost.',
                      [
                        { text: 'Keep editing', style: 'cancel' },
                        { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
                      ],
                    );
                  } else {
                    navigation.goBack();
                  }
                }}
              />
            </View>
            <View style={{ flex: 2 }}>
              <Button
                title="Save"
                variant="primary"
                onPress={handleSave}
                disabled={!canSave}
                loading={saving}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
