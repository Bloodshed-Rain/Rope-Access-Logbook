import React, { ReactNode } from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

export interface StatCardProps {
  title?: string;
  big: string;
  caption?: string;
  progress?: number;
  illustration?: ReactNode;
  onPress?: () => void;
}

export function StatCard({ title, big, caption, progress, illustration, onPress }: StatCardProps) {
  const { colors, radii, spacing, typography, shadows } = useTheme();

  const cardStyle: ViewStyle = {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.md,
    padding: spacing.base,
    flexDirection: illustration ? 'row' : 'column',
    alignItems: illustration ? 'center' : 'stretch',
    gap: illustration ? spacing.md : 0,
  };

  const clamped = progress != null ? Math.max(0, Math.min(1, progress)) : null;

  const inner = (
    <>
      <View style={{ flex: illustration ? 1 : undefined }}>
        {title && (
          <Text
            style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
          >
            {title}
          </Text>
        )}
        <Text style={[typography.title1, { color: colors.textPrimary }]}>{big}</Text>
        {caption && (
          <Text
            style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}
          >
            {caption}
          </Text>
        )}
        {clamped != null && (
          <View
            style={{
              height: 6,
              borderRadius: radii.pill,
              backgroundColor: colors.bgMuted,
              marginTop: spacing.md,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${clamped * 100}%`,
                height: '100%',
                backgroundColor: colors.accentPrimary,
              }}
            />
          </View>
        )}
      </View>
      {illustration && <View>{illustration}</View>}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [cardStyle, shadows.sm, { opacity: pressed ? 0.8 : 1 }]}
      >
        {inner}
      </Pressable>
    );
  }

  return <View style={[cardStyle, shadows.sm]}>{inner}</View>;
}
