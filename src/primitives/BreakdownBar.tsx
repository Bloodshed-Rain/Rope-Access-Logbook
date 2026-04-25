import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ProgressBar } from './ProgressBar';

export interface BreakdownBarProps {
  label: string;
  value: number;
  max: number;
  unit?: string;
  // First two rows in a breakdown list use emphasis = orange-gradient fill.
  // Remaining rows use the gray fill so the visual hierarchy lands.
  emphasis?: boolean;
}

export function BreakdownBar({ label, value, max, unit, emphasis = false }: BreakdownBarProps) {
  const { colors, spacing, typography } = useTheme();
  const fillColor = emphasis ? colors.accentBase : colors.edgeBright;
  const progress = max > 0 ? value / max : 0;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.s3,
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: colors.edgeBase,
        borderStyle: 'dashed',
      }}
    >
      <Text
        style={[
          typography.caption,
          {
            color: colors.inkSecondary,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            width: 100,
          },
        ]}
      >
        {label}
      </Text>
      <View style={{ flex: 1 }}>
        <ProgressBar progress={progress} color={fillColor} height={6} />
      </View>
      <View style={{ width: 52, alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_700Bold',
            fontSize: 11,
            color: colors.inkPrimary,
            letterSpacing: 0.2,
          }}
        >
          {value}
        </Text>
        {unit && (
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              fontSize: 10,
              color: colors.inkTertiary,
            }}
          >
            {unit}
          </Text>
        )}
      </View>
    </View>
  );
}
