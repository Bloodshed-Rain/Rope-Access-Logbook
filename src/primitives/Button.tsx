import React from 'react';
import { Pressable, Text, ViewStyle, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ButtonProps {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean; loading?: boolean; style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false, style }: ButtonProps) {
  const { colors, spacing, typography, radii } = useTheme();
  const bgColor = variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.surface : 'transparent';
  const textColor = variant === 'primary' ? colors.textInverse : colors.accent;
  const borderColor = variant === 'secondary' ? colors.accent : 'transparent';

  return (
    <Pressable onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [
        { backgroundColor: bgColor, borderRadius: radii.md, paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg, borderWidth: variant === 'secondary' ? 1.5 : 0, borderColor,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1, alignItems: 'center' as const,
          justifyContent: 'center' as const, flexDirection: 'row' as const, gap: spacing.sm },
        style,
      ]}>
      {loading && <ActivityIndicator size="small" color={textColor} />}
      <Text style={[typography.body, { fontWeight: '600', color: textColor }]}>{title}</Text>
    </Pressable>
  );
}
