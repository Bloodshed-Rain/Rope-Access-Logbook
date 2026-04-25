import React from 'react';
import { Pressable, Text, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { LoadingSpinner } from './LoadingSpinner';

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

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
  haptic,
}: ButtonProps) {
  const { colors, spacing, radii, borders, touchTarget } = useTheme();

  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const isSecondary = variant === 'secondary';
  const enableHaptic = haptic ?? true;

  const getBgColor = (pressed: boolean) => {
    if (disabled) {
      if (isPrimary) return colors.inkDisabled;
      if (isDanger) return colors.inkDisabled;
      return 'transparent';
    }
    if (isPrimary) return pressed ? colors.accentDeep : colors.accentBase;
    if (isDanger) return pressed ? '#b03a40' : colors.statusErr;
    if (isSecondary) return pressed ? colors.bgPanel : 'transparent';
    return pressed ? colors.bgPanel : 'transparent'; // ghost
  };

  const getTextColor = (pressed: boolean) => {
    if (disabled) {
      if (isPrimary || isDanger) return colors.bgBase;
      return colors.inkDisabled;
    }
    if (isPrimary || isDanger) return colors.bgBase;
    if (isSecondary) return pressed ? colors.inkPrimary : colors.inkPrimary;
    return colors.accentBase; // ghost
  };

  const getBorderColor = (pressed: boolean) => {
    if (isSecondary) {
      if (disabled) return colors.inkDisabled;
      return pressed ? colors.accentBase : colors.edgeHi;
    }
    if (isPrimary && !disabled) return colors.accentDeep;
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
          paddingHorizontal: spacing.s4,
          borderWidth: isSecondary || isPrimary ? borders.hair : 0,
          borderColor: getBorderColor(pressed),
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.s2,
          // Inset highlight on primary — top edge brighter
          ...(isPrimary && !disabled
            ? {
                borderTopWidth: borders.hair,
                borderTopColor: colors.accentHot,
              }
            : {}),
          transform: [{ translateY: pressed && !disabled ? 1 : 0 }],
        },
        style,
      ]}
    >
      {({ pressed }) => (
        <>
          {loading && <LoadingSpinner size="small" color={getTextColor(pressed)} />}
          <Text
            style={[
              {
                fontFamily: 'Michroma_400Regular',
                fontSize: 11,
                letterSpacing: 1.8,
                textTransform: 'uppercase',
                color: getTextColor(pressed),
              },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
