import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface IconButtonProps { icon: React.ReactNode; onPress: () => void; size?: number; style?: ViewStyle; }

export function IconButton({ icon, onPress, size = 44, style }: IconButtonProps) {
  const { radii } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: radii.full, alignItems: 'center' as const,
          justifyContent: 'center' as const, opacity: pressed ? 0.7 : 1 }, style,
      ]}>
      {icon}
    </Pressable>
  );
}
