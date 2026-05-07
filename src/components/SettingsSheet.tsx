// src/components/SettingsSheet.tsx
// Settings bottom-sheet body for MeScreen. Profile edits (stubs), Supervisor
// capability toggle (Level III only) with cert-number + directory-visibility
// sub-fields and a push-row to the SupervisorsListScreen connections list,
// Cloud-backup photos toggle, Notifications deep-link, Account (email + sign
// out + delete), and About.

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
import { Sheet } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { Profile } from '../types';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createAuthService } from '../services/authService';
import { createProfileService } from '../services/profileService';
import { getClient } from '../db/initialize';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateProfile } from '../hooks/useProfile';
import { useAuthSession } from '../hooks/useAuthSession';
import { useSignRequests } from '../hooks/useSignRequests';
import { useReadOnly } from '../hooks/useSubscription';
import { sha256 } from '../utils/hash';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  sessionEmail: string | null;
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
            color: colors.textPrimary,
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
  // a11y — used by Switch rows so the wrapping Pressable announces correctly.
  accessibilityRole?: 'button' | 'switch';
  accessibilityLabel?: string;
  accessibilityState?: { checked?: boolean; disabled?: boolean };
}

function SettingsRow({
  title,
  subtitle,
  right,
  onPress,
  destructive,
  showChevron,
  accessibilityRole,
  accessibilityLabel,
  accessibilityState,
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
          <Text style={[typography.caption, { color: colors.textPrimary, marginTop: 2 }]}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {showChevron && <ChevronRight size={18} color={colors.textPrimary} />}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
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
}: SettingsSheetProps) {
  const { colors, spacing, typography, radii, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const qc = useQueryClient();
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const db = useMemo(() => getClient(), []);
  const profileService = useMemo(() => createProfileService(db), [db]);
  const updateProfile = useUpdateProfile();
  const { session } = useAuthSession(cloud);
  const signRequests = useSignRequests({ db, cloud, fs, hash: sha256 });
  const readOnly = useReadOnly();

  const goPaywall = () => {
    onClose();
    navigation.navigate('Paywall');
  };

  const [signingOut, setSigningOut] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'type' | 'deleting'>('idle');
  const [typedConfirm, setTypedConfirm] = useState('');

  // Supervisor-capability sub-form local state.
  const [showEnableForm, setShowEnableForm] = useState(false);
  const [certInput, setCertInput] = useState('');
  const [directoryVisibleDraft, setDirectoryVisibleDraft] = useState(true);

  // Spec §6: capability toggle is L3-only.
  const showSupervisorCapability =
    profile.level === 'III' || profile.irata_level === 'III';
  const capabilityOn = profile.supervisor_capability_enabled;

  // Pending sign requests where the user is the supervisor — used to gate
  // disabling the capability so we don't drop techs with in-flight requests.
  const pendingSupervisorRequests = useMemo(() => {
    const list = signRequests.query.data ?? [];
    const uid = session?.user_id;
    if (!uid) return 0;
    return list.filter((r) => r.supervisor_user_id === uid && r.status === 'pending').length;
  }, [signRequests.query.data, session?.user_id]);

  // Closes the sheet first so the stack-pushed edit screen has full focus
  // and the user isn't returned to a half-open sheet behind a screen.
  const goEdit = (route: 'EditName' | 'EditAvatar' | 'EditCerts') => () => {
    onClose();
    navigation.navigate(route);
  };
  const goLegal = (route: 'PrivacyPolicy' | 'TermsOfService') => () => {
    onClose();
    navigation.navigate(route);
  };

  const goSupervisorsList = () => {
    onClose();
    navigation.navigate('SupervisorsList');
  };

  const requestEnableCapability = () => {
    setCertInput(profile.supervisor_cert_number ?? '');
    setDirectoryVisibleDraft(true);
    setShowEnableForm(true);
  };

  const cancelEnableForm = () => {
    setShowEnableForm(false);
    setCertInput('');
  };

  const confirmEnableCapability = async () => {
    if (!certInput.trim()) return;
    if (readOnly) {
      setShowEnableForm(false);
      goPaywall();
      return;
    }
    try {
      await profileService.enableSupervisorCapability(
        certInput.trim(),
        profile.full_name,
        directoryVisibleDraft,
        cloud,
      );
      qc.invalidateQueries({ queryKey: ['profile'] });
      setShowEnableForm(false);
      setCertInput('');
      toast.show({ message: 'Supervising turned on', variant: 'ok' });
    } catch (e) {
      Alert.alert('Could not enable', (e as Error).message);
    }
  };

  const handleCapabilityToggle = (next: boolean) => {
    if (readOnly) {
      goPaywall();
      return;
    }
    if (next) {
      requestEnableCapability();
      return;
    }
    // Disable path — short-circuit if there are pending requests so the user
    // sees an explanatory alert immediately. The Switch stays visually ON
    // because `value` is sourced from `profile.supervisor_capability_enabled`.
    if (pendingSupervisorRequests > 0) {
      Alert.alert(
        'Resolve pending requests',
        `You have ${pendingSupervisorRequests} pending sign request${
          pendingSupervisorRequests === 1 ? '' : 's'
        }. Complete or decline them before disabling supervisor mode.`,
      );
      return;
    }
    Alert.alert(
      'Turn off supervising?',
      'You will be removed from the supervisor directory. In-flight requests must be resolved first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            try {
              await profileService.disableSupervisorCapability(
                pendingSupervisorRequests,
                cloud,
              );
              qc.invalidateQueries({ queryKey: ['profile'] });
              toast.show({ message: 'Supervising turned off', variant: 'ok' });
            } catch (e) {
              const msg = (e as Error).message;
              if (msg === 'pending_requests_exist') {
                Alert.alert(
                  'Resolve pending requests',
                  'Decline or sign any pending sign requests before turning off supervising.',
                );
              } else {
                Alert.alert('Could not disable', msg);
              }
            }
          },
        },
      ],
    );
  };

  const handleDirectoryVisibleToggle = async (next: boolean) => {
    if (!profile.supervisor_cert_number) return;
    if (readOnly) {
      goPaywall();
      return;
    }
    try {
      await profileService.setSupervisorDirectoryVisible(
        next,
        profile.full_name,
        cloud,
      );
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.show({
        message: next ? 'Listed in directory' : 'Hidden from directory',
        variant: 'ok',
      });
    } catch (e) {
      Alert.alert('Could not update visibility', (e as Error).message);
    }
  };

  const handlePhotosToggle = (next: boolean) => {
    updateProfile.mutate(
      { photos_in_backup: next },
      {
        onError: (e) =>
          toast.show({ message: (e as Error).message, variant: 'err' }),
      },
    );
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
      {/* Profile edits */}
      <Section label="Profile">
        <SettingsRow title="Edit name" onPress={goEdit('EditName')} showChevron />
        <SettingsRow title="Edit avatar" onPress={goEdit('EditAvatar')} showChevron />
        <SettingsRow title="Edit cert details" onPress={goEdit('EditCerts')} showChevron />
      </Section>

      {/* Supervisors — capability toggle + sub-fields + push to list, L3 only */}
      {showSupervisorCapability && (
        <Section label="Supervisors">
          <SettingsRow
            title="Supervisor capability"
            subtitle={
              capabilityOn
                ? 'You can receive sign requests'
                : 'Turn on to receive sign requests'
            }
            accessibilityRole="switch"
            accessibilityLabel="Supervisor capability"
            accessibilityState={{ checked: capabilityOn }}
            right={
              <Switch
                value={capabilityOn}
                onValueChange={handleCapabilityToggle}
                accessibilityLabel="Supervisor capability"
                disabled={readOnly}
              />
            }
          />

          {capabilityOn && profile.supervisor_cert_number && (
            <View
              style={{
                paddingHorizontal: spacing.base,
                paddingVertical: spacing.md,
                borderBottomWidth: borders.hair,
                borderBottomColor: colors.divider,
              }}
            >
              <Text style={[typography.caption, { color: colors.textPrimary }]}>
                SPRAT Level III cert
              </Text>
              <Text style={[typography.body, { color: colors.textPrimary, marginTop: 2 }]}>
                #{profile.supervisor_cert_number}
              </Text>
            </View>
          )}

          {capabilityOn && (
            <SettingsRow
              title="List me in the supervisor directory"
              subtitle="Allows techs to find you by name or cert number"
              accessibilityRole="switch"
              accessibilityLabel="Directory visibility"
              accessibilityState={{ checked: !!profile.supervisor_directory_visible }}
              right={
                <Switch
                  value={!!profile.supervisor_directory_visible}
                  onValueChange={handleDirectoryVisibleToggle}
                  accessibilityLabel="Directory visibility"
                  disabled={readOnly}
                />
              }
            />
          )}

          {showEnableForm && (
            <View
              style={{
                paddingHorizontal: spacing.base,
                paddingVertical: spacing.md,
                gap: spacing.sm,
                borderBottomWidth: borders.hair,
                borderBottomColor: colors.divider,
              }}
            >
              <Input
                label="SPRAT Level III cert number"
                value={certInput}
                onChangeText={(t) => setCertInput(t.replace(/\D/g, '').slice(0, 5))}
                placeholder="12345"
                keyboardType="number-pad"
                maxLength={5}
              />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: spacing.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[typography.body, { color: colors.textPrimary }]}>
                    List me in the supervisor directory
                  </Text>
                  <Text style={[typography.caption, { color: colors.textPrimary }]}>
                    Allows techs to find you by name or cert number
                  </Text>
                </View>
                <Switch
                  value={directoryVisibleDraft}
                  onValueChange={setDirectoryVisibleDraft}
                  accessibilityRole="switch"
                  accessibilityLabel="Directory visibility (new)"
                  accessibilityState={{ checked: directoryVisibleDraft }}
                />
              </View>
              <Button
                title="Enable supervising"
                onPress={confirmEnableCapability}
                disabled={!certInput.trim() || readOnly}
              />
              <Button title="Cancel" variant="secondary" onPress={cancelEnableForm} />
            </View>
          )}

          {capabilityOn && (
            <SettingsRow
              title="Supervisors"
              subtitle="Manage connections, invites, and search"
              onPress={goSupervisorsList}
              showChevron
            />
          )}
        </Section>
      )}

      {/* Cloud backup */}
      <Section label="Cloud backup">
        <SettingsRow
          title="Include photos in backup"
          subtitle={profile.photos_in_backup ? 'Photos uploaded with each backup' : 'Photos stay on device'}
          accessibilityRole="switch"
          accessibilityLabel="Include photos in backup"
          accessibilityState={{ checked: !!profile.photos_in_backup }}
          right={
            <Switch
              value={!!profile.photos_in_backup}
              onValueChange={handlePhotosToggle}
              accessibilityLabel="Include photos in backup"
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
          onPress={goLegal('PrivacyPolicy')}
          showChevron
        />
        <SettingsRow
          title="Terms of service"
          onPress={goLegal('TermsOfService')}
          showChevron
        />
      </Section>
    </Sheet>
  );
}
