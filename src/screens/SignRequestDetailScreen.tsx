import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Image } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas from 'react-native-signature-canvas';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { Screen, Card, Button, Banner, Input, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useSignRequests } from '../hooks/useSignRequests';
import { getLocalPhotoPathsFromCache } from '../services/signRequestsService';
import { useProfile } from '../hooks/useProfile';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'SignRequestDetail'>;

export function SignRequestDetailScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { data: profile } = useProfile();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const signReqs = useSignRequests({ db, cloud, fs, hash: sha256 });
  const [showCanvas, setShowCanvas] = useState(false);
  const [signing, setSigning] = useState(false);
  const [declineMode, setDeclineMode] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const sigRef = useRef<any>(null);

  const req = (signReqs.query.data ?? []).find((r) => r.id === route.params.requestId);

  const [photoView, setPhotoView] = useState<{ paths: string[]; missingCount: number; pending: boolean }>(
    { paths: [], missingCount: 0, pending: true },
  );

  useEffect(() => {
    if (!req) return;
    let cancelled = false;
    (async () => {
      const row = await db.get<{ local_photo_paths_json: string | null }>(
        'SELECT local_photo_paths_json FROM sign_requests_cache WHERE id = ?', [req.id]);
      if (cancelled || !row) return;
      setPhotoView(getLocalPhotoPathsFromCache(row));
    })();
    return () => { cancelled = true; };
  }, [req?.id, signReqs.query.dataUpdatedAt, db]);

  if (!req || !profile) return null;
  const entry = req.entry_payload;

  const handleSign = async (png_base64: string) => {
    setSigning(true);
    try {
      let lat: number | undefined;
      let lon: number | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          lat = loc.coords.latitude;
          lon = loc.coords.longitude;
        }
      } catch {}
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
    } catch (e: any) {
      Alert.alert('Could not sign', e.message);
    } finally {
      setSigning(false);
    }
  };

  const handleDecline = async () => {
    try {
      await signReqs.decline.mutateAsync({ id: req.id, reason: declineReason.trim() });
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Could not decline', e.message);
    }
  };

  return (
    <Screen topDivider>
      <ScrollView contentContainerStyle={{ gap: spacing.base, padding: spacing.base, paddingBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Sign Request</Text>
        <Banner variant="info" message={`Requested at ${new Date(req.created_at).toLocaleString()}`} />

        <SectionHeader label="ENTRY DETAILS" />
        <Card accent="orange">
          <Text style={[typography.bodyBold, { color: colors.textPrimary }]}>
            {entry.date_from === entry.date_to ? entry.date_from : `${entry.date_from} → ${entry.date_to}`}
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {entry.site} · {entry.client}
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>{entry.employer}</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {entry.work_hours}h · Level {entry.tech_level_snapshot}
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            Work types: {entry.work_types.join(', ')}
          </Text>
          {entry.other_work_description && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Other: {entry.other_work_description}
            </Text>
          )}
          <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.sm }]}>
            {entry.description}
          </Text>
          {entry.equipment_notes && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              Equipment: {entry.equipment_notes}
            </Text>
          )}
          {entry.weather && (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              Weather: {entry.weather}
            </Text>
          )}
        </Card>

        {entry.photo_paths.length > 0 && (
          <View>
            <SectionHeader label="PHOTOS" />
            <Card accent="navy">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {Array.from({ length: entry.photo_paths.length }).map((_, i) => {
                  const localPath = photoView.pending ? '' : (photoView.paths[i] ?? '');
                  if (localPath) {
                    return <Image key={i} source={{ uri: localPath }} style={{ width: 100, height: 100, borderRadius: 6 }} />;
                  }
                  return (
                    <View
                      key={i}
                      style={{
                        width: 100, height: 100, borderRadius: 6,
                        backgroundColor: colors.slateLightest, alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
                        {photoView.pending ? 'Loading…' : 'Photo unavailable'}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {photoView.pending && (
                <Banner variant="info" message="Downloading photos…" />
              )}
              {!photoView.pending && photoView.missingCount > 0 && (
                <Banner
                  variant="warning"
                  message={`${photoView.missingCount} of ${entry.photo_paths.length} photos couldn't be downloaded. Will retry on next sync.`}
                />
              )}
            </Card>
          </View>
        )}

        {req.status !== 'pending' && (
          <Banner
            variant="info"
            message={`Status: ${req.status}${req.decline_reason ? ` — ${req.decline_reason}` : ''}`}
          />
        )}

        {req.status === 'pending' && !showCanvas && !declineMode && (
          <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
            <Button title="SIGN" onPress={() => setShowCanvas(true)} style={{ flex: 1 }} variant="danger" haptic />
            <Button title="DECLINE" variant="ghost" onPress={() => setDeclineMode(true)} style={{ flex: 1 }} />
            <Button title="CLOSE" variant="ghost" onPress={() => navigation.goBack()} style={{ flex: 1 }} />
          </View>
        )}

        {declineMode && (
          <Card accent="navy">
            <Input
              label="Decline reason"
              value={declineReason}
              onChangeText={setDeclineReason}
              placeholder="Optional reason (the tech will see this)"
              maxLength={200}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={{ minHeight: 100 }}
            />
            <View style={{ height: spacing.xs }} />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Button title="DECLINE REQUEST" onPress={handleDecline} style={{ flex: 1 }} variant="danger" haptic />
              <Button
                title="CANCEL"
                variant="ghost"
                onPress={() => {
                  setDeclineMode(false);
                  setDeclineReason('');
                }}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        )}

        {showCanvas && (
          <Card accent="orange" style={{ gap: spacing.xs, marginTop: spacing.md }}>
            <SectionHeader label="YOUR SIGNATURE" />
            <View style={{ borderWidth: 2, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', height: 200, backgroundColor: '#ffffff' }}>
              <SignatureCanvas
                ref={sigRef}
                onOK={(sig) => handleSign(sig)}
                autoClear={false}
                descriptionText=""
                webStyle={`.m-signature-pad{box-shadow:none;border:none}.m-signature-pad--body{border:none;background-color:#ffffff}.m-signature-pad--footer{display:none}`}
              />
            </View>
            <View style={{ gap: spacing.md, marginTop: spacing.md }}>
              <Button title="CONFIRM & SIGN" onPress={() => sigRef.current?.readSignature()} loading={signing} variant="danger" haptic />
              <Button title="Clear Signature" variant="ghost" onPress={() => sigRef.current?.clearSignature()} />
              <Button title="Cancel" variant="ghost" onPress={() => setShowCanvas(false)} />
            </View>
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
