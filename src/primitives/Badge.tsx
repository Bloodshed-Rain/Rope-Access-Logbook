import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { EntryStatus } from '../types';

interface BadgeProps { status: EntryStatus; }

const STATUS_LABELS: Record<EntryStatus, string> = { draft: 'Draft', signed: 'Signed', amended: 'Amended' };

export function Badge({ status }: BadgeProps) {
  const { colors, borders } = useTheme();
  
  // map status to tag styles
  let bg: string = 'transparent';
  let text: string = colors.ink;
  let border: string = colors.ink;

  if (status === 'draft') {
    bg = colors.paper; // ghost
  } else if (status === 'signed') {
    bg = colors.success;
    text = colors.paper;
    border = colors.success;
  } else if (status === 'amended') {
    bg = colors.blood;
    text = colors.paper;
    border = colors.blood;
  }

  return (
    <View style={{ backgroundColor: bg, borderWidth: borders.rule, borderColor: border, paddingHorizontal: 7, paddingVertical: 2 }}>
      <Text style={{ fontFamily: 'JetBrainsMono_700Bold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: text }}>
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}
