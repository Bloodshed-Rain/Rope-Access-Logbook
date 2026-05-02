import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { EntryStatus } from '../types';

interface BadgeProps {
  status: EntryStatus;
}

const STATUS_LABELS: Record<EntryStatus, string> = {
  draft: 'Draft',
  signed: 'Signed',
  amended: 'Amended',
};

export function Badge({ status }: BadgeProps) {
  const { colors, borders } = useTheme();

  let bg: string = 'transparent';
  let text: string = colors.textSecondary;
  let border: string = colors.border;

  if (status === 'draft') {
    text = colors.textSecondary;
    border = colors.border;
  } else if (status === 'signed') {
    text = colors.statusOk;
    border = colors.statusOk;
  } else if (status === 'amended') {
    text = colors.statusErr;
    border = colors.statusErr;
  }

  return (
    <View
      style={{
        backgroundColor: bg,
        borderWidth: borders.hair,
        borderColor: border,
        paddingHorizontal: 7,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          fontFamily: 'Michroma_400Regular',
          fontSize: 8.5,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: text,
        }}
      >
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}
