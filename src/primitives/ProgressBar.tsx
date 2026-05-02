import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ProgressBarProps {
  progress: number; // 0 to 1
  color?: string;
  height?: number;
  trackColor?: string;
}

export function ProgressBar({ progress, color, height = 8, trackColor }: ProgressBarProps) {
  const { colors, borders } = useTheme();

  const clampedProgress = Math.max(0, Math.min(1, progress));

  return (
    <View
      style={[
        styles.track,
        {
          height,
          backgroundColor: trackColor || colors.bgMuted,
          borderWidth: borders.hair,
          borderColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.fill,
          {
            width: `${clampedProgress * 100}%`,
            backgroundColor: color || colors.accentPrimary,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%' },
  fill: { height: '100%' },
});
