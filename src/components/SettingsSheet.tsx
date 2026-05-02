// src/components/SettingsSheet.tsx
// Settings bottom-sheet body for MeScreen. Profile edits (stubs), Supervisors
// push, Cloud backup photos toggle, Notifications deep-link, Account
// (email + sign out + delete), and About.

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  Switch,
  Text,
  View,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { Button, Input, useToast } from '../primitives';
import { Sheet } from '../primitives/v2';
import { useTheme } from '../theme/ThemeProvider';
import { Profile } from '../types';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createAuthService } from '../services/authService';
import { getClient } from '../db/initialize';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  sessionEmail: string | null;
  onChangePhotosInBackup: (v: boolean) => Promise<void> | void;
}

interface SectionProps {
  label: string;
  children: React.ReactNode;
}

function Section({ label, children }: SectionProps) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text
        style={[
          typography.label,
          {
            color: colors.textSecondary,
            paddingHorizontal: spacing.base,
            paddingVertical: spacing.sm,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          },
        ]}
      >
        {label}
      </Text>
      <View style={{ backgroundColor: colors.bgSurface }}>{children}</View>
    </View>
  );
}

interface SettingsRowProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  showChevron?: boolean;
}

function SettingsRow({
  title,
  subtitle,
  right,
  onPress,
  destructive,
  showChevron,
}: SettingsRowProps) {
  const { colors, spacing, typography, borders } = useTheme();
  const titleColor = destructive ? colors.statusErr : colors.textPrimary;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.base,
        paddingVertical: spacing.md,
        minHeight: 56,
        borderBottomWidth: borders.hair,
        borderBottomColor: colors.divider,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={[typography.body, { color: titleColor }]}>{title}</Text>
        {subtitle && (
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {showChevron && <ChevronRight size={18} color={colors.textSecondary} />}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        {content}
      </Pressable>
    );
  }
  return content;
}

export function SettingsSheet({
  open,
  onClose,
  profile,
  sessionEmail,
  onChangePhotosInBackup,
}: SettingsSheetProps) {
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const cloud = useMemo(() => createSupabaseCloudClient(), []);

  const [signingOut, setSigningOut] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'type' | 'deleting'>('idle');
  const [typedConfirm, setTypedConfirm] = useState('');

  const showSupervisors = profile.level === 'III' || profile.irata_level === 'III';

  const editStub = (field: string) => () =>
    Alert.alert('Edit profile', `Editing ${field} coming soon.`);

  const goSupervisors = () => {
    onClose();
    navigation.navigate('SupervisorsList');
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'You will no longer be able to back up your data to the cloud until you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await createAuthService(cloud).signOut();
              toast.show({ message: 'Signed out', variant: 'ok' });
              onClose();
            } catch (e) {
              toast.show({ message: `Sign out failed: ${(e as Error).message}`, variant: 'err' });
            } finally {
              setSigningOut(false);
            }
          },
        },
      ],
    );
  };

  const handleDeleteRequest = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your cloud backup. Your on-device logbook will remain intact. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            setTypedConfirm('');
            setDeleteStep('type');
          },
        },
      ],
    );
  };

  const performDelete = async () => {
    setDeleteStep('deleting');
    try {
      const auth = createAuthService(cloud);
      await auth.deleteAccount();
      const db = getClient();
      await db.run(
        'UPDATE profile SET last_cloud_backup_at = NULL, last_uploaded_backup_id = NULL, updated_at = ?',
        [new Date().toISOString()],
      );
      toast.show({ message: 'Account deleted', variant: 'ok' });
      onClose();
    } catch (e) {
      toast.show({ message: `Delete failed: ${(e as Error).message}`, variant: 'err' });
    } finally {
      setDeleteStep('idle');
      setTypedConfirm('');
    }
  };

  const cancelDelete = () => {
    setDeleteStep('idle');
    setTypedConfirm('');
  };

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      {/* Profile edits — stubs for C3 */}
      <Section label="Profile">
        <SettingsRow title="Edit name" onPress={editStub('name')} showChevron />
        <SettingsRow title="Edit avatar" onPress={editStub('avatar')} showChevron />
        <SettingsRow title="Edit cert details" onPress={editStub('certifications')} showChevron />
      </Section>

      {/* Supervisors — only L3 holders */}
      {showSupervisors && (
        <Section label="Supervisors">
          <SettingsRow
            title="Supervisors"
            subtitle={
              profile.supervisor_capability_enabled
                ? 'You supervise others'
                : 'Manage who you supervise or are supervised by'
            }
            onPress={goSupervisors}
            showChevron
          />
        </Section>
      )}

      {/* Cloud backup */}
      <Section label="Cloud backup">
        <SettingsRow
          title="Include photos in backup"
          subtitle={profile.photos_in_backup ? 'Photos uploaded with each backup' : 'Photos stay on device'}
          right={
            <Switch
              value={!!profile.photos_in_backup}
              onValueChange={(v) => {
                void onChangePhotosInBackup(v);
              }}
            />
          }
        />
      </Section>

      {/* Notifications */}
      <Section label="Notifications">
        <SettingsRow
          title="Open notification settings"
          subtitle="Manage permissions in system settings"
          onPress={() => {
            void Linking.openSettings();
          }}
          showChevron
        />
      </Section>

      {/* Account */}
      <Section label="Account">
        {sessionEmail ? (
          <SettingsRow title="Signed in" subtitle={sessionEmail} />
        ) : (
          <SettingsRow
            title="Not signed in"
            subtitle="Sign in to back up to the cloud"
            onPress={() => {
              onClose();
              navigation.navigate('Auth');
            }}
            showChevron
          />
        )}
        {sessionEmail && (
          <SettingsRow
            title={signingOut ? 'Signing out…' : 'Sign out'}
            onPress={signingOut ? undefined : handleSignOut}
          />
        )}
        {sessionEmail && (
          <SettingsRow
            title="Delete account"
            destructive
            onPress={deleteStep === 'idle' ? handleDeleteRequest : undefined}
          />
        )}

        {deleteStep === 'type' && (
          <View
            style={{
              padding: spacing.base,
              gap: spacing.sm,
              borderRadius: radii.md,
              backgroundColor: colors.statusErrTint,
              margin: spacing.base,
            }}
          >
            <Text style={[typography.bodyMed, { color: colors.statusErr }]}>
              Type DELETE to confirm
            </Text>
            <Input
              label="Confirmation"
              value={typedConfirm}
              onChangeText={setTypedConfirm}
              placeholder="DELETE"
              autoCapitalize="characters"
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Cancel" variant="secondary" onPress={cancelDelete} />
              <Button
                title="Delete"
                variant="danger"
                onPress={performDelete}
                disabled={typedConfirm !== 'DELETE'}
              />
            </View>
          </View>
        )}
        {deleteStep === 'deleting' && (
          <View style={{ padding: spacing.base }}>
            <Text style={[typography.body, { color: colors.textPrimary }]}>Deleting…</Text>
          </View>
        )}
      </Section>

      {/* About */}
      <Section label="About">
        <SettingsRow title={`Version ${version}`} />
        <SettingsRow
          title="Privacy policy"
          onPress={() =>
            Alert.alert('Privacy policy', 'Coming soon.')
          }
          showChevron
        />
        <SettingsRow
          title="Terms of service"
          onPress={() =>
            Alert.alert('Terms of service', 'Coming soon.')
          }
          showChevron
        />
      </Section>
    </Sheet>
  );
}
