import React, { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, Alert, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Svg, { Path } from 'react-native-svg';
import { Screen, Button, Input } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useCreateProfile } from '../hooks/useProfile';
import { SpratLevel } from '../types';
import { Chip } from '../primitives/Chip';

type Step = 'welcome' | 'data-warning' | 'profile';

function Figure8Knot() {
  const { colors } = useTheme();
  return (
    <Svg width="160" height="160" viewBox="0 0 100 100">
      <Path
        d="M 50 10 C 30 10 30 40 50 40 C 70 40 70 70 50 70 C 30 70 30 50 50 50 C 70 50 70 20 50 20"
        fill="none"
        stroke={colors.navy}
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 50 10 C 30 10 30 40 50 40 C 70 40 70 70 50 70 C 30 70 30 50 50 50 C 70 50 70 20 50 20"
        fill="none"
        stroke={colors.ropeTanLight}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function OnboardingScreen() {
  const { colors, spacing, typography, radii, touchTarget } = useTheme();
  const nav = useNavigation();
  const navTo = (name: string) =>
    (nav as unknown as { navigate: (n: string) => void }).navigate(name);
  const [step, setStep] = useState<Step>('welcome');
  const [fullName, setFullName] = useState('');
  const [spratId, setSpratId] = useState('');
  const [level, setLevel] = useState<SpratLevel>('I');
  const [certExpiresOn, setCertExpiresOn] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [employer, setEmployer] = useState('');
  const createProfile = useCreateProfile();

  const levels: SpratLevel[] = ['I', 'II', 'III'];

  if (step === 'welcome') {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg, padding: spacing.xl }}>
          <Figure8Knot />
          <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing.md }]}>
            ROPE ACCESS LOGBOOK
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            Your digital SPRAT work-experience logbook. Log hours, capture signatures, export for re-certification.
          </Text>
          
          <View style={{ width: '100%', marginTop: spacing.xl, gap: spacing.base }}>
            <Button title="START LOGGING" onPress={() => setStep('data-warning')} />
            <Button title="SIGN IN" variant="ghost" onPress={() => navTo('Auth')} />
          </View>
        </View>
      </Screen>
    );
  }

  if (step === 'data-warning') {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.lg, padding: spacing.xl }}>
          <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center' }]}>Local storage</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Your data is stored locally on this device. There is no cloud backup in this version.
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Export your logbook regularly. A lost or broken phone means a lost logbook without a backup.
          </Text>
          <Button title="I UNDERSTAND" onPress={() => setStep('profile')} style={{ marginTop: spacing.lg }} />
        </View>
      </Screen>
    );
  }

  const canSubmit = fullName.trim() && spratId.trim() && certExpiresOn.trim();

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: spacing.base, padding: spacing.base, paddingBottom: spacing.xxl }}>
          <Text style={[typography.h1, { color: colors.textPrimary, marginTop: spacing.md }]}>Create your profile</Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>You can update this later in your profile tab.</Text>
          <Input label="Full name" value={fullName} onChangeText={setFullName} placeholder="John Doe" />
          <Input
            label="SPRAT ID"
            value={spratId}
            onChangeText={(t) => setSpratId(t.replace(/\D/g, '').slice(0, 5))}
            placeholder="12345"
            keyboardType="number-pad"
            maxLength={5}
          />
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, fontWeight: '600', letterSpacing: 0.3 }]}>Current level</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {levels.map((l) => (
                <Chip key={l} label={`Level ${l}`} selected={level === l} onPress={() => setLevel(l)} />
              ))}
            </View>
          </View>
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary, fontWeight: '600', letterSpacing: 0.3 }]}>Certification expiry date</Text>
            <Pressable onPress={() => setShowDatePicker(true)}>
              <View style={{
                borderWidth: 2, borderColor: colors.border, borderRadius: radii.md,
                paddingHorizontal: spacing.base, paddingVertical: spacing.base,
                minHeight: touchTarget.min, justifyContent: 'center',
                backgroundColor: colors.surface,
              }}>
                <Text style={[typography.body, { color: certExpiresOn ? colors.textPrimary : colors.textTertiary }]}>
                  {certExpiresOn || 'Select date'}
                </Text>
              </View>
            </Pressable>
            {showDatePicker && (
              <DateTimePicker
                value={certExpiresOn ? new Date(certExpiresOn) : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                minimumDate={new Date()}
                onChange={(event, selectedDate) => {
                  if (Platform.OS === 'android') setShowDatePicker(false);
                  if (event.type === 'set' && selectedDate) {
                    setCertExpiresOn(selectedDate.toISOString().slice(0, 10));
                    if (Platform.OS === 'ios') setShowDatePicker(false);
                  } else if (Platform.OS === 'ios' && event.type === 'dismissed') {
                    setShowDatePicker(false);
                  }
                }}
              />
            )}
          </View>
          <Input label="Default employer" value={employer} onChangeText={setEmployer} placeholder="Company name" />
          <Button title="CREATE PROFILE" onPress={() => createProfile.mutate({
            full_name: fullName.trim(), sprat_id: spratId.trim(), level,
            cert_expires_on: certExpiresOn.trim(), default_employer: employer.trim(),
          }, {
            onSuccess: () => {
              Alert.alert(
                'Back up your logbook?',
                'Sign in to keep your logbook safe in the cloud and restore it on a new phone. You can do this later from Profile.',
                [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Sign up', onPress: () => navTo('Auth') },
                ],
              );
            },
          })} disabled={!canSubmit} loading={createProfile.isPending} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
