import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { CertLevel } from '../types';

export type SignatureStatus = 'signed' | 'pending' | 'missing' | 'declined' | 'awaiting';

export interface PunchCardRowProps {
  date: string;             // YYYY-MM-DD; we render day + month from date_from
  title: string;
  meta: string;
  levelChip?: CertLevel;
  sigStatus?: SignatureStatus;
  sigBy?: string;
  onPress?: () => void;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function chipColor(level: CertLevel, colors: { certL1: string; certL2: string; certL3: string }) {
  switch (level) {
    case 'I':
      return colors.certL1;
    case 'II':
      return colors.certL2;
    case 'III':
      return colors.certL3;
  }
}

function sigInfo(status: SignatureStatus, colors: ReturnType<typeof useTheme>['colors']) {
  switch (status) {
    case 'signed':
      return { color: colors.statusOk, filled: true, label: '' };
    case 'pending':
    case 'awaiting':
      return { color: colors.statusWarn, filled: false, label: 'PEND' };
    case 'declined':
    case 'missing':
      return { color: colors.statusErr, filled: false, label: status === 'declined' ? 'DECL' : 'MISS' };
  }
}

export function PunchCardRow({
  date,
  title,
  meta,
  levelChip,
  sigStatus,
  sigBy,
  onPress,
}: PunchCardRowProps) {
  const { colors, spacing, typography, borders } = useTheme();
  const [, m, d] = date.split('-');
  const day = d ?? '';
  const mon = MONTHS[parseInt(m, 10) - 1] ?? '';

  const Wrapper: any = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={onPress}
      style={{
        flexDirection: 'row',
        backgroundColor: colors.bgPanel,
        borderWidth: borders.hair,
        borderColor: colors.edgeBase,
        marginBottom: spacing.s2,
        overflow: 'hidden',
      }}
    >
      {/* Left "punch" tile */}
      <View
        style={{
          width: 44,
          backgroundColor: colors.bgBase,
          borderRightWidth: borders.hair,
          borderRightColor: colors.edgeBase,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: spacing.s2,
        }}
      >
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            backgroundColor: '#000',
            marginBottom: 8,
            shadowColor: '#000',
            shadowOpacity: 0.9,
            shadowRadius: 1,
            shadowOffset: { width: 0, height: 1 },
          }}
        />
        <Text
          style={{
            fontFamily: 'JetBrainsMono_800ExtraBold',
            fontSize: 18,
            color: colors.inkPrimary,
            lineHeight: 18,
          }}
        >
          {day}
        </Text>
        <Text
          style={{
            fontFamily: 'Michroma_400Regular',
            fontSize: 8,
            color: colors.accentBase,
            letterSpacing: 1.2,
            marginTop: 3,
          }}
        >
          {mon}
        </Text>
      </View>
      {/* Body */}
      <View style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12 }}>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_700Bold',
            fontSize: 13,
            color: colors.inkPrimary,
            letterSpacing: 0.13,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={[typography.caption, { color: colors.inkTertiary, marginTop: 4, letterSpacing: 0.4 }]}
          numberOfLines={1}
        >
          {meta}
        </Text>
      </View>
      {/* Right slot */}
      {(levelChip || sigStatus) && (
        <View
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            borderLeftWidth: 1,
            borderLeftColor: colors.edgeBase,
            borderStyle: 'dashed',
            gap: 4,
          }}
        >
          {levelChip && (
            <View
              style={{
                borderWidth: borders.hair,
                borderColor: chipColor(levelChip, colors),
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  fontFamily: 'Michroma_400Regular',
                  fontSize: 8,
                  color: chipColor(levelChip, colors),
                  letterSpacing: 1.2,
                }}
              >
                L{levelChip === 'I' ? '1' : levelChip === 'II' ? '2' : '3'}
              </Text>
            </View>
          )}
          {sigStatus && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: sigInfo(sigStatus, colors).color,
                  backgroundColor: sigInfo(sigStatus, colors).filled
                    ? sigInfo(sigStatus, colors).color
                    : 'transparent',
                }}
              />
              <Text
                style={{
                  fontFamily: 'JetBrainsMono_400Regular',
                  fontSize: 9,
                  color: sigInfo(sigStatus, colors).color,
                  letterSpacing: 0.4,
                }}
              >
                {sigStatus === 'signed' ? (sigBy ?? '') : sigInfo(sigStatus, colors).label}
              </Text>
            </View>
          )}
        </View>
      )}
    </Wrapper>
  );
}
