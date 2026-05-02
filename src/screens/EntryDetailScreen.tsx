// src/screens/EntryDetailScreen.tsx
// Light-theme entry detail. Site title + status pill, then body cards
// (When / Employer / Work / Notes / Signature) on bgSurface, then footer
// actions sized to status. Service calls and lock semantics are unchanged
// from the industrial-aesthetic version — this re-skin only touches visuals,
// button copy, and routes Get-signature through SignatureOptionsSheet.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, Image, Pressable } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { CheckCircle2 } from 'lucide-react-native';
import { Screen, Button, Banner, LoadingSpinner, useToast } from '../primitives';
import { StatusPill } from '../primitives/v2';
import { useTheme } from '../theme/ThemeProvider';
import { useEntry, useDeleteEntry, useAmendmentForEntry } from '../hooks/useEntries';
import { useSignatureForEntry, useVerifyIntegrity } from '../hooks/useSignatures';
import { useSignRequests } from '../hooks/useSignRequests';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { useReadOnly } from '../hooks/useSubscription';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { classifyEntry, pillFor } from '../utils/entryStatusPill';
import { formatEntryDateRange, formatDate } from '../utils/dateRange';
import { WORK_TYPE_LABELS } from '../constants';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'EntryDetail'>;

export function EntryDetailScreen() {
  const { colors, spacing, typography, radii, shadows } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const entryId = route.params.entryId;

  const { data: entry, isLoading: entryIsLoading } = useEntry(entryId);
  const { data: signature } = useSignatureForEntry(entryId);
  const { data: integrity } = useVerifyIntegrity(entryId);
  const { data: amendment } = useAmendmentForEntry(entryId);
  const deleteEntry = useDeleteEntry();
  const toast = useToast();
  const readOnly = useReadOnly();

  // Lapsed users tapping Edit / Get signature / Amend get bounced to
  // Paywall rather than entering the write surface. Delete stays available
  // (it's destructive, not gated; the user can prune drafts even when
  // lapsed). Withdraw stays available because it un-blocks the entry the
  // user already attempted to send.
  const gate = (run: () => void) => () => {
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    run();
  };

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const connections = useSupervisorConnections({ db, cloud });
  // Stale withdrawn/declined/expired requests would otherwise satisfy the
  // awaiting check and surface the wrong banner; restrict to active.
  const myRequest = (signReqs.query.data ?? []).find(
    (r) => r.entry_payload.id === entryId && r.status === 'pending',
  );
  // Resolve a display name for the awaiting banner. Sign-requests carry
  // `supervisor_user_id` + `connection_id`; the cached connection row carries
  // a display name. Match on connection_id first (canonical), then by user.
  const supervisorName: string | null = useMemo(() => {
    if (!myRequest) return null;
    const list = connections.query.data ?? [];
    const byConn = list.find((c) => c.id === myRequest.connection_id);
    if (byConn?.supervisor_display_name) return byConn.supervisor_display_name;
    const byUser = list.find((c) => c.supervisor_user_id === myRequest.supervisor_user_id);
    return byUser?.supervisor_display_name ?? null;
  }, [myRequest, connections.query.data]);

  const [signatureImageFailed, setSignatureImageFailed] = useState(false);
  // Reset the broken-image flag when the underlying signature URI changes so
  // a post-restore re-download (or any re-mount with a new path) re-attempts
  // the load rather than sticking on "missing" forever.
  useEffect(() => {
    setSignatureImageFailed(false);
  }, [signature?.signature_png_path]);

  if (entryIsLoading) {
    return <LoadingSpinner fullScreen label="Loading entry" />;
  }

  if (!entry) {
    return (
      <Screen>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: spacing.base,
            paddingHorizontal: spacing.base,
          }}
        >
          <Text style={[typography.title2, { color: colors.textPrimary, textAlign: 'center' }]}>
            Entry not found
          </Text>
          <Text
            style={[
              typography.body,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            This entry may have been deleted.
          </Text>
          <Button title="Go back" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </Screen>
    );
  }

  const classification = classifyEntry(entry);
  const pill = pillFor(entry, classification);
  const isDraft = entry.status === 'draft';
  const isSigned = entry.status === 'signed';
  const isAmended = entry.status === 'amended';
  const isAwaiting = isDraft && entry.pending_sign_request_id !== null;

  const handleDelete = () => {
    Alert.alert('Delete entry', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteEntry.mutateAsync(entryId);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.goBack();
          } catch (err) {
            // Stay on screen so the user can react (e.g. signed-entry guard
            // race or DB lock); never silently goBack on failure.
            Alert.alert('Delete failed', String((err as Error)?.message ?? err));
          }
        },
      },
    ]);
  };

  const handleWithdraw = () => {
    if (!myRequest) return;
    const requestId = myRequest.id;
    Alert.alert(
      'Withdraw request',
      'The supervisor will be notified that this request was canceled.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: () =>
            signReqs.withdraw.mutate(requestId, {
              onError: (e) =>
                toast.show({
                  message: `Withdraw failed: ${String((e as Error)?.message ?? e)}`,
                  variant: 'err',
                }),
            }),
        },
      ],
    );
  };

  // Card styling — used by every body card. Matches spec §6 surface tokens.
  const cardStyle = {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.md,
    padding: spacing.base,
    ...shadows.sm,
  };

  const workTypeLabels = entry.work_types.map((t) => WORK_TYPE_LABELS[t] ?? t).join(', ');
  const showOtherDescription =
    entry.work_types.includes('other') && (entry.other_work_description ?? '').trim().length > 0;
  const dateRangeText = formatEntryDateRange(entry.date_from, entry.date_to || entry.date_from);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          gap: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — site title + status pill */}
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.title2, { color: colors.textPrimary }]}>
            {entry.site || 'Untitled entry'}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <StatusPill variant={pill.variant} label={pill.label} />
          </View>
        </View>

        {/* Read-only banner — lapsed subscription. Sits above the body so
            users see why Edit / Get signature / Amend bounce them out. */}
        {readOnly && (
          <Banner
            variant="warning"
            message="Subscription lapsed — renew to add new entries"
            actionLabel="Renew"
            onAction={() => navigation.navigate('Paywall')}
          />
        )}

        {/* Awaiting → withdraw banner. Pending sign-requests block other actions. */}
        {isAwaiting && myRequest && (
          <Banner
            variant="info"
            message={
              supervisorName
                ? `Awaiting signature from ${supervisorName}.`
                : 'Awaiting supervisor signature.'
            }
            actionLabel="Withdraw"
            onAction={handleWithdraw}
          />
        )}

        {/* Integrity warning sits high so it's visible above body cards. */}
        {isSigned && integrity && !integrity.valid && (
          <Banner
            variant="error"
            message="Integrity check failed — this entry may have been modified after signing."
          />
        )}

        {/* Back-pointer when this entry is itself an amendment. */}
        {entry.amends_entry_id && (
          <Pressable
            onPress={() => navigation.push('EntryDetail', { entryId: entry.amends_entry_id! })}
            accessibilityRole="link"
            accessibilityLabel="View original entry"
          >
            <Text style={[typography.caption, { color: colors.accentPrimary }]}>
              Amends an earlier entry — view original
            </Text>
          </Pressable>
        )}

        {/* Body cards — When / Employer / Work / Notes */}
        <View style={cardStyle}>
          <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
            When
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {`${dateRangeText} · ${entry.work_hours}h`}
          </Text>
        </View>

        {entry.employer.trim().length > 0 && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
            >
              Employer
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.employer}</Text>
          </View>
        )}

        <View style={cardStyle}>
          <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
            Work
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {workTypeLabels || '—'}
          </Text>
          {showOtherDescription && (
            <Text
              style={[
                typography.body,
                {
                  color: colors.textSecondary,
                  fontStyle: 'italic',
                  marginTop: spacing.xs,
                },
              ]}
            >
              {entry.other_work_description}
            </Text>
          )}
        </View>

        {entry.description.trim().length > 0 && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
            >
              Notes
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {entry.description}
            </Text>
          </View>
        )}

        {/* Amendment-reason card — load-bearing for re-cert audits. */}
        {entry.amendment_reason && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
            >
              Amendment reason
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {entry.amendment_reason}
            </Text>
          </View>
        )}

        {/* Signature card */}
        <View style={cardStyle}>
          <Text style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
            Signature
          </Text>
          {!signature ? (
            <Text style={[typography.body, { color: colors.textSecondary }]}>Not signed yet</Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {signatureImageFailed ? (
                <Text style={[typography.body, { color: colors.textSecondary }]}>
                  Signature image missing
                </Text>
              ) : (
                <Image
                  source={{ uri: signature.signature_png_path }}
                  style={{
                    width: '100%',
                    height: 100,
                    resizeMode: 'contain',
                    backgroundColor: colors.bgMuted,
                    borderRadius: radii.xs,
                  }}
                  onError={() => setSignatureImageFailed(true)}
                />
              )}
              <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
                {`Signed by ${signature.supervisor_name} on ${formatDate(signature.signed_at)}`}
              </Text>
              {/* Integrity verdict footer — verified case. The error case
                  surfaces as a top-of-screen Banner above. */}
              {isSigned && integrity && integrity.valid && (
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}
                  accessibilityLabel="Integrity verified"
                >
                  <CheckCircle2 size={14} color={colors.statusOk} />
                  <Text style={[typography.caption, { color: colors.statusOk }]}>
                    Integrity verified
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Forward pointer when this entry has been amended. */}
        {isAmended && amendment && (
          <Pressable
            onPress={() => navigation.push('EntryDetail', { entryId: amendment.id })}
            accessibilityRole="link"
            accessibilityLabel="View amendment"
          >
            <Text style={[typography.caption, { color: colors.accentPrimary }]}>
              {`Amended by ${formatEntryDateRange(amendment.date_from, amendment.date_to || amendment.date_from)} entry — view amendment`}
            </Text>
          </Pressable>
        )}

        {/* Footer actions */}
        {isDraft && !isAwaiting && (
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              title="Edit"
              variant="secondary"
              onPress={gate(() => navigation.navigate('EntryForm', { entryId: entry.id }))}
            />
            <Button
              title="Get signature"
              variant="primary"
              onPress={gate(() =>
                navigation.navigate('SignatureOptionsSheet', { entryId: entry.id }),
              )}
            />
            <Button title="Delete" variant="ghost" onPress={handleDelete} />
          </View>
        )}

        {/* Signed entries are immutable, but amending creates a new draft via
            createAmendment (CLAUDE.md: "Editing a signed entry goes through
            entriesService.createAmendment"). Lock semantics preserved — the
            signed row is untouched. Suppress when an amendment already exists. */}
        {isSigned && !amendment && (
          <View style={{ marginTop: spacing.md }}>
            <Button
              title="Amend this entry"
              variant="secondary"
              onPress={gate(() =>
                navigation.navigate('EntryForm', { amendEntryId: entry.id }),
              )}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
