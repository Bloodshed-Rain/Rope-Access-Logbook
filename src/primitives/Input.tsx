import React, { useState } from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface InputProps extends TextInputProps { label: string; error?: string; }

export function Input({ label, error, style, ...props }: InputProps) {
  const { colors, spacing, typography, radii, touchTarget } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.bodySmall, { color: colors.textSecondary, fontWeight: '600', letterSpacing: 0.3 }]}>{label}</Text>
      <TextInput
        style={[typography.body, {
          borderWidth: 2, borderColor: error ? colors.error : focused ? colors.borderFocused : colors.border,
          borderRadius: radii.md, paddingHorizontal: spacing.base, paddingVertical: spacing.base,
          minHeight: touchTarget.min,
          color: colors.textPrimary, backgroundColor: colors.surface }, style]}
        placeholderTextColor={colors.textTertiary}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} {...props} />
      {error && <Text style={[typography.caption, { color: colors.error }]}>{error}</Text>}
    </View>
  );
}
