import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

interface EmptyStateProps { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void; }

export function EmptyState({ title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, gap: spacing.base }}>
      <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center' }]}>{title}</Text>
      {subtitle && <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>{subtitle}</Text>}
      {actionLabel && onAction && <Button title={actionLabel} onPress={onAction} style={{ marginTop: spacing.base }} />}
    </View>
  );
}
