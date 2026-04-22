import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface SectionHeaderProps {
  label: string;
  num?: string;
  accent?: 'orange' | 'navy' | 'tan';
  right?: React.ReactNode;
}

export function SectionHeader({ label, num, accent = 'orange', right }: SectionHeaderProps) {
  const { colors, typography, spacing, borders } = useTheme();

  return (
    <View style={{ marginBottom: spacing.s5, marginTop: spacing.s6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingBottom: spacing.s3, borderBottomWidth: borders.block, borderBottomColor: colors.ink }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.s3 }}>
          {num && (
            <View style={{ backgroundColor: colors.ink, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={[typography.label, { color: colors.paper, fontWeight: '800' }]}>{num}</Text>
            </View>
          )}
          <Text style={[typography.h2, { color: colors.ink }]}>{label}</Text>
        </View>
        {right && (
          <View>
            {typeof right === 'string' ? (
              <Text style={[typography.label, { color: colors.ink50 }]}>{right}</Text>
            ) : (
              right
            )}
          </View>
        )}
      </View>
    </View>
  );
}
