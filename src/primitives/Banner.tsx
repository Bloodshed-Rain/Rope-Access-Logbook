import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { AlertTriangle, Info, CheckCircle2, XCircle, X } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface BannerProps {
  message: string;
  variant: 'warning' | 'error' | 'info' | 'success';
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export function Banner({ message, variant, actionLabel, onAction, onDismiss }: BannerProps) {
  const { colors, spacing, typography, radii, shadows } = useTheme();

  const colorMap = {
    warning: colors.statusWarn,
    error: colors.statusErr,
    info: colors.statusInfo,
    success: colors.statusOk,
  };

  const IconComponent =
    variant === 'warning' ? AlertTriangle :
    variant === 'error' ? XCircle :
    variant === 'success' ? CheckCircle2 :
    Info;

  const accentColor = colorMap[variant];

  return (
    <View
      style={[
        {
          backgroundColor: colors.bgSurface,
          borderRadius: radii.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.base,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        },
        shadows.sm,
      ]}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: accentColor,
        }}
      />
      <IconComponent color={accentColor} size={20} />
      <Text style={[typography.label, { color: colors.textPrimary, flex: 1 }]}>{message}</Text>
      
      {actionLabel && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={[typography.bodyMed, { color: accentColor }]}>{actionLabel}</Text>
        </Pressable>
      )}
      
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8}>
          <X color={colors.textDisabled} size={20} />
        </Pressable>
      )}
    </View>
  );
}
