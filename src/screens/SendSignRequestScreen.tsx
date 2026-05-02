// src/screens/SendSignRequestScreen.tsx
// Spec §7 lines 360-367. Modal that lets a tech send a sign-request to one of
// their accepted supervisor connections.
//
// Reachable from:
//   • PostSaveSheet's "Send request" action (D2)
//   • SignatureOptionsSheet's "Send to supervisor" (D2)
//   • EntryDetail's "Get signature" → SignatureOptionsSheet → here (D4)
//
// Body: read-only entry summary, supervisor picker (Sheet over an accepted-
// connections list), an optional message textarea, and a Send/Cancel pair.
// Cancel guard mirrors EntryFormScreen — a single `beforeRemove` listener
// guards header-X, the Cancel button, and hardware back uniformly.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, ChevronRight, X } from 'lucide-react-native';
import { Screen, Button, Textarea, LoadingSpinner, useToast } from '../primitives';
import { Sheet } from '../primitives/Sheet';
import { useTheme } from '../theme/ThemeProvider';
import { useEntry } from '../hooks/useEntries';
import { useAuthSession } from '../hooks/useAuthSession';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useSignRequests } from '../hooks/useSignRequests';
import { useReadOnly } from '../hooks/useSubscription';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { getClient } from '../db/initialize';
import { sha256 } from '../utils/hash';
import { formatEntryDateRange } from '../utils/dateRange';
import { RootStackParamList } from '../navigation/RootNavigator';
import { SupervisorConnection } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'SendSignRequest'>;

// `supervisor_user_id` is `string | null` on SupervisorConnection (null until
// an email-invited supervisor signs up). The picker only shows accepted rows
// where the id is set, so we narrow to a non-null shape at the source.
type AcceptedConnection = SupervisorConnection & { supervisor_user_id: string };

function isAccepted(uid: string | undefined) {
  return (c: SupervisorConnection): c is AcceptedConnection =>
    !!uid &&
    c.tech_user_id === uid &&
    c.status === 'accepted' &&
    c.supervisor_user_id !== null;
}

export function SendSignRequestScreen() {
  const { colors, spacing, typography, radii, borders, shadows, touchTarget } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const toast = useToast();
  const { entryId } = route.params;

  // DI wiring matches EntryDetailScreen / SignRequestDetailScreen so all
  // sign-request consumers share a single hook + service shape.
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);

  const { session } = useAuthSession(cloud);
  const { data: entry, isLoading: entryLoading } = useEntry(entryId);
  const conns = useSupervisorConnections({ db, cloud });
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const readOnly = useReadOnly();

  const accepted = useMemo<AcceptedConnection[]>(
    () => (conns.query.data ?? []).filter(isAccepted(session?.user_id)),
    [conns.query.data, session?.user_id],
  );

  const [picked, setPicked] = useState<AcceptedConnection | null>(null);
  const [message, setMessage] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Cancel-guard pattern: a single `beforeRemove` listener handles header-X,
  // Cancel button, hardware back, and swipe-down dismiss. The ref is flipped
  // before navigating after a successful send so the alert is skipped.
  const isLeavingIntentionally = useRef(false);
  const isDirty = picked !== null || message.trim().length > 0;

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (isLeavingIntentionally.current || !isDirty) return;
      e.preventDefault();
      Alert.alert(
        'Discard request?',
        'You have unsaved changes. Discard them?',
        [
          { text: 'Keep editing', style: 'cancel', onPress: () => {} },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              isLeavingIntentionally.current = true;
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return sub;
  }, [navigation, isDirty]);

  // If the entry vanished between mount and load (very unlikely), bail out
  // cleanly. Guarded with `entryLoading` so we don't fire while still loading.
  const entryMissing = !entryLoading && !entry;
  useEffect(() => {
    if (!entryMissing) return;
    toast.show({ message: 'Entry not found', variant: 'err' });
    isLeavingIntentionally.current = true;
    navigation.goBack();
  }, [entryMissing, navigation, toast]);

  const handleClose = () => navigation.goBack();

  const handleSend = async () => {
    if (!picked) return;
    // Lapsed users get bounced to Paywall instead of inserting a request
    // row. The picker + message stay so they can resume after renewing.
    if (readOnly) {
      isLeavingIntentionally.current = true;
      navigation.navigate('Paywall');
      return;
    }
    try {
      await signReqs.send.mutateAsync({
        entry_id: entryId,
        connection_id: picked.id,
        supervisor_user_id: picked.supervisor_user_id,
      });
      // The optional `message` textarea is captured in local state for the
      // dirty check + UX consistency with paper notes culture; the underlying
      // sendRequest service does not yet accept a message field, so it is
      // intentionally not forwarded. TODO(message-plumbing): thread through
      // once SignRequest carries an optional message column.
      toast.show({ message: 'Request sent', variant: 'ok' });
      isLeavingIntentionally.current = true;
      // popToTop lands the user at Main from the PostSaveSheet/SignatureOptionsSheet
      // entry-points (those `replace`d the wizard, so popToTop unwinds the modal
      // chain). D4 will wire EntryDetail → SignatureOptionsSheet → here; from
      // that path popToTop also drops EntryDetail off the stack, which may not
      // be desired. Revisit in D4 — likely a contextual return-to via route
      // params or a smarter pop count.
      navigation.popToTop();
    } catch (err) {
      const m = (err as Error)?.message ?? String(err);
      toast.show({ message: `Couldn't send request: ${m}`, variant: 'err' });
    }
  };

  const sendDisabled = !picked || signReqs.send.isPending;
  const showLoading = entryLoading || !entry;

  return (
    <Screen padded={false}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>
          Send request
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={handleClose}
          hitSlop={12}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={22} color={colors.textPrimary} />
        </Pressable>
      </View>

      {showLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <LoadingSpinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.base,
            paddingBottom: spacing.xxl,
            gap: spacing.base,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Read-only entry summary card */}
          <View
            style={[
              {
                backgroundColor: colors.bgSurface,
                borderRadius: radii.md,
                borderWidth: borders.hair,
                borderColor: colors.border,
                padding: spacing.base,
                gap: spacing.xs,
              },
              shadows.sm,
            ]}
          >
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              Entry
            </Text>
            <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
              {entry!.site}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {`${formatEntryDateRange(entry!.date_from, entry!.date_to)} · ${entry!.work_hours}h`}
            </Text>
          </View>

          {/* "To" picker */}
          <View style={{ gap: spacing.xs }}>
            <Text style={[typography.label, { color: colors.textSecondary }]}>
              To
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select supervisor"
              onPress={() => setPickerOpen(true)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
                borderRadius: radii.md,
                borderWidth: borders.hair,
                borderColor: colors.border,
                paddingHorizontal: spacing.base,
                minHeight: touchTarget.preferred,
                paddingVertical: spacing.sm,
              })}
            >
              <Text
                style={[
                  typography.body,
                  {
                    color: picked
                      ? colors.textPrimary
                      : colors.textSecondary,
                  },
                ]}
              >
                {picked
                  ? picked.supervisor_display_name ?? picked.invited_email
                  : 'Select supervisor'}
              </Text>
              <ChevronRight size={20} color={colors.textSecondary} />
            </Pressable>

            {/* Always-visible "Find supervisor" deep link */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Find supervisor"
              onPress={() => navigation.navigate('SupervisorSearch')}
              hitSlop={6}
              style={{ alignSelf: 'flex-start', paddingVertical: spacing.xs }}
            >
              <Text style={[typography.caption, { color: colors.accentPrimary }]}>
                Find supervisor
              </Text>
            </Pressable>
          </View>

          {/* Optional message */}
          <Textarea
            label="Message (optional)"
            value={message}
            onChangeText={setMessage}
            placeholder="Anything they should know? (e.g., 'Final inspection ready for sign-off.')"
          />

          {/* Send + Cancel */}
          <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
            <Button
              title="Send request"
              variant="primary"
              onPress={handleSend}
              disabled={sendDisabled}
              loading={signReqs.send.isPending}
            />
            <Button title="Cancel" variant="ghost" onPress={handleClose} />
          </View>
        </ScrollView>
      )}

      {/* Supervisor picker sheet */}
      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Pick supervisor"
        scrollable={true}
      >
        {accepted.length === 0 ? (
          <View style={{ alignItems: 'center', gap: spacing.base, paddingVertical: spacing.lg }}>
            <Text
              style={[
                typography.body,
                { color: colors.textSecondary, textAlign: 'center' },
              ]}
            >
              No accepted supervisors yet
            </Text>
            <Button
              title="Find supervisor"
              variant="primary"
              onPress={() => {
                setPickerOpen(false);
                navigation.navigate('SupervisorSearch');
              }}
            />
          </View>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {accepted.map((c) => {
              const isSelected = picked?.id === c.id;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={c.supervisor_display_name ?? c.invited_email}
                  onPress={() => {
                    setPicked(c);
                    setPickerOpen(false);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
                    borderRadius: radii.md,
                    borderWidth: borders.hair,
                    borderColor: isSelected ? colors.accentPrimary : colors.border,
                    paddingHorizontal: spacing.base,
                    paddingVertical: spacing.md,
                    minHeight: touchTarget.preferred,
                  })}
                >
                  {/* No level chip: supervisor_connections_cache doesn't carry
                      a level column today, and the spec instructs us to drop
                      the chip when the data isn't locally available. */}
                  <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>
                    {c.supervisor_display_name ?? c.invited_email}
                  </Text>
                  {isSelected ? (
                    <Check size={20} color={colors.accentPrimary} />
                  ) : (
                    <ChevronRight size={20} color={colors.textSecondary} />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
