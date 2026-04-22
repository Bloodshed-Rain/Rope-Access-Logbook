import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ProgressBarProps {
  progress: number; // 0 to 1
  color?: string;
  height?: number;
  trackColor?: string;
}

export function ProgressBar({
  progress,
  color,
  height = 18,
  trackColor,
}: ProgressBarProps) {
  const { colors, borders } = useTheme();
  
  const clampedProgress = Math.max(0, Math.min(1, progress));
  const percentText = `${Math.round(clampedProgress * 100)}%`;
  
  return (
    <View style={{ marginTop: 18, position: 'relative' }}>
      <View
        style={[
          styles.track,
          {
            height,
            backgroundColor: trackColor || colors.paper,
            borderWidth: borders.block,
            borderColor: colors.ink,
          },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${clampedProgress * 100}%`,
              backgroundColor: color || colors.ink,
            },
          ]}
        />
      </View>
      <View style={{
        position: 'absolute',
        right: -2,
        top: -18,
        backgroundColor: colors.blood,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderWidth: borders.block,
        borderColor: colors.ink,
        borderBottomWidth: 0,
      }}>
        <Text style={{ fontFamily: 'JetBrainsMono_800ExtraBold', fontSize: 9, letterSpacing: 0.4, color: colors.paper }}>
          {percentText}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
  },
  fill: {
    height: '100%',
  },
});
