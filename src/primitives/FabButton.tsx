import React from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';

export interface FabButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}

// Sticky-bottom CTA: gradient orange face + plus glyph + Michroma label.
// Inset highlight on top, dark line on bottom, glow shadow underneath.
export function FabButton({ label, onPress, disabled = false, style }: FabButtonProps) {
  const { colors, spacing, borders, touchTarget } = useTheme();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: pressed ? colors.accentDeep : colors.accentBase,
          minHeight: touchTarget.preferred,
          paddingVertical: spacing.s4,
          paddingHorizontal: spacing.s5,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.s3,
          borderTopWidth: borders.hair,
          borderTopColor: colors.accentHot,
          borderBottomWidth: borders.hair,
          borderBottomColor: colors.accentDeep,
          shadowColor: colors.accentBase,
          shadowOpacity: 0.35,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
          opacity: disabled ? 0.5 : 1,
          transform: [{ translateY: pressed && !disabled ? 1 : 0 }],
        },
        style,
      ]}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: colors.bgBase,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily: 'JetBrainsMono_800ExtraBold',
            fontSize: 14,
            color: colors.bgBase,
            lineHeight: 14,
          }}
        >
          +
        </Text>
      </View>
      <Text
        style={{
          fontFamily: 'Michroma_400Regular',
          fontSize: 11,
          letterSpacing: 2.4,
          color: colors.bgBase,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
