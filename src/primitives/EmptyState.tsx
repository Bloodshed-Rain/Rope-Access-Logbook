import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';

export interface EmptyStateProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  caption?: string;
}

export function EmptyState({ title, subtitle, actionLabel, onAction, caption }: EmptyStateProps) {
  const { colors, spacing, typography, borders } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: spacing.xl,
        gap: spacing.base,
      }}
    >
      <View
        style={{
          width: 60,
          height: 60,
          borderWidth: borders.hair,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.s2,
        }}
      >
        <Text
          style={{
            fontFamily: typography.title1.fontFamily,
            fontSize: 22,
            color: colors.accentPrimary,
          }}
        >
          —
        </Text>
      </View>
      <Text style={[typography.title1, { color: colors.textPrimary, textAlign: 'center' }]}>{title}</Text>
      {subtitle && (
        <Text
          style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}
        >
          {subtitle}
        </Text>
      )}
      {actionLabel && onAction && (
        <View style={{ marginTop: spacing.base, alignItems: 'center' }}>
          <Button title={actionLabel} onPress={onAction} />
          {caption && (
            <Text style={[typography.caption, { color: colors.textDisabled, marginTop: spacing.xs }]}>
              {caption}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
