import React from 'react';
import { View, Text } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Screen, Card, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { Mail } from 'lucide-react-native';

type Params = { MagicLinkWait: { email: string } };

export function MagicLinkWaitScreen() {
  const { colors, spacing, typography } = useTheme();
  const route = useRoute<RouteProp<Params, 'MagicLinkWait'>>();
  const email = route.params.email;

  return (
    <Screen topDivider>
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.base, paddingBottom: spacing.xxl }}>
        <SectionHeader label="AUTHENTICATION" />
        
        <Card accent="orange" bg="paper" style={{ gap: spacing.base, paddingVertical: spacing.lg }}>
          <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
            <Mail color={colors.accent} size={48} />
          </View>
          
          <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center' }]}>Check your email</Text>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>
            We sent a sign-in link to {email}. Open it on this device to continue.
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textTertiary, textAlign: 'center', fontStyle: 'italic', marginTop: spacing.base }]}>
            The link expires in an hour. You can close this screen and come back anytime.
          </Text>
        </Card>

      </View>
    </Screen>
  );
}
