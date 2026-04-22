import React from 'react';
import { Pressable, View, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress: () => void;
}

export function ListRow({ title, subtitle, right, onPress }: ListRowProps) {
  const { colors, spacing, typography, touchTarget } = useTheme();
  
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.ropeTanLight : 'transparent',
        paddingVertical: spacing.base,
        paddingHorizontal: spacing.base,
        minHeight: touchTarget.preferred,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.hairline,
        position: 'relative',
        overflow: 'hidden',
      })}
    >
      {({ pressed }) => (
        <>
          {pressed && (
            <View
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                backgroundColor: colors.accentStripe,
              }}
            />
          )}
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={[typography.body, { color: colors.textPrimary, fontWeight: '700' }]}>{title}</Text>
            {subtitle && <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>{subtitle}</Text>}
          </View>
          {right && <View>{right}</View>}
        </>
      )}
    </Pressable>
  );
}
