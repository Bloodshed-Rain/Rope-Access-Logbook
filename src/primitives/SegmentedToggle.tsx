import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface SegmentedToggleOption<T extends string> {
  value: T;
  label: string;
  sub?: string;
}

export interface SegmentedToggleProps<T extends string> {
  value: T;
  options: SegmentedToggleOption<T>[];
  onChange: (value: T) => void;
}

// 2-segment grid (or N-segment — auto-fits). Active segment gets the raised
// panel face + orange underline glow. Stencil label, optional sub-line in JBM.
export function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
}: SegmentedToggleProps<T>) {
  const { colors, spacing, typography, borders, touchTarget } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.bgRaised,
        padding: 4,
        gap: 4,
        borderWidth: borders.hair,
        borderColor: colors.edgeHi,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1,
              minHeight: touchTarget.min,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: spacing.s2,
              backgroundColor: active ? colors.bgPanel : 'transparent',
              borderTopWidth: active ? borders.hair : 0,
              borderTopColor: colors.edgeBright,
              position: 'relative',
            }}
          >
            <Text
              style={[
                typography.stencil,
                { color: active ? colors.inkPrimary : colors.inkTertiary },
              ]}
            >
              {opt.label}
            </Text>
            {opt.sub && (
              <Text
                style={[
                  typography.caption,
                  {
                    color: active ? colors.inkSecondary : colors.inkDisabled,
                    marginTop: 2,
                    letterSpacing: 0.6,
                  },
                ]}
              >
                {opt.sub}
              </Text>
            )}
            {active && (
              <View
                style={{
                  position: 'absolute',
                  bottom: 2,
                  left: 8,
                  right: 8,
                  height: 1.5,
                  backgroundColor: colors.accentBase,
                  shadowColor: colors.accentBase,
                  shadowOpacity: 0.7,
                  shadowRadius: 4,
                  shadowOffset: { width: 0, height: 0 },
                }}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
