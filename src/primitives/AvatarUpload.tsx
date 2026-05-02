import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Camera } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface AvatarUploadProps {
  uri?: string | null;
  onPress?: () => void;
  size?: number;
  initials?: string;
}

export function AvatarUpload({ uri, onPress, size = 64, initials }: AvatarUploadProps) {
  const { colors, radii, typography, borders } = useTheme();

  // If the underlying image fails to load (e.g. quarantined after a partial
  // restore, or a stale path), fall back to the initials placeholder so the
  // avatar slot never renders as an empty box.
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [uri]);

  const showImage = !!uri && !broken;
  const badgeSize = Math.max(20, Math.round(size * 0.32));

  const inner = (
    <View style={{ width: size, height: size }}>
      {showImage ? (
        <Image
          source={{ uri: uri as string }}
          onError={() => setBroken(true)}
          style={{
            width: size,
            height: size,
            borderRadius: radii.md,
            backgroundColor: colors.bgMuted,
          }}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radii.md,
            backgroundColor: colors.bgMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={[
              typography.title2,
              { color: colors.textPrimary, fontSize: Math.round(size * 0.36) },
            ]}
          >
            {(initials ?? '').slice(0, 2).toUpperCase()}
          </Text>
        </View>
      )}
      {onPress && (
        <View
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: badgeSize,
            height: badgeSize,
            borderRadius: radii.pill,
            backgroundColor: colors.accentPrimary,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: borders.block,
            borderColor: colors.bgSurface,
          }}
        >
          <Camera size={Math.round(badgeSize * 0.55)} color={colors.textInverse} />
        </View>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Change avatar"
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        {inner}
      </Pressable>
    );
  }

  return inner;
}
