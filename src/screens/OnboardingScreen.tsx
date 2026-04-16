import React, { useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Screen, Button, Input } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useCreateProfile } from '../hooks/useProfile';
import { SpratLevel } from '../types';
import { Chip } from '../primitives/Chip';

type Step = 'welcome' | 'data-warning' | 'profile';

export function OnboardingScreen() {
  const { colors, spacing, typography } = useTheme();
  const [step, setStep] = useState<Step>('welcome');
  const [fullName, setFullName] = useState('');
  const [spratId, setSpratId] = useState('');
  const [level, setLevel] = useState<SpratLevel>('I');
  const [certExpiresOn, setCertExpiresOn] = useState('');
  const [employer, setEmployer] = useState('');
  const createProfile = useCreateProfile();

  const levels: SpratLevel[] = ['I', 'II', 'III'];

  if (step === 'welcome') {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg, padding: spacing.xl }}>
          <Text style={[typography.display, { color: colors.textPrimary, textAlign: 'center' }]}>Rope Access Logbook</Text>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            Your digital SPRAT work-experience logbook. Log hours, capture supervisor signatures, export for re-certification.
          </Text>
          <Button title="Get started" onPress={() => setStep('data-warning')} style={{ marginTop: spacing.lg }} />
          <Button title="Skip" variant="ghost" onPress={() => setStep('profile')} />
        </View>
      </Screen>
    );
  }

  if (step === 'data-warning') {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: spacing.lg, padding: spacing.xl }}>
          <Text style={[typography.h1, { color: colors.textPrimary }]}>Your logbook lives on this device</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Your data is stored locally on this device. There is no cloud backup in this version.
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Export your logbook regularly — we will remind you monthly. A lost or broken phone means a lost logbook without a backup.
          </Text>
          <Button title="I understand, continue" onPress={() => setStep('profile')} style={{ marginTop: spacing.lg }} />
        </View>
      </Screen>
    );
  }

  const canSubmit = fullName.trim() && spratId.trim() && certExpiresOn.trim();

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ gap: spacing.base, padding: spacing.base, paddingBottom: spacing.xxl }}>
          <Text style={[typography.h1, { color: colors.textPrimary }]}>Create your profile</Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>You can update this later in your profile tab.</Text>
          <Input label="Full name" value={fullName} onChangeText={setFullName} placeholder="John Doe" />
          <Input label="SPRAT ID" value={spratId} onChangeText={setSpratId} placeholder="SPRAT-12345" />
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Current level</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {levels.map((l) => (
                <Chip key={l} label={`Level ${l}`} selected={level === l} onPress={() => setLevel(l)} />
              ))}
            </View>
          </View>
          <Input label="Certification expiry date" value={certExpiresOn} onChangeText={setCertExpiresOn} placeholder="YYYY-MM-DD" />
          <Input label="Default employer" value={employer} onChangeText={setEmployer} placeholder="Company name" />
          <Button title="Create profile" onPress={() => createProfile.mutate({
            full_name: fullName.trim(), sprat_id: spratId.trim(), level,
            cert_expires_on: certExpiresOn.trim(), default_employer: employer.trim(),
          })} disabled={!canSubmit} loading={createProfile.isPending} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
