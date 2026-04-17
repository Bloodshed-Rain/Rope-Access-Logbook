import React from 'react';
import { View, Text } from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Screen } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';

type Params = { MagicLinkWait: { email: string } };

export function MagicLinkWaitScreen() {
  const { colors, spacing, typography } = useTheme();
  const route = useRoute<RouteProp<Params, 'MagicLinkWait'>>();
  const email = route.params.email;

  return (
    <Screen>
      <View style={{ padding: spacing.base, gap: spacing.base }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Check your email</Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          We sent a sign-in link to {email}. Open it on this device to continue.
        </Text>
        <Text style={[typography.bodySmall, { color: colors.textSecondary, fontStyle: 'italic' }]}>
          The link expires in an hour. You can close this screen and come back anytime.
        </Text>
      </View>
    </Screen>
  );
}
