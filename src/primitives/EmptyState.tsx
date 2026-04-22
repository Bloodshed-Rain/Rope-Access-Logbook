import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { RopeDivider } from './RopeDivider';

export interface EmptyStateProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  caption?: string;
}

export function EmptyState({ title, subtitle, actionLabel, onAction, caption }: EmptyStateProps) {
  const { colors, spacing, typography } = useTheme();
  
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, gap: spacing.base }}>
      <View style={{ width: 120, alignItems: 'center', marginBottom: spacing.xs }}>
        <RopeDivider />
      </View>
      <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center' }]}>{title}</Text>
      {subtitle && <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <View style={{ marginTop: spacing.base, alignItems: 'center' }}>
          <Button title={actionLabel} onPress={onAction} />
          {caption && <Text style={[typography.stencil, { color: colors.textTertiary, marginTop: spacing.xs }]}>{caption}</Text>}
        </View>
      )}
    </View>
  );
}
