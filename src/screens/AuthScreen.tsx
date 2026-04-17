import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
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
      (nav as unknown as { navigate: (name: string, params: unknown) => void }).navigate('MagicLinkWait', { email });
    } catch (e) {
      setError((e as Error).message ?? 'Could not send link. Try again.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <Screen>
      <View style={{ padding: spacing.base, gap: spacing.base }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Back up your logbook</Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          Your logbook stays on this device. Signing in lets you restore it on a new phone if you lose or replace this one.
        </Text>

        {error && <Banner variant="error" message={error} />}

        <Button
          title={loading === 'apple' ? 'Signing in…' : 'Continue with Apple'}
          onPress={() => signInWith('apple')}
          disabled={loading !== null}
        />
        <Button
          title={loading === 'google' ? 'Signing in…' : 'Continue with Google'}
          onPress={() => signInWith('google')}
          disabled={loading !== null}
          variant="secondary"
        />

        <Text style={[typography.bodySmall, { textAlign: 'center', color: colors.textSecondary }]}>or use email</Text>

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
          title={loading === 'email' ? 'Sending…' : 'Send me a sign-in link'}
          onPress={sendMagicLink}
          disabled={loading !== null}
          variant="secondary"
        />
      </View>
    </Screen>
  );
}
