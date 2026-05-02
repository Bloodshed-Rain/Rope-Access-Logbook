import React, { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

export interface CenterModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function CenterModal({ open, onClose, children }: CenterModalProps) {
  const { colors, radii, spacing, shadows } = useTheme();

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: colors.overlay,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: spacing.lg,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[
            {
              backgroundColor: colors.bgSurface,
              borderRadius: radii.lg,
              padding: spacing.lg,
              width: '100%',
              maxWidth: 420,
            },
            shadows.md,
          ]}
        >
          <View>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
