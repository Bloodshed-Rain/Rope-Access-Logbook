import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { EntryStatus } from '../types';

interface BadgeProps { status: EntryStatus; }

const STATUS_LABELS: Record<EntryStatus, string> = { draft: 'Draft', signed: 'Signed', amended: 'Amended' };

export function Badge({ status }: BadgeProps) {
  const { colors, spacing, typography, radii } = useTheme();
  const colorMap: Record<EntryStatus, { bg: string; text: string }> = {
    draft: { bg: colors.statusDraftLight, text: colors.statusDraft },
    signed: { bg: colors.statusSignedLight, text: colors.statusSigned },
    amended: { bg: colors.statusAmendedLight, text: colors.statusAmended },
  };
  const { bg, text } = colorMap[status];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radii.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
      <Text style={[typography.caption, { color: text, fontWeight: '600' }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}
