// src/screens/SignRequestDetailScreen.tsx
// Light-theme supervisor-side review screen for an incoming sign request.
// Card-stack layout mirrors EntryDetailScreen (When / Hours / Employer /
// Site / Work types / Notes / Photos / Message). Pending requests get a
// Sign / Decline footer; everything else surfaces a status banner.
//
// Service calls (useSignRequests) and the underlying signature-canvas
// flow are unchanged from the previous version — D5 is a visual reskin.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas from 'react-native-signature-canvas';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Screen, Button, Banner, Textarea } from '../primitives';
import { StatusPill } from '../primitives/v2';
import { useTheme } from '../theme/ThemeProvider';
import { useSignRequests } from '../hooks/useSignRequests';
import { getLocalPhotoPathsFromCache } from '../services/signRequestsService';
import { useProfile } from '../hooks/useProfile';
import { useAuthSession } from '../hooks/useAuthSession';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { pillForSignRequest } from '../utils/entryStatusPill';
import { formatEntryDateRange } from '../utils/dateRange';
import { WORK_TYPE_LABELS } from '../constants';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'SignRequestDetail'>;

export function SignRequestDetailScreen() {
  const { colors, spacing, typography, radii, shadows, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { data: profile } = useProfile();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const { session } = useAuthSession(cloud);
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });

  const [showCanvas, setShowCanvas] = useState(false);
  const [signing, setSigning] = useState(false);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const sigRef = useRef<any>(null);

  const req = (signReqs.query.data ?? []).find((r) => r.id === route.params.requestId);

  const [photoView, setPhotoView] = useState<{
    paths: string[];
    missingCount: number;
    pending: boolean;
  }>({ paths: [], missingCount: 0, pending: true });

  useEffect(() => {
    if (!req) return;
    let cancelled = false;
    (async () => {
      const row = await db.get<{ local_photo_paths_json: string | null }>(
        'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?',
        [req.id],
      );
      if (cancelled || !row) return;
      setPhotoView(getLocalPhotoPathsFromCache(row));
    })();
    return () => {
      cancelled = true;
    };
  }, [req?.id, signReqs.query.dataUpdatedAt, db]);

  if (!req || !profile) return null;

  const entry = req.entry_payload;
  const pill = pillForSignRequest(req.status);
  const isPending = req.status === 'pending';
  const isSupervisor = !!session && session.user_id === req.supervisor_user_id;
  const canAct = isPending && isSupervisor;

  const cardStyle = {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.md,
    padding: spacing.base,
    ...shadows.sm,
  };

  const dateRangeText = formatEntryDateRange(
    entry.date_from,
    entry.date_to || entry.date_from,
  );
  const workTypeLabels = entry.work_types
    .map((t) => WORK_TYPE_LABELS[t] ?? t)
    .filter((s) => s.length > 0)
    .join(', ');
  const showOtherDescription =
    entry.work_types.includes('other') &&
    (entry.other_work_description ?? '').trim().length > 0;

  const requestMessage =
    typeof (req as { message?: unknown }).message === 'string'
      ? ((req as { message?: string }).message ?? '').trim()
      : '';

  const handleSign = async (png_base64: string) => {
    setSigning(true);
    try {
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        }
      } catch {
        // GPS is best-effort — silently skipped if denied or unavailable.
      }
      await signReqs.sign.mutateAsync({
        request_id: req.id,
        png_base64: png_base64.replace('data:image/png;base64,', ''),
        supervisor_name: profile.full_name,
        supervisor_cert_number: profile.supervisor_cert_number ?? '',
        device_id: Device.modelName ?? 'unknown',
        gps_lat: lat,
        gps_lon: lon,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not sign', (e as Error).message);
    } finally {
      setSigning(false);
    }
  };

  const handleDeclineSubmit = async () => {
    try {
      await signReqs.decline.mutateAsync({
        id: req.id,
        reason: declineReason.trim(),
      });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not decline', (e as Error).message);
    }
  };

  const promptDecline = () => {
    Alert.alert(
      'Decline this request?',
      'The tech will be notified that you declined.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => setDeclineMode(true),
        },
      ],
    );
  };

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
            {entry.site || 'Sign request'}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <StatusPill variant={pill.variant} label={pill.label} />
          </View>
          {req.decline_reason ? (
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {`Reason: ${req.decline_reason}`}
            </Text>
          ) : null}
        </View>

        {/* Tech + level */}
        <View style={cardStyle}>
          <Text
            style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
          >
            Tech
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {`Level ${entry.tech_level_snapshot}`}
          </Text>
        </View>

        {/* When */}
        <View style={cardStyle}>
          <Text
            style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
          >
            When
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {dateRangeText}
          </Text>
        </View>

        {/* Hours */}
        <View style={cardStyle}>
          <Text
            style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
          >
            Hours
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {`${entry.work_hours}h`}
          </Text>
        </View>

        {/* Employer (omit if empty) */}
        {entry.employer.trim().length > 0 && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
            >
              Employer
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {entry.employer}
            </Text>
          </View>
        )}

        {/* Site (separate from header so client/site distinction stays explicit) */}
        {(entry.site.trim().length > 0 || entry.client.trim().length > 0) && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
            >
              Site
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {entry.site || '—'}
              {entry.client.trim().length > 0
                ? `  ·  ${entry.client}`
                : ''}
            </Text>
          </View>
        )}

        {/* Work types */}
        {workTypeLabels.length > 0 && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
            >
              Work
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {workTypeLabels}
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
        )}

        {/* Notes */}
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

        {/* Photos */}
        {entry.photo_paths.length > 0 && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.sm }]}
            >
              Photos
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {Array.from({ length: entry.photo_paths.length }).map((_, i) => {
                const localPath = photoView.pending ? '' : (photoView.paths[i] ?? '');
                if (localPath) {
                  return (
                    <Image
                      key={i}
                      source={{ uri: localPath }}
                      style={{ width: 100, height: 100, borderRadius: radii.sm }}
                    />
                  );
                }
                return (
                  <View
                    key={i}
                    style={{
                      width: 100,
                      height: 100,
                      borderRadius: radii.sm,
                      backgroundColor: colors.bgMuted,
                      borderWidth: borders.hair,
                      borderColor: colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.textSecondary, textAlign: 'center' },
                      ]}
                    >
                      {photoView.pending ? 'Loading…' : 'Unavailable'}
                    </Text>
                  </View>
                );
              })}
            </View>
            {photoView.pending && (
              <View style={{ marginTop: spacing.sm }}>
                <Banner variant="info" message="Downloading photos…" />
              </View>
            )}
            {!photoView.pending && photoView.missingCount > 0 && (
              <View style={{ marginTop: spacing.sm }}>
                <Banner
                  variant="warning"
                  message={`${photoView.missingCount} of ${entry.photo_paths.length} photos couldn't be downloaded. Will retry on next sync.`}
                />
              </View>
            )}
          </View>
        )}

        {/* Message — surfaced when the request payload carries one. D3
            noted plumbing is in flux; defensive read so older requests
            without a `message` field render fine. */}
        {requestMessage.length > 0 && (
          <View style={cardStyle}>
            <Text
              style={[typography.label, { color: colors.textSecondary, marginBottom: spacing.xs }]}
            >
              Message from tech
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {requestMessage}
            </Text>
          </View>
        )}

        {/* Status banner for non-pending requests */}
        {!isPending && (
          <Banner
            variant={req.status === 'signed' ? 'success' : 'info'}
            message={
              req.status === 'signed'
                ? 'This request has been signed.'
                : req.status === 'declined'
                  ? 'This request was declined.'
                  : req.status === 'withdrawn'
                    ? 'This request was withdrawn by the tech.'
                    : 'This request has expired.'
            }
          />
        )}

        {/* Decline reason input */}
        {declineMode && (
          <View style={[cardStyle, { gap: spacing.sm }]}>
            <Textarea
              label="Decline reason"
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="Optional — the tech will see this"
              maxLength={200}
              numberOfLines={4}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setDeclineMode(false);
                    setDeclineReason('');
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Decline request"
                  variant="primary"
                  onPress={handleDeclineSubmit}
                />
              </View>
            </View>
          </View>
        )}

        {/* Signature canvas */}
        {showCanvas && (
          <View style={[cardStyle, { gap: spacing.sm }]}>
            <Text
              style={[typography.label, { color: colors.textSecondary }]}
            >
              Your signature
            </Text>
            <View
              style={{
                borderWidth: borders.hair,
                borderColor: colors.border,
                borderRadius: radii.sm,
                overflow: 'hidden',
                height: 200,
                backgroundColor: '#ffffff',
              }}
            >
              <SignatureCanvas
                ref={sigRef}
                onOK={(sig) => handleSign(sig)}
                autoClear={false}
                descriptionText=""
                webStyle={`.m-signature-pad{box-shadow:none;border:none}.m-signature-pad--body{border:none;background-color:#ffffff}.m-signature-pad--footer{display:none}`}
              />
            </View>
            <View style={{ gap: spacing.sm }}>
              <Button
                title="Confirm & sign"
                variant="primary"
                onPress={() => sigRef.current?.readSignature()}
                loading={signing}
                haptic
              />
              <Button
                title="Clear"
                variant="ghost"
                onPress={() => sigRef.current?.clearSignature()}
              />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setShowCanvas(false)}
              />
            </View>
          </View>
        )}

        {/* Footer actions — only when the user is the supervisor on a
            pending request. Sign is the primary positive action and goes
            straight to the signature canvas; Decline confirms via Alert. */}
        {canAct && !showCanvas && !declineMode && (
          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              title="Sign"
              variant="primary"
              onPress={() => setShowCanvas(true)}
              haptic
            />
            <Button
              title="Decline"
              variant="secondary"
              onPress={promptDecline}
            />
          </View>
        )}

        {/* When the viewer isn't the supervisor (e.g. tech opening their
            own outgoing request from a list), offer a back/close affordance.
            Pending-supervisor view already has Sign / Decline. */}
        {!canAct && (
          <View style={{ marginTop: spacing.md }}>
            <Pressable
              onPress={() => navigation.goBack()}
              accessibilityRole="link"
              accessibilityLabel="Close"
            >
              <Text
                style={[
                  typography.label,
                  { color: colors.accentPrimary, textAlign: 'center' },
                ]}
              >
                Close
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
