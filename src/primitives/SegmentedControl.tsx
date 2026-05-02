import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface SegmentedOption {
  value: string;
  label: string;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
}

export function SegmentedControl({ options, value, onChange }: SegmentedControlProps) {
  const { colors, radii, spacing, typography, borders } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        borderRadius: radii.md,
        borderWidth: borders.hair,
        borderColor: colors.border,
        backgroundColor: colors.bgSurface,
        overflow: 'hidden',
      }}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.sm,
              backgroundColor: selected ? colors.accentPrimary : 'transparent',
              borderLeftWidth: index === 0 ? 0 : borders.hair,
              borderLeftColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={[
                typography.bodyMed,
                { color: selected ? colors.textInverse : colors.textPrimary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
