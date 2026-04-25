import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { CertScheme } from '../types';

export type RecertState = 'safe' | 'reval-open' | 'expires-today' | 'expired';

export interface RecertStripProps {
  scheme: CertScheme;
  state: RecertState;
  expiresOn: string;        // YYYY-MM-DD
  daysToExpiry: number;
  onPress?: () => void;
}

function formatExpiry(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
}

export function RecertStrip({ scheme, state, expiresOn, daysToExpiry, onPress }: RecertStripProps) {
  const { colors, spacing, typography, borders } = useTheme();

  const accent =
    state === 'safe'
      ? colors.edgeHi
      : state === 'reval-open'
        ? colors.statusWarn
        : colors.statusErr;

  const subText =
    state === 'safe'
      ? 'RECERT NOT YET DUE'
      : state === 'reval-open'
        ? `EXP · ${formatExpiry(expiresOn)} · REVAL WINDOW OPEN`
        : state === 'expires-today'
          ? 'EXPIRES TODAY'
          : `EXPIRED · ${formatExpiry(expiresOn)}`;

  const daysLabel = state === 'expired' ? Math.abs(daysToExpiry).toString() : daysToExpiry.toString();
  const daysSub = state === 'expired' ? 'DAYS LATE' : 'DAYS';

  const Wrapper: any = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing.s3,
        paddingVertical: spacing.s2,
        paddingHorizontal: spacing.s3,
        borderWidth: borders.hair,
        borderColor: accent,
        backgroundColor: state === 'safe' ? 'transparent' : 'rgba(245,165,36,0.05)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s3, flex: 1 }}>
        <View
          style={{
            width: 18,
            height: 18,
            borderWidth: 1.5,
            borderColor: accent,
            transform: [{ rotate: '45deg' }],
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Text
            style={{
              transform: [{ rotate: '-45deg' }],
              color: accent,
              fontFamily: 'Michroma_400Regular',
              fontSize: 9,
            }}
          >
            !
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              typography.bodySmall,
              { color: colors.inkPrimary, letterSpacing: 0.2 },
            ]}
          >
            {scheme.toUpperCase()} RECERT DUE
          </Text>
          <Text
            style={{
              fontFamily: 'Michroma_400Regular',
              fontSize: 8.5,
              color: accent,
              letterSpacing: 1.2,
              marginTop: 2,
            }}
          >
            {subText}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_800ExtraBold',
            fontSize: 20,
            color: accent,
            lineHeight: 20,
            letterSpacing: -0.2,
          }}
        >
          {daysLabel}
        </Text>
        <Text
          style={{
            fontFamily: 'Michroma_400Regular',
            fontSize: 7.5,
            color: accent,
            letterSpacing: 1.6,
            marginTop: 2,
          }}
        >
          {daysSub}
        </Text>
      </View>
    </Wrapper>
  );
}
