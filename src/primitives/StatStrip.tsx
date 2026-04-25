import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface Stat {
  label: string;
  value: string;
  sub?: string;
  subVariant?: 'default' | 'ok' | 'warn' | 'err';
}

export interface StatStripProps {
  // Type-enforced exactly 3 tiles — matches the dashboard mockup.
  stats: [Stat, Stat, Stat];
}

export function StatStrip({ stats }: StatStripProps) {
  const { colors, spacing, typography, borders } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 1,
        backgroundColor: colors.edgeBase,
        borderWidth: borders.hair,
        borderColor: colors.edgeBase,
      }}
    >
      {stats.map((s, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            backgroundColor: colors.bgRaised,
            paddingVertical: 14,
            paddingHorizontal: spacing.s2,
            alignItems: 'center',
          }}
        >
          <Text
            style={[
              typography.stencilSm,
              { color: colors.inkTertiary, marginBottom: 6 },
            ]}
          >
            {s.label}
          </Text>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_700Bold',
              fontSize: 22,
              color: colors.inkPrimary,
              letterSpacing: -0.4,
              lineHeight: 22,
            }}
          >
            {s.value}
          </Text>
          {s.sub && (
            <Text
              style={{
                fontFamily: 'JetBrainsMono_400Regular',
                fontSize: 9,
                color:
                  s.subVariant === 'ok'
                    ? colors.statusOk
                    : s.subVariant === 'warn'
                      ? colors.statusWarn
                      : s.subVariant === 'err'
                        ? colors.statusErr
                        : colors.inkDisabled,
                marginTop: 5,
                letterSpacing: 0.4,
              }}
            >
              {s.sub}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
