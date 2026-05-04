// src/screens/EditAvatarScreen.tsx
//
// Profile-photo edit. Action-style screen: pick from library, take with
// camera, or remove. New picks are copied into the logbook avatars dir
// (saveAvatarPhoto) so the URI survives the source picker's tmp cache and
// shows up in cloud-backup snapshots if the user has photos_in_backup on.
//
// Old avatar files aren't cleaned up here. They're tiny and the FS budget
// is governed by photos_in_backup at backup time. Keeping prior files lets
// the user un-do an accidental change before the next backup runs.

import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, useToast } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { saveAvatarPhoto } from '../utils/fileStorage';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function EditAvatarScreen() {
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const toast = useToast();

  const [busy, setBusy] = useState(false);

  const initialPath = profile?.avatar_path ?? null;
  // Local preview state — lets the user see the new pick before tapping Save.
  // Keeping it separate from the persisted path avoids mutating the profile
  // until the user explicitly confirms.
  const [previewPath, setPreviewPath] = useState<string | null>(initialPath);
  const [pendingRemove, setPendingRemove] = useState(false);

  const initials = useMemo(() => {
    const parts = (profile?.full_name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [profile?.full_name]);

  const dirty = previewPath !== initialPath || pendingRemove;
  const showAvatar = pendingRemove ? null : previewPath;

  const pickFromLibrary = async () => {
    setBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access in Settings to pick an avatar.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (res.canceled) return;
      const uri = res.assets[0].uri;
      const saved = await saveAvatarPhoto(uri);
      setPreviewPath(saved);
      setPendingRemove(false);
    } catch (e) {
      toast.show({ message: (e as Error).message, variant: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access in Settings to take a photo.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (res.canceled) return;
      const uri = res.assets[0].uri;
      const saved = await saveAvatarPhoto(uri);
      setPreviewPath(saved);
      setPendingRemove(false);
    } catch (e) {
      toast.show({ message: (e as Error).message, variant: 'err' });
    } finally {
      setBusy(false);
    }
  };

  const requestRemove = () => {
    setPendingRemove(true);
    setPreviewPath(null);
  };

  const handleSave = async () => {
    if (!dirty) return;
    setBusy(true);
    try {
      await updateProfile.mutateAsync({
        avatar_path: pendingRemove ? null : previewPath,
      });
      toast.show({ message: 'Avatar updated.', variant: 'ok' });
      navigation.goBack();
    } catch (e) {
      toast.show({ message: (e as Error).message, variant: 'err' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          gap: spacing.base,
          alignItems: 'stretch',
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Edit avatar</Text>

        <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
          <View
            style={{
              width: 160,
              height: 160,
              borderRadius: radii.pill,
              overflow: 'hidden',
              backgroundColor: colors.bgMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {showAvatar ? (
              <Image
                source={{ uri: showAvatar }}
                style={{ width: '100%', height: '100%' }}
                accessibilityLabel="Profile avatar preview"
              />
            ) : (
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: 56,
                  lineHeight: 60,
                  fontWeight: '600',
                }}
              >
                {initials}
              </Text>
            )}
          </View>
        </View>

        <Button title="Choose from library" variant="primary" onPress={pickFromLibrary} disabled={busy} />
        <Button title="Take a photo" variant="secondary" onPress={takePhoto} disabled={busy} />
        {(initialPath || previewPath) && !pendingRemove && (
          <Button title="Remove avatar" variant="ghost" onPress={requestRemove} disabled={busy} />
        )}

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              title="Save"
              variant="primary"
              onPress={handleSave}
              disabled={!dirty || busy}
              loading={updateProfile.isPending}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
