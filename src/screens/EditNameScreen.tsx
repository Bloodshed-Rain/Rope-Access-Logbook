// src/screens/EditNameScreen.tsx
//
// Single-field profile-name edit. Reachable from the Settings sheet's
// "Edit name" row and from MeScreen's identity card. Saves on tap, toasts
// outcome, navigates back.

import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, Input, useToast } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function EditNameScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const toast = useToast();

  const [name, setName] = useState(profile?.full_name ?? '');

  const trimmed = name.trim();
  // Disable save when blank or unchanged from the persisted value so the
  // button doesn't fire a no-op mutation that still bumps updated_at.
  const canSave =
    trimmed.length > 0 &&
    trimmed !== (profile?.full_name ?? '') &&
    !updateProfile.isPending;

  const handleSave = () => {
    if (!canSave) return;
    updateProfile.mutate(
      { full_name: trimmed },
      {
        onSuccess: () => {
          toast.show({ message: 'Name updated.', variant: 'ok' });
          navigation.goBack();
        },
        onError: (e) => {
          toast.show({ message: (e as Error).message, variant: 'err' });
        },
      },
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          gap: spacing.base,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>
          Edit name
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          The name printed on your exported logbook PDF.
        </Text>

        <Input
          label="Full name"
          value={name}
          onChangeText={setName}
          placeholder="Jane Doe"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Cancel"
              variant="ghost"
              onPress={() => navigation.goBack()}
            />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              title="Save"
              variant="primary"
              onPress={handleSave}
              disabled={!canSave}
              loading={updateProfile.isPending}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
