import React, { useState } from 'react';
import { View, Text, TextInput, TextInputProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface InputProps extends TextInputProps { label: string; error?: string; hint?: string; }

export function Input({ label, error, hint, style, editable = true, ...props }: InputProps) {
  const { colors, spacing, typography, radii, borders, touchTarget } = useTheme();
  const [focused, setFocused] = useState(false);
  
  const isDisabled = editable === false;

  return (
    <View style={{ gap: spacing.s2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={[typography.label, { color: colors.ink }]}>{label}</Text>
        {hint && <Text style={[typography.label, { color: colors.ink50, fontWeight: '500' }]}>{hint}</Text>}
      </View>
      <TextInput
        editable={editable}
        style={[
          typography.mono,
          {
            fontWeight: '500',
            borderWidth: borders.block, 
            borderColor: error ? colors.blood : focused ? colors.blood : colors.ink,
            borderRadius: radii.none, 
            paddingHorizontal: spacing.s3, 
            paddingVertical: spacing.s3,
            minHeight: touchTarget.min,
            color: isDisabled ? colors.ink50 : colors.ink, 
            backgroundColor: isDisabled ? colors.bg2 : colors.paper 
          }, 
          style
        ]}
        placeholderTextColor={colors.ink30}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }} 
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }} 
        {...props} 
      />
      {error && <Text style={[typography.micro, { color: colors.blood }]}>{error}</Text>}
    </View>
  );
}
