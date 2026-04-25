import React, { useState } from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, style, editable = true, ...props }: InputProps) {
  const { colors, spacing, typography, radii, borders, touchTarget } = useTheme();
  const [focused, setFocused] = useState(false);

  const isDisabled = editable === false;
  const borderColor = error
    ? colors.statusErr
    : focused
      ? colors.accentBase
      : colors.edgeHi;

  return (
    <View style={{ gap: spacing.s2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[typography.stencilSm, { color: colors.inkTertiary }]}>{label}</Text>
        {hint && <Text style={[typography.caption, { color: colors.inkTertiary }]}>{hint}</Text>}
      </View>
      <TextInput
        editable={editable}
        style={[
          typography.mono,
          {
            // Inset bezel: top edge highlighted, sides + bottom darker
            borderTopWidth: borders.hair,
            borderTopColor: borderColor,
            borderRightWidth: borders.hair,
            borderRightColor: colors.edgeBase,
            borderBottomWidth: borders.hair,
            borderBottomColor: colors.edgeBase,
            borderLeftWidth: borders.hair,
            borderLeftColor: colors.edgeBase,
            borderRadius: radii.none,
            paddingHorizontal: spacing.s3,
            paddingVertical: spacing.s3,
            minHeight: touchTarget.min,
            color: isDisabled ? colors.inkDisabled : colors.inkPrimary,
            backgroundColor: colors.bgInset,
          },
          style,
        ]}
        placeholderTextColor={colors.inkTertiary}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        {...props}
      />
      {error && <Text style={[typography.caption, { color: colors.statusErr }]}>{error}</Text>}
    </View>
  );
}
