// src/screens/MagicLinkWaitScreen.tsx
// Light-theme "check your email" screen. Centered card with the Mail icon,
// title, the email address echoed back, plus Resend (ghost) and Back link.
// Stack header supplies the route title; we render an in-screen card-style
// layout below it.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Mail } from 'lucide-react-native';
import { Screen, Button, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createAuthService } from '../services/authService';

type Params = { MagicLinkWait: { email: string } };

export function MagicLinkWaitScreen() {
  const { colors, spacing, typography, radii, borders, shadows } = useTheme();
  const route = useRoute<RouteProp<Params, 'MagicLinkWait'>>();
  const nav = useNavigation();
  const email = route.params.email;

  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const auth = useMemo(() => createAuthService(cloud), [cloud]);

  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Revert "Link resent" → "Resend" after a few seconds so the button isn't
  // permanently disabled if the user wants to try again from the same screen.
  useEffect(() => {
    if (resendStatus !== 'sent') return;
    const id = setTimeout(() => setResendStatus('idle'), 4000);
    return () => clearTimeout(id);
  }, [resendStatus]);

  async function resend() {
    try {
      setError(null);
      setResendStatus('sending');
      await auth.signInWithMagicLink(email);
      setResendStatus('sent');
    } catch (e) {
      setError((e as Error).message ?? 'Could not resend link.');
      setResendStatus('idle');
    }
  }

  return (
    <Screen padded={false}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.xxl,
        }}
      >
        <View
          style={[
            {
              backgroundColor: colors.bgSurface,
              borderRadius: radii.md,
              borderWidth: borders.hair,
              borderColor: colors.border,
              padding: spacing.lg,
              gap: spacing.base,
              alignItems: 'center',
            },
            shadows.sm,
          ]}
        >
          <Mail color={colors.accentPrimary} size={48} />

          <Text
            style={[
              typography.title2,
              { color: colors.textPrimary, textAlign: 'center' },
            ]}
          >
            Check your email
          </Text>

          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            We sent a sign-in link to{' '}
            <Text style={{ color: colors.textPrimary }}>{email}</Text>.
          </Text>

          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            Tap the link in the email to sign in.
          </Text>

          {error && (
            <View style={{ alignSelf: 'stretch' }}>
              <Banner variant="error" message={error} />
            </View>
          )}

          <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              title={
                resendStatus === 'sending'
                  ? 'Resending…'
                  : resendStatus === 'sent'
                    ? 'Link resent'
                    : 'Resend'
              }
              variant="ghost"
              onPress={resend}
              disabled={resendStatus !== 'idle'}
            />
            <Pressable
              onPress={() => nav.goBack()}
              accessibilityRole="link"
              hitSlop={12}
              style={{
                alignSelf: 'center',
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
              }}
            >
              <Text style={[typography.label, { color: colors.accentPrimary }]}>
                Back
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}
