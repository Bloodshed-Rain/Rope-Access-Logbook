import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ProBadgeProps {
  style?: any;
}

export function ProBadge({ style }: ProBadgeProps) {
  const { colors, typography } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: '#FFD700' }, style]}>
      <Text style={[typography.bodySmall, { color: '#000', fontWeight: 'bold' }]}>PRO</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
