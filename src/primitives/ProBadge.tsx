import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ProBadgeProps {
  style?: ViewStyle;
}

export function ProBadge({ style }: ProBadgeProps) {
  const { colors, borders } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          borderWidth: borders.hair,
          borderColor: colors.accentBase,
          backgroundColor: 'transparent',
        },
        style,
      ]}
    >
      <Text
        style={{
          fontFamily: 'Michroma_400Regular',
          fontSize: 8.5,
          letterSpacing: 1.6,
          color: colors.accentBase,
        }}
      >
        PRO
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
