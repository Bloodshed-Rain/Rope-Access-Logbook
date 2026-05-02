// src/screens/onboarding/CloudSignInStep.tsx
// Step 6 — only for supervisor signups. Spec §3 lines 122-124.
//
// Renders an inline auth surface (Apple/Google + magic link) instead of
// pushing to AuthScreen — the Onboarding wizard owns step state, and
// pushing/popping a sibling route loses it. Apple/Google resolve a session
// synchronously; magic-link emails route through MagicLinkWaitScreen which
// pops back here once the user taps the link (handled by App.tsx's
// `logbook://auth-callback` listener — the session arrives via the
// auth-state subscription regardless of which screen is foregrounded).
//
// "Continue" is gated on `session !== null`, so this step also tolerates
// the user starting OAuth, swiping back to the wizard before resolution,
// then completing later.

import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Button, Banner, Input, Screen } from '../../primitives';
import { useTheme } from '../../theme/ThemeProvider';
import { createSupabaseCloudClient } from '../../cloud/supabaseClient';
import { createAuthService } from '../../services/authService';
import { useAuthSession } from '../../hooks/useAuthSession';

type Nav = NativeStackNavigationProp<Record<string, never>>;

export interface CloudSignInStepProps {
  onBack: () => void;
  onSignedIn: () => void;
}

export function CloudSignInStep({ onBack, onSignedIn }: CloudSignInStepProps) {
  const { colors, spacing, typography } = useTheme();
  const nav = useNavigation<Nav>();

  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const auth = useMemo(() => createAuthService(cloud), [cloud]);
  const { session } = useAuthSession(cloud);

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<'apple' | 'google' | 'email' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Auto-advance the moment a session resolves. Covers the OAuth path
  // (synchronous return) and the magic-link path (deep link arrives while
  // the user is on this step or returns to it from MagicLinkWait).
  React.useEffect(() => {
    if (session) onSignedIn();
  }, [session, onSignedIn]);

  async function signInWith(provider: 'apple' | 'google') {
    try {
      setError(null);
      setLoading(provider);
      await auth.signInWithProvider(provider);
      // session prop will flip via the auth-state subscription; effect above advances.
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
      (
        nav as unknown as { navigate: (n: string, p: unknown) => void }
      ).navigate('MagicLinkWait', { email });
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
          <Text style={[typography.title1, { color: colors.textPrimary }]}>
            Sign in to start
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Supervisors need a cloud account so techs can find you in the
            directory and send you sign requests.
          </Text>
        </View>

        {error && <Banner variant="error" message={error} />}

        <View style={{ gap: spacing.md }}>
          {Platform.OS === 'ios' ? (
            <View
              pointerEvents={disabled ? 'none' : 'auto'}
              style={{ opacity: disabled ? 0.5 : 1 }}
            >
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={
                  AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
                }
                buttonStyle={
                  AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                }
                cornerRadius={8}
                style={{ width: '100%', height: 48 }}
                onPress={() => signInWith('apple')}
              />
            </View>
          ) : (
            <Button
              title={
                loading === 'apple' ? 'Signing in…' : 'Continue with Apple'
              }
              onPress={() => signInWith('apple')}
              disabled={disabled}
              variant="secondary"
            />
          )}
          <Button
            title={
              loading === 'google' ? 'Signing in…' : 'Continue with Google'
            }
            onPress={() => signInWith('google')}
            disabled={disabled}
            variant="secondary"
          />
        </View>

        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
        >
          <View
            style={{ flex: 1, height: 1, backgroundColor: colors.divider }}
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            or
          </Text>
          <View
            style={{ flex: 1, height: 1, backgroundColor: colors.divider }}
          />
        </View>

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
          />
        </View>

        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Button title="Back" onPress={onBack} variant="ghost" disabled={disabled} />
        </View>
      </ScrollView>
    </Screen>
  );
}
