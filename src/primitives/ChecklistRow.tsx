import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckCircle2, AlertCircle, Circle } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';

export type ChecklistRowState = 'ok' | 'warn' | 'err' | 'muted';

export interface ChecklistRowProps {
  state: ChecklistRowState;
  label: string;
  caption?: string;
  onPress?: () => void;
}

export function ChecklistRow({ state, label, caption, onPress }: ChecklistRowProps) {
  const { colors, spacing, typography } = useTheme();

  const iconColor =
    state === 'ok'
      ? colors.statusOk
      : state === 'warn'
        ? colors.statusWarn
        : state === 'err'
          ? colors.statusErr
          : colors.textDisabled;

  const Icon = state === 'ok' ? CheckCircle2 : state === 'muted' ? Circle : AlertCircle;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.base,
        gap: spacing.md,
        minHeight: 56,
      }}
    >
      <Icon size={20} color={iconColor} />
      <View style={{ flex: 1 }}>
        <Text style={[typography.body, { color: colors.textPrimary }]}>{label}</Text>
        {caption && (
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
            {caption}
          </Text>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}
