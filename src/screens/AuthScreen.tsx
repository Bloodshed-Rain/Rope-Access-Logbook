// src/screens/AuthScreen.tsx
// Light-theme sign-in. Apple (native button on iOS, themed Button on
// Android) + Google + email magic-link. The stack header already supplies
// the screen title via RootNavigator, so we keep an in-screen title1 for
// hierarchy (mirrors the SupervisorSearch pattern).

import React, { useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Screen, Button, Input, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createAuthService } from '../services/authService';

type Nav = NativeStackNavigationProp<Record<string, never>>;

export function AuthScreen() {
  const { colors, spacing, typography } = useTheme();
  const nav = useNavigation<Nav>();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<'apple' | 'google' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cloud = createSupabaseCloudClient();
  const auth = createAuthService(cloud);

  async function signInWith(provider: 'apple' | 'google') {
    try {
      setError(null);
      setLoading(provider);
      await auth.signInWithProvider(provider);
    } catch (e) {
      setError((e as Error).message ?? 'Sign-in failed. Try again.');
    } finally {
      setLoading(null);
    }
  }

  async function sendMagicLink() {
    if (!email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    try {
      setError(null);
      setLoading('email');
      await auth.signInWithMagicLink(email);
      (nav as unknown as { navigate: (name: string, params: unknown) => void }).navigate(
        'MagicLinkWait',
        { email },
      );
    } catch (e) {
      setError((e as Error).message ?? 'Could not send link. Try again.');
    } finally {
      setLoading(null);
    }
  }

  const disabled = loading !== null;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.title1, { color: colors.textPrimary }]}>Sign in</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Sign in to back up your logbook to the cloud.
          </Text>
        </View>

        {error && <Banner variant="error" message={error} />}

        {/* Provider buttons */}
        <View style={{ gap: spacing.md }}>
          {Platform.OS === 'ios' ? (
            <View
              style={{
                opacity: disabled ? 0.5 : 1,
                pointerEvents: disabled ? 'none' : 'auto',
              }}
            >
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={8}
                style={{ width: '100%', height: 48 }}
                onPress={() => signInWith('apple')}
              />
            </View>
          ) : (
            <Button
              title={loading === 'apple' ? 'Signing in…' : 'Continue with Apple'}
              onPress={() => signInWith('apple')}
              disabled={disabled}
              variant="secondary"
            />
          )}
          <Button
            title={loading === 'google' ? 'Signing in…' : 'Continue with Google'}
            onPress={() => signInWith('google')}
            disabled={disabled}
            variant="secondary"
          />
        </View>

        {/* Divider */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>or</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.divider }} />
        </View>

        {/* Email magic link */}
        <View style={{ gap: spacing.md }}>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
          />
          <Button
            title={loading === 'email' ? 'Sending…' : 'Send magic link'}
            onPress={sendMagicLink}
            disabled={disabled}
            variant="primary"
            haptic
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
