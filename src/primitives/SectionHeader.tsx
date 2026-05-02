import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface SectionHeaderProps {
  label: string;
  num?: string;
  accent?: 'orange' | 'navy' | 'tan';
  right?: React.ReactNode;
}

// Stencil section label with `01 · LABEL` format. The new industrial aesthetic
// matches the mockup: an orange-rule prefix, an orange numeric index, then the
// stencil label in dim ink.
export function SectionHeader({ label, num, accent: _accent = 'orange', right }: SectionHeaderProps) {
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.s3,
        marginTop: spacing.s5,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s2 }}>
        <View style={{ width: 10, height: 1, backgroundColor: colors.accentPrimary }} />
        {num && (
          <Text
            style={{
              fontFamily: 'JetBrainsMono_700Bold',
              fontSize: 10,
              letterSpacing: 0.5,
              color: colors.accentPrimary,
            }}
          >
            {num}
          </Text>
        )}
        <Text style={[typography.title2, { color: colors.textDisabled }]}>{label}</Text>
      </View>
      {right && (
        <View>
          {typeof right === 'string' ? (
            <Text style={[typography.caption, { color: colors.accentPrimary, letterSpacing: 1.0 }]}>
              {right}
            </Text>
          ) : (
            right
          )}
        </View>
      )}
    </View>
  );
}
