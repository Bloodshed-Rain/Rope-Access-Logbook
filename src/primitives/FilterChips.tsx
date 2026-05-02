import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface FilterChipsProps {
  chips: string[];
  selectedChip: string;
  onSelectChip: (chip: string) => void;
}

export function FilterChips({ chips, selectedChip, onSelectChip }: FilterChipsProps) {
  const { colors, radii, spacing, typography, borders } = useTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.base, gap: spacing.sm }}
    >
      {chips.map((chip) => {
        const selected = chip === selectedChip;
        return (
          <Pressable
            key={chip}
            onPress={() => onSelectChip(chip)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={chip}
            style={({ pressed }) => ({
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radii.pill,
              backgroundColor: selected ? colors.accentPrimary : colors.bgSurface,
              borderWidth: borders.hair,
              borderColor: selected ? colors.accentPrimary : colors.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View>
              <Text
                style={[
                  typography.label,
                  { color: selected ? colors.textInverse : colors.textPrimary },
                ]}
              >
                {chip}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
