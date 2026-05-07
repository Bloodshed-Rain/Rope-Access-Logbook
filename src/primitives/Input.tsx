import React, { useState } from 'react';
import { Platform, View, Text, TextInput, TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { KEYBOARD_DONE_ID } from './KeyboardDoneAccessory';

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
      ? colors.accentPrimary
      : colors.border;

  return (
    <View style={{ gap: spacing.s2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[typography.label, { color: colors.textPrimary }]}>{label}</Text>
        {hint && <Text style={[typography.caption, { color: colors.textSecondary }]}>{hint}</Text>}
      </View>
      <TextInput
        editable={editable}
        // iOS: pull a "Done" bar above the keyboard so users can dismiss
        // numeric / multi-line keyboards without tapping outside the field.
        // The accessory view is mounted once at App root. Caller-supplied
        // inputAccessoryViewID overrides this default.
        inputAccessoryViewID={
          Platform.OS === 'ios'
            ? props.inputAccessoryViewID ?? KEYBOARD_DONE_ID
            : undefined
        }
        style={[
          typography.label,
          {
            // Inset bezel: top edge highlighted, sides + bottom darker
            borderTopWidth: borders.hair,
            borderTopColor: borderColor,
            borderRightWidth: borders.hair,
            borderRightColor: colors.border,
            borderBottomWidth: borders.hair,
            borderBottomColor: colors.border,
            borderLeftWidth: borders.hair,
            borderLeftColor: colors.border,
            borderRadius: radii.none,
            paddingHorizontal: spacing.s3,
            paddingVertical: spacing.s3,
            minHeight: touchTarget.min,
            color: isDisabled ? colors.textDisabled : colors.textPrimary,
            backgroundColor: colors.bgMuted,
          },
          style,
        ]}
        placeholderTextColor={colors.textSecondary}
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
