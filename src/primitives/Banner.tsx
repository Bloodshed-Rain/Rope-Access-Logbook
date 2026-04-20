import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface BannerProps {
  message: string; variant: 'warning' | 'error' | 'info' | 'success';
  actionLabel?: string; onAction?: () => void; onDismiss?: () => void;
}

export function Banner({ message, variant, actionLabel, onAction, onDismiss }: BannerProps) {
  const { colors, spacing, typography, radii } = useTheme();
  const bgMap = { warning: colors.warningLight, error: colors.errorLight, info: colors.accentLight, success: '#E8F5E9' };
  const textMap = { warning: colors.warning, error: colors.error, info: colors.accent, success: '#2E7D32' };
  return (
    <View style={{ backgroundColor: bgMap[variant], borderRadius: radii.md, padding: spacing.md,
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Text style={[typography.bodySmall, { color: textMap[variant], flex: 1 }]}>{message}</Text>
      {actionLabel && onAction && (
        <Pressable onPress={onAction}>
          <Text style={[typography.bodySmall, { color: textMap[variant], fontWeight: '700' }]}>{actionLabel}</Text>
        </Pressable>
      )}
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={[typography.body, { color: textMap[variant] }]}>x</Text>
        </Pressable>
      )}
    </View>
  );
}
