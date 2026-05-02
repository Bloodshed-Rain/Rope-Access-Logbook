import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface MultiSelectListRowProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
}

export function MultiSelectListRow({ label, selected, onToggle }: MultiSelectListRowProps) {
  const { colors, spacing, typography, borders } = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
        minHeight: 56,
        borderBottomWidth: borders.hair,
        borderBottomColor: colors.divider,
        backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
      })}
    >
      <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>{label}</Text>
      {selected && (
        <View style={{ marginLeft: spacing.md }}>
          <Check size={20} color={colors.accentPrimary} />
        </View>
      )}
    </Pressable>
  );
}
