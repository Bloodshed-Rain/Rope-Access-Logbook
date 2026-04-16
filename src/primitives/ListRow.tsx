import React from 'react';
import { Pressable, View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ListRowProps { title: string; subtitle?: string; right?: React.ReactNode; onPress: () => void; }

export function ListRow({ title, subtitle, right, onPress }: ListRowProps) {
  const { colors, spacing, typography } = useTheme();
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.slateLightest : colors.surface,
        paddingVertical: spacing.md, paddingHorizontal: spacing.base,
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        borderBottomWidth: 1, borderBottomColor: colors.border })}>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={[typography.body, { color: colors.textPrimary, fontWeight: '500' }]}>{title}</Text>
        {subtitle && <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>{subtitle}</Text>}
      </View>
      {right}
    </Pressable>
  );
}
