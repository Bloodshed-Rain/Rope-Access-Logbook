import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type SyncStatus = 'ok' | 'warn' | 'err' | 'disabled';

export interface SyncLEDProps {
  status: SyncStatus;
  label?: string;
  onPress?: () => void;
}

export function SyncLED({ status, label, onPress }: SyncLEDProps) {
  const { colors, typography } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  // Only the OK and warn states pulse — err and disabled stay static.
  useEffect(() => {
    if (status !== 'ok' && status !== 'warn') {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.55, duration: 1100, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, opacity]);

  const dotColor =
    status === 'ok'
      ? colors.statusOk
      : status === 'warn'
        ? colors.statusWarn
        : status === 'err'
          ? colors.statusErr
          : colors.inkDisabled;

  const labelColor =
    status === 'disabled' ? colors.inkDisabled : colors.inkSecondary;

  const Wrapper: any = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={onPress}
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <Animated.View
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          backgroundColor: dotColor,
          opacity,
          shadowColor: dotColor,
          shadowOpacity: 0.7,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      {label && (
        <Text style={[typography.stencilSm, { color: labelColor }]}>{label}</Text>
      )}
    </Wrapper>
  );
}
