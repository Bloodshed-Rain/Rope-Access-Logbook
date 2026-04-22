import React from 'react';
import { Pressable, Text, ViewStyle, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: any;
  haptic?: boolean;
}

export function Button({ title, onPress, variant = 'primary', disabled = false, loading = false, style, textStyle, haptic }: ButtonProps) {
  const { colors, spacing, typography, radii, borders, touchTarget } = useTheme();

  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const enableHaptic = haptic ?? true;

  const getBgColor = (pressed: boolean) => {
    if (disabled) {
      if (isPrimary || isDanger) return colors.ink30;
      return 'transparent';
    }
    if (isPrimary || isDanger) return pressed ? colors.bloodD : colors.ink;
    if (variant === 'secondary') return pressed ? colors.blood : 'transparent';
    return pressed ? colors.blood : 'transparent'; // ghost
  };

  const getTextColor = (pressed: boolean) => {
    if (disabled) {
      if (isPrimary || isDanger) return colors.paper;
      return colors.ink50;
    }
    if (isPrimary || isDanger) return colors.bg;
    if (variant === 'secondary') return pressed ? colors.paper : colors.ink;
    return pressed ? colors.paper : colors.blood; // ghost
  };

  const getBorderColor = (pressed: boolean) => {
    if (variant === 'secondary') {
      if (disabled) return colors.ink30;
      return pressed ? colors.blood : colors.ink;
    }
    return 'transparent';
  };

  const handlePress = () => {
    if (enableHaptic) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: getBgColor(pressed),
          borderRadius: radii.none,
          minHeight: touchTarget.min,
          paddingVertical: spacing.s3,
          paddingHorizontal: variant === 'ghost' ? spacing.s3 : spacing.s4,
          borderWidth: variant === 'secondary' ? borders.block : 0,
          borderColor: getBorderColor(pressed),
          alignItems: 'center',
          justifyContent: isPrimary ? 'space-between' : 'center',
          flexDirection: 'row',
          gap: spacing.s3,
          transform: [{ translateY: pressed && !disabled ? 1 : 0 }],
        },
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {loading && <ActivityIndicator size="small" color={getTextColor(pressed)} />}
          <Text 
            style={[
              {
                fontFamily: typography.h1.fontFamily,
                fontSize: 12,
                fontWeight: '800',
                letterSpacing: 1.44,
                textTransform: 'uppercase',
                color: getTextColor(pressed),
              },
              textStyle
            ]}
          >
            {title}
          </Text>
          {isPrimary && !loading && (
            <Text 
              style={{
                fontFamily: typography.h1.fontFamily,
                fontSize: 12,
                fontWeight: '800',
                letterSpacing: 1.44,
                color: getTextColor(pressed),
              }}
            >
              [+]
            </Text>
          )}
        </>
      )}
    </Pressable>
  );
}
