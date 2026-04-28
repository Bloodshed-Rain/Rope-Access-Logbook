import React, { useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Screen, Button, Input, Banner, Card, SectionHeader } from '../primitives';
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
      (nav as unknown as { navigate: (name: string, params: unknown) => void }).navigate('MagicLinkWait', { email });
    } catch (e) {
      setError((e as Error).message ?? 'Could not send link. Try again.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <Screen topDivider>
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.base, paddingBottom: spacing.xxl }}>
        <SectionHeader label="SIGN IN" />
        
        <Card accent="orange" bg="paper" style={{ gap: spacing.base, paddingVertical: spacing.lg }}>
          <View style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>Back up your logbook</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              Signing in lets you restore your data on a new device.
            </Text>
          </View>

          {error && <Banner variant="error" message={error} />}

          {Platform.OS === 'ios' ? (
            <View
              style={{
                opacity: loading !== null ? 0.5 : 1,
                pointerEvents: loading !== null ? 'none' : 'auto',
              }}
            >
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={0}
                style={{ width: '100%', height: 48 }}
                onPress={() => signInWith('apple')}
              />
            </View>
          ) : (
            <Button
              title={loading === 'apple' ? 'Signing in…' : 'Continue with Apple'}
              onPress={() => signInWith('apple')}
              disabled={loading !== null}
              variant="secondary"
            />
          )}
          <Button
            title={loading === 'google' ? 'Signing in…' : 'Continue with Google'}
            onPress={() => signInWith('google')}
            disabled={loading !== null}
            variant="secondary"
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: spacing.sm }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.hairline }} />
            <Text style={[typography.stencil, { marginHorizontal: spacing.sm, color: colors.textTertiary }]}>OR</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.hairline }} />
          </View>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            editable={loading === null}
          />
          <Button
            title={loading === 'email' ? 'Sending…' : 'Send sign-in link'}
            onPress={sendMagicLink}
            disabled={loading !== null}
            haptic
          />
        </Card>

      </View>
    </Screen>
  );
}
