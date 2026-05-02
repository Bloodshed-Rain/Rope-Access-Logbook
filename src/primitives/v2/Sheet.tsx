import React, { ReactNode } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeProvider';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const { colors, radii, spacing, typography, borders } = useTheme();

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.bgSurface,
            borderTopLeftRadius: radii.lg,
            borderTopRightRadius: radii.lg,
            paddingBottom: spacing.xl,
            maxHeight: '90%',
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: spacing.sm }}>
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: radii.pill,
                backgroundColor: colors.borderStrong,
              }}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: spacing.base,
              paddingVertical: spacing.md,
              borderBottomWidth: borders.hair,
              borderBottomColor: colors.divider,
            }}
          >
            <Text style={[typography.title2, { color: colors.textPrimary, flex: 1 }]}>
              {title ?? ''}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={{ padding: spacing.xs }}
              accessibilityLabel="Close"
            >
              <X size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={{ padding: spacing.base }}>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
