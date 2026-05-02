import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type StatusPillVariant = 'pending' | 'signed' | 'amended';

export interface StatusPillProps {
  variant: StatusPillVariant;
  label: string;
}

const VARIANT: Record<StatusPillVariant, { bg: 'statusWarn' | 'statusOk' | 'textSecondary'; fg: 'bgSurface' }> = {
  pending: { bg: 'statusWarn', fg: 'bgSurface' },
  signed: { bg: 'statusOk', fg: 'bgSurface' },
  amended: { bg: 'textSecondary', fg: 'bgSurface' },
};

export function StatusPill({ variant, label }: StatusPillProps) {
  const { colors, radii, spacing, typography } = useTheme();
  const v = VARIANT[variant];

  return (
    <View
      style={{
        backgroundColor: colors[v.bg],
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs / 2,
        borderRadius: radii.pill,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={[typography.caption, { color: colors[v.fg] }]}>{label}</Text>
    </View>
  );
}
