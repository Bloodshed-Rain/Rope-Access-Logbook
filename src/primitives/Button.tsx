import React from 'react';
import { Pressable, Text, ViewStyle, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ButtonProps {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false, style }: ButtonProps) {
  const { colors, spacing, typography, radii, touchTarget } = useTheme();
  const bgColor = variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.surface : 'transparent';
  const textColor = variant === 'primary' ? colors.textInverse : variant === 'secondary' ? colors.navy : colors.accent;
  const borderColor = variant === 'secondary' ? colors.navy : 'transparent';

  return (
    <Pressable onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [
        { backgroundColor: bgColor, borderRadius: radii.md,
          minHeight: touchTarget.min, paddingVertical: spacing.base,
          paddingHorizontal: spacing.lg, borderWidth: variant === 'secondary' ? 2 : 0, borderColor,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1, alignItems: 'center' as const,
          justifyContent: 'center' as const, flexDirection: 'row' as const, gap: spacing.sm },
        style,
      ]}>
      {loading && <ActivityIndicator size="small" color={textColor} />}
      <Text style={[typography.bodyBold, { color: textColor, letterSpacing: 0.3 }]}>{title}</Text>
    </Pressable>
  );
}
